import { createClient } from '@supabase/supabase-js'
import { Connection } from '@solana/web3.js'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice } from '../../lib/solana'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { pixelId, txSignature, buyerWallet, displayName, color } = req.body

  if (!txSignature || !buyerWallet || pixelId === undefined) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    const { data: existingPixel } = await supabase
      .from('pixels').select('*').eq('id', pixelId).single()

    const isFirstSale = !existingPixel?.owner_wallet
    const expectedAmount = isFirstSale ? BASE_PIXEL_PRICE_SOL : calculateNextPrice(existingPixel.current_price_sol)

    // Verify transaction on Solana
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    )

    let txValid = false
    let attempts = 0
    while (!txValid && attempts < 5) {
      try {
        const tx = await connection.getTransaction(txSignature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        })
        if (tx && tx.meta?.err === null) txValid = true
      } catch (e) {}
      if (!txValid) {
        attempts++
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    if (!txValid) {
      return res.status(400).json({ error: 'Transaction not found or not confirmed. Wait a few seconds and try again.' })
    }

    // Check tx not already used
    const { data: existingTx } = await supabase
      .from('transactions').select('id').eq('tx_signature', txSignature).single()
    if (existingTx) return res.status(400).json({ error: 'Transaction already used' })

    const nextPrice = calculateNextPrice(expectedAmount)
    const previousOwner = existingPixel?.owner_wallet || null

    await supabase.from('pixels').upsert({
      id: pixelId,
      owner_wallet: buyerWallet,
      owner_name: displayName,
      current_price_sol: nextPrice,
      original_price_sol: BASE_PIXEL_PRICE_SOL,
      purchase_count: (existingPixel?.purchase_count || 0) + 1,
      color: color || '#ff4d00',
      is_special: existingPixel?.is_special || false,
      special_type: existingPixel?.special_type || null,
      updated_at: new Date().toISOString(),
    })

    await supabase.from('transactions').insert({
      pixel_id: pixelId,
      buyer_wallet: buyerWallet,
      seller_wallet: previousOwner,
      amount_sol: expectedAmount,
      tx_signature: txSignature,
      created_at: new Date().toISOString(),
    })

    return res.status(200).json({ success: true, nextPrice, pixelId })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Server error during verification' })
  }
}
