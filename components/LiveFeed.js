import { useEffect, useState } from 'react'
import styles from './LiveFeed.module.css'

function getTimeAgo(date) {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

export default function LiveFeed({ items }) {
  const [visible, setVisible] = useState([])

  useEffect(() => {
    setVisible(items.slice(0, 8))
  }, [items])

  if (visible.length === 0) return (
    <div className={styles.feed}>
      <div className={styles.header}><span className={styles.dot} />LIVE ACTIVITY</div>
      <div className={styles.empty}>No activity yet.<br />Be the first to claim.</div>
    </div>
  )

  return (
    <div className={styles.feed}>
      <div className={styles.header}><span className={styles.dot} />LIVE ACTIVITY</div>
      <div className={styles.list}>
        {visible.map((item) => (
          <div key={item.id} className={`${styles.item} ${item.isSpecial ? styles.special : ''}`}>
            <div className={styles.icon}>
              {item.isSpecial && item.specialType === 'legendary' ? '⚡' : item.isSpecial ? '◆' : '⚔'}
            </div>
            <div className={styles.content}>
              <span className={styles.name}>{item.ownerName}</span>
              <span className={styles.action}> claimed </span>
              <span className={styles.pixel}>#{item.pixelId}</span>
            </div>
            <div className={styles.time}>{getTimeAgo(item.timestamp)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
