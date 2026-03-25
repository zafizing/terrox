import { createClient } from '@supabase/supabase-js'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice, OWNER_WALLET, PLATFORM_FEE_PERCENT } from '../../lib/solana'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const getConnection = () => new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
  'confirmed'
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { type, pixelId, pixelIds, txSignature, buyerWallet, displayName, color } = req.body

  if (!txSignature || !buyerWallet) {
    return res.status(400).json({ error: 'Missing fields' })
  }

  try {
    // 1. Check signature not already used
    const { data: existing } = await supabase
      .from('transactions').select('id').eq('tx_signature', txSignature).single()
    if (existing) {
      return res.status(400).json({ error: 'Transaction already used' })
    }

    // 2. Verify transaction on-chain
    const connection = getConnection()
    const tx = await connection.getTransaction(txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })

    if (!tx || tx.meta?.err !== null) {
      return res.status(400).json({ error: 'Transaction failed or not found' })
    }

    // 3. Verify payment went to our wallet
    const ownerPubkey = new PublicKey(OWNER_WALLET)
    const accountKeys = tx.transaction.message.staticAccountKeys
      ? tx.transaction.message.staticAccountKeys.map(k => k.toString())
      : tx.transaction.message.accountKeys.map(k => k.toString())

    const ownerIdx = accountKeys.indexOf(ownerPubkey.toString())
    if (ownerIdx === -1) {
      return res.status(400).json({ error: 'Payment not directed to platform wallet' })
    }

    // Check balance change for our wallet
    const preBalance = tx.meta.preBalances[ownerIdx]
    const postBalance = tx.meta.postBalances[ownerIdx]
    const receivedLamports = postBalance - preBalance
    const receivedSol = receivedLamports / LAMPORTS_PER_SOL

    // 4. Calculate expected amount
    const ids = type === 'pixel' ? [pixelId] : (pixelIds || [])
    if (!ids.length) {
      return res.status(400).json({ error: 'No pixel IDs provided' })
    }

    let expectedPlatformSol = 0
    const pixelDetails = []

    for (const pid of ids) {
      const { data: currentPixel } = await supabase
        .from('pixels').select('*').eq('id', pid).single()

      const isResale = !!currentPixel?.owner_wallet
      const currentPrice = currentPixel?.current_price_sol || BASE_PIXEL_PRICE_SOL
      const purchasePrice = isResale ? calculateNextPrice(currentPrice) : BASE_PIXEL_PRICE_SOL

      if (isResale) {
        // Platform gets fee percentage
        expectedPlatformSol += purchasePrice * (PLATFORM_FEE_PERCENT / 100)
      } else {
        // First sale: platform gets everything
        expectedPlatformSol += purchasePrice
      }

      pixelDetails.push({
        pid,
        currentPixel,
        isResale,
        purchasePrice,
        nextPrice: calculateNextPrice(purchasePrice),
      })
    }

    // 5. Verify amount (with 5% tolerance for rounding/fees)
    const tolerance = expectedPlatformSol * 0.05
    if (receivedSol < expectedPlatformSol - tolerance - 0.001) {
      return res.status(400).json({
        error: `Insufficient payment. Expected ~${expectedPlatformSol.toFixed(4)} SOL to platform, received ${receivedSol.toFixed(4)} SOL`,
      })
    }

    // 6. All verified — update pixels
    const now = new Date().toISOString()
    for (const { pid, currentPixel, purchasePrice, nextPrice } of pixelDetails) {
      await supabase.from('pixels').upsert({
        id: pid,
        owner_wallet: buyerWallet,
        owner_name: displayName || buyerWallet.slice(0, 8) + '...',
        current_price_sol: nextPrice,
        original_price_sol: BASE_PIXEL_PRICE_SOL,
        purchase_count: (currentPixel?.purchase_count || 0) + 1,
        color: ids.length === 1 ? (color || '#e8440a') : (currentPixel?.color || color || '#e8440a'),
        is_special: false,
        updated_at: now,
      })
    }

    // 7. Record transaction
    await supabase.from('transactions').insert({
      pixel_id: type === 'pixel' ? pixelId : null,
      pixel_ids: type !== 'pixel' ? ids : null,
      buyer_wallet: buyerWallet,
      amount_sol: receivedSol,
      tx_signature: txSignature,
      purchase_type: type,
      created_at: now,
    })

    return res.status(200).json({ success: true, pixelsUpdated: ids.length })
  } catch (err) {
    console.error('verify-purchase error:', err)
    return res.status(500).json({ error: 'Server error: ' + (err.message || 'unknown') })
  }
}
