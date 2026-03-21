import { useState, useEffect, useCallback, useRef } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { calculateNextPrice, BASE_PIXEL_PRICE_SOL } from '../lib/solana'
import LiveFeed from '../components/LiveFeed'
import Leaderboard from '../components/Leaderboard'
import PurchaseModal from '../components/PurchaseModal'
import styles from '../styles/Home.module.css'

const PixelMap = dynamic(() => import('../components/PixelMap'), { ssr: false })

export default function Home() {
  const { connected, publicKey } = useWallet()
  const [pixels, setPixels] = useState(new Map())
  const [feedItems, setFeedItems] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [stats, setStats] = useState({ totalPixelsSold: 0, totalVolume: 0 })
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [purchaseIntent, setPurchaseIntent] = useState(null)
  const pollRef = useRef(null)

  const fetchPixels = useCallback(async () => {
    try {
      const res = await fetch('/api/pixels')
      const data = await res.json()
      const map = new Map()
      data.pixels?.forEach(p => map.set(p.id, p))
      setPixels(map)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard')
      const data = await res.json()
      setLeaderboard(data.leaderboard || [])
      setStats(data.stats || { totalPixelsSold: 0, totalVolume: 0 })
      setFeedItems((data.feed || []).map(f => ({ ...f, timestamp: new Date(f.timestamp) })))
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    fetchPixels()
    fetchLeaderboard()
    pollRef.current = setInterval(() => { fetchPixels(); fetchLeaderboard() }, 20000)
    return () => clearInterval(pollRef.current)
  }, [fetchPixels, fetchLeaderboard])

  const handlePurchaseSuccess = useCallback(() => {
    setTimeout(() => { fetchPixels(); fetchLeaderboard() }, 2000)
  }, [fetchPixels, fetchLeaderboard])

  const pixelsRemaining = 51200 - stats.totalPixelsSold
  const pct = ((stats.totalPixelsSold / 51200) * 100).toFixed(1)

  return (
    <>
      <Head>
        <title>TERROX — Own The World</title>
        <meta name="description" content="Buy pixels on a real world map. Prices rise with every sale. Previous owners always profit." />
      </Head>

      <div className={styles.app}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoText}>TERROX</span>
            <span className={styles.logoSub}>Own The World</span>
          </div>
          <div className={styles.statsBar}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.totalPixelsSold.toLocaleString()}</span>
              <span className={styles.statLabel}>Claimed</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{pixelsRemaining.toLocaleString()}</span>
              <span className={styles.statLabel}>Remaining</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.totalVolume.toFixed(1)}</span>
              <span className={styles.statLabel}>SOL Traded</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            <WalletMultiButton style={{
              background: connected ? '#0a2a0a' : '#1a0a0a',
              border: `1px solid ${connected ? '#2a5a2a' : '#5a1a1a'}`,
              borderRadius: 0,
              fontFamily: 'Space Mono, monospace',
              fontSize: 9,
              letterSpacing: 2,
              height: 32,
              padding: '0 12px',
            }} />
            <button className={styles.menuBtn} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          </div>
        </header>

        {/* Progress bar */}
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: pct + '%' }} />
          <span className={styles.progressLabel}>{pct}% claimed</span>
        </div>

        <div className={styles.main}>
          {/* Sidebar */}
          <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
            <div className={styles.sidebarContent}>
              <div className={styles.howTo}>
                <div className={styles.sectionTitle}>How to claim</div>
                <div className={styles.steps}>
                  <div className={styles.step}><span className={styles.stepNum}>1</span><span>Connect your Phantom or Solflare wallet</span></div>
                  <div className={styles.step}><span className={styles.stepNum}>2</span><span>Hover over any land pixel</span></div>
                  <div className={styles.step}><span className={styles.stepNum}>3</span><span>Choose: pixel, country, or continent</span></div>
                  <div className={styles.step}><span className={styles.stepNum}>4</span><span>Confirm in your wallet — done</span></div>
                </div>
                <div className={styles.note}>
                  When someone buys your pixel, you automatically get your money back + 5% profit. Price rises 10% each sale.
                </div>
              </div>
              <Leaderboard entries={leaderboard} />
            </div>
          </aside>

          {/* Map */}
          <div className={styles.mapContainer}>
            {loading && (
              <div className={styles.loadingOverlay}>
                <div className={styles.loadingText}>LOADING MAP</div>
                <div className={styles.loadingBar}><div className={styles.loadingFill} /></div>
              </div>
            )}
            <PixelMap
              pixels={pixels}
              onPurchaseIntent={setPurchaseIntent}
              highlightedPixelId={null}
            />
            <div className={styles.mapHint}>Hover over land to claim territory</div>
          </div>

          {/* Right panel */}
          <aside className={styles.rightPanel}>
            <LiveFeed items={feedItems} />
          </aside>
        </div>
      </div>

      {/* Purchase modal */}
      {purchaseIntent && (
        <PurchaseModal
          intent={purchaseIntent}
          onClose={() => setPurchaseIntent(null)}
          onSuccess={handlePurchaseSuccess}
        />
      )}
    </>
  )
}
