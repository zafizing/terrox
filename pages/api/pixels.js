import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const { data, error } = await supabase
      .from('pixels')
      .select('*')
      .not('owner_wallet', 'is', null)
      .order('updated_at', { ascending: false })
    if (error) throw error
    return res.status(200).json({ pixels: data || [] })
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch pixels' })
  }
}
