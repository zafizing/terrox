import { createClient } from '@supabase/supabase-js'
import { getSpecialPixelIds, gridToLatLng, idToGrid } from '../../lib/pixels'
import { BASE_PIXEL_PRICE_SOL } from '../../lib/solana'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { secret } = req.body
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const specials = getSpecialPixelIds()
    const inserts = specials.map(s => {
      const { col, row } = idToGrid(s.id)
      const { lat, lng } = gridToLatLng(col, row)
      return {
        id: s.id, lat, lng,
        is_special: true,
        special_type: s.type,
        owner_name: s.name,
        current_price_sol: BASE_PIXEL_PRICE_SOL,
        original_price_sol: BASE_PIXEL_PRICE_SOL,
        purchase_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    })
    const { error } = await supabase.from('pixels').upsert(inserts, { onConflict: 'id' })
    if (error) throw error
    return res.status(200).json({ success: true, count: inserts.length })
  } catch (error) {
    return res.status(500).json({ error: 'Seed failed' })
  }
}
