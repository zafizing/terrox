import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const { data: pixels } = await supabase
      .from('pixels').select('owner_wallet, owner_name, current_price_sol, original_price_sol')
      .not('owner_wallet', 'is', null)

    const walletMap = new Map()
    pixels?.forEach(p => {
      const existing = walletMap.get(p.owner_wallet)
      if (existing) {
        existing.pixelCount++
        existing.totalSpent += p.original_price_sol || 0.01
      } else {
        walletMap.set(p.owner_wallet, {
          name: p.owner_name || p.owner_wallet.slice(0, 8) + '...',
          pixelCount: 1,
          totalSpent: p.original_price_sol || 0.01,
        })
      }
    })

    const leaderboard = Array.from(walletMap.entries())
      .map(([wallet, data]) => ({ wallet, ...data }))
      .sort((a, b) => b.pixelCount - a.pixelCount)
      .slice(0, 10)

    const { data: transactions } = await supabase
      .from('transactions')
      .select('id, pixel_id, buyer_wallet, created_at, pixels(owner_name, is_special, special_type)')
      .order('created_at', { ascending: false })
      .limit(15)

    const feed = transactions?.map(tx => ({
      id: tx.id,
      pixelId: tx.pixel_id,
      ownerName: tx.pixels?.owner_name || tx.buyer_wallet.slice(0, 8) + '...',
      timestamp: tx.created_at,
      isSpecial: tx.pixels?.is_special || false,
      specialType: tx.pixels?.special_type,
    })) || []

    const totalPixelsSold = pixels?.length || 0
    const totalVolume = pixels?.reduce((sum, p) => sum + (p.original_price_sol || 0.01), 0) || 0

    return res.status(200).json({ leaderboard, feed, stats: { totalPixelsSold, totalVolume } })
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch leaderboard' })
  }
}
