import { createClient } from '@supabase/supabase-js'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice, verifyTransaction } from '../../lib/solana'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { type, pixelId, pixelIds, txSignature, buyerWallet, displayName, color } = req.body

  if (!txSignature || !buyerWallet) return res.status(400).json({ error: 'Missing fields' })

  try {
    // Verify transaction on chain
    const valid = await verifyTransaction(txSignature)
    if (!valid) return res.status(400).json({ error: 'Transaction not confirmed. Try again.' })

    // Check not already used
    const { data: existing } = await supabase
      .from('transactions').select('id').eq('tx_signature', txSignature).single()
    if (existing) return res.status(400).json({ error: 'Transaction already used' })

    const ids = type === 'pixel' ? [pixelId] : pixelIds
    const now = new Date().toISOString()

    // Update each pixel
    for (const pid of ids) {
      const { data: currentPixel } = await supabase
        .from('pixels').select('*').eq('id', pid).single()

      const nextPrice = calculateNextPrice(currentPixel?.current_price_sol || BASE_PIXEL_PRICE_SOL)

      await supabase.from('pixels').upsert({
        id: pid,
        owner_wallet: buyerWallet,
        owner_name: displayName,
        current_price_sol: nextPrice,
        original_price_sol: BASE_PIXEL_PRICE_SOL,
        purchase_count: (currentPixel?.purchase_count || 0) + 1,
        color: ids.length === 1 ? (color || '#e8440a') : (currentPixel?.color || '#e8440a'),
        is_special: false,
        updated_at: now,
      })
    }

    // Record transaction
    await supabase.from('transactions').insert({
      pixel_id: type === 'pixel' ? pixelId : null,
      pixel_ids: type !== 'pixel' ? ids : null,
      buyer_wallet: buyerWallet,
      amount_sol: 0, // actual amount from blockchain
      tx_signature: txSignature,
      purchase_type: type,
      created_at: now,
    })

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Server error' })
  }
}
