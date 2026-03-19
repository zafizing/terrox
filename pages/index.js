import { useState, useEffect, useCallback, useRef } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { calculateNextPrice, BASE_PIXEL_PRICE_SOL } from '../lib/solana'
import { gridToLatLng, idToGrid } from '../lib/pixels'
import PixelModal from '../components/PixelModal'
import LiveFeed from '../components/LiveFeed'
import Leaderboard from '../components/Leaderboard'
import styles from '../styles/Home.module.css'

const PixelMap = dynamic(() => import('../components/PixelMap'), { ssr: false })

export default function Home() {
  const [pixels, setPixels] = useState(new Map())
  const [selectedPixelId, setSelectedPixelId] = useState(null)
  const [selectedPixel, setSelectedPixel] = useState(null)
  const [feedItems, setFeedItems] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [stats, setStats] = useState({ totalPixelsSold: 0, totalVolume: 0 })
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pollRef = useRef(null)

  const fetchPixels = useCallback(async () => {
    try {
      const res = await fetch('/api/pixels')
      const data = await res.json()
      const map = new Map()
      data.pixels?.forEach(p => map.set(p.id, p))
      setPixels(map)
    } catch (e) {
      console.error('Failed to fetch pixels', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard')
      const data = await res.json()
      setLeaderboard(data.leaderboard || [])
      setStats(data.stats || { totalPixelsSold: 0, totalVolume: 0 })
      const feed = (data.feed || []).map(f => ({ ...f, timestamp: new Date(f.timestamp), action: 'claimed' }))
      setFeedItems(feed)
    } catch (e) {
      console.error('Failed to fetch leaderboard', e)
    }
  }, [])

  useEffect(() => {
    fetchPixels()
    fetchLeaderboard()
    pollRef.current = setInterval(() => {
      fetchPixels()
      fetchLeaderboard()
    }, 15000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchPixels, fetchLeaderboard])

  const handlePixelClick = useCallback((pixelId, lat, lng) => {
    setSelectedPixelId(pixelId)
    setSelectedPixel(pixels.get(pixelId) || null)
  }, [pixels])

  const handlePurchaseSuccess = useCallback((pixelId, txSig, buyerWallet, name, color) => {
    setPixels(prev => {
      const next = new Map(prev)
      const existing = prev.get(pixelId)
      next.set(pixelId, {
        id: pixelId,
        owner_wallet: buyerWallet,
        owner_name: name,
        territory_name: existing?.territory_name || null,
        current_price_sol: calculateNextPrice(existing?.current_price_sol || BASE_PIXEL_PRICE_SOL),
        original_price_sol: BASE_PIXEL_PRICE_SOL,
        is_special: existing?.is_special || false,
        special_type: existing?.special_type || null,
        purchase_count: (existing?.purchase_count || 0) + 1,
        color,
        updated_at: new Date().toISOString(),
      })
      return next
    })

    setFeedItems(prev => [{
      id: txSig,
      pixelId,
      ownerName: name,
      action: 'claimed',
      timestamp: new Date(),
      isSpecial: pixels.get(pixelId)?.is_special,
      specialType: pixels.get(pixelId)?.special_type,
    }, ...prev.slice(0, 14)])

    setTimeout(fetchLeaderboard, 2000)
  }, [pixels, fetchLeaderboard])

  const pixelsRemaining = 100000 - stats.totalPixelsSold
  const percentSold = ((stats.totalPixelsSold / 100000) * 100).toFixed(2)

  return (
    <>
      <Head><title>TERROX — Own The World</title></Head>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoText}>TERROX</span>
            <span className={styles.logoSub}>OWN THE WORLD</span>
          </div>
          <div className={styles.statsBar}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.totalPixelsSold.toLocaleString()}</span>
              <span className={styles.statLabel}>CLAIMED</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>{pixelsRemaining.toLocaleString()}</span>
              <span className={styles.statLabel}>REMAINING</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.totalVolume.toFixed(2)}</span>
              <span className={styles.statLabel}>SOL TRADED</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.menuBtn} onClick={() => setSidebarOpen(!sidebarOpen)}>☰ STATS</button>
          </div>
        </header>

        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${percentSold}%` }} />
          <span className={styles.progressLabel}>{percentSold}% OF WORLD CLAIMED</span>
        </div>

        <div className={styles.main}>
          <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
            <div className={styles.sidebarContent}>
              <div className={styles.howTo}>
                <div className={styles.sectionTitle}>⚔ HOW TO CONQUER</div>
                <div className={styles.steps}>
                  <div className={styles.step}><span className={styles.stepNum}>1</span><span>Click any pixel on the map</span></div>
                  <div className={styles.step}><span className={styles.stepNum}>2</span><span>Send SOL to the displayed address</span></div>
                  <div className={styles.step}><span className={styles.stepNum}>3</span><span>Paste your tx signature to claim</span></div>
                  <div className={styles.step}><span className={styles.stepNum}>4</span><span>Your mark appears on the world map</span></div>
                </div>
                <div className={styles.note}>When someone buys your pixel, you automatically profit. Every resale price climbs 10%.</div>
              </div>
              <div className={styles.specialInfo}>
                <div className={styles.sectionTitle}>◆ SPECIAL PIXELS</div>
                <div className={styles.specialTypes}>
                  <div className={styles.specialType}>
                    <span className={styles.legendaryDot}>⚡</span>
                    <div><div className={styles.specialName}>LEGENDARY</div><div className={styles.specialDesc}>Famous landmarks. Highest visibility.</div></div>
                  </div>
                  <div className={styles.specialType}>
                    <span className={styles.strategicDot}>◆</span>
                    <div><div className={styles.specialName}>STRATEGIC</div><div className={styles.specialDesc}>World capitals. Prime territory.</div></div>
                  </div>
                </div>
              </div>
              <Leaderboard entries={leaderboard} />
            </div>
          </aside>

          <div className={styles.mapContainer}>
            {loading && (
              <div className={styles.loadingOverlay}>
                <div className={styles.loadingText}>LOADING WORLD MAP...</div>
                <div className={styles.loadingBar}><div className={styles.loadingFill} /></div>
              </div>
            )}
            <PixelMap pixels={pixels} onPixelClick={handlePixelClick} highlightedPixelId={selectedPixelId} />
            <div className={styles.mapHint}>CLICK ANY PIXEL TO CLAIM TERRITORY</div>
          </div>

          <aside className={styles.rightPanel}>
            <LiveFeed items={feedItems} />
          </aside>
        </div>
      </div>

      {selectedPixelId !== null && (
        <PixelModal
          pixel={selectedPixel}
          pixelId={selectedPixelId}
          onClose={() => { setSelectedPixelId(null); setSelectedPixel(null) }}
          onPurchaseSuccess={handlePurchaseSuccess}
        />
      )}
    </>
  )
}
