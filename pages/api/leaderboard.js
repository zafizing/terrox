import styles from './Leaderboard.module.css'

export default function Leaderboard({ entries }) {
  return (
    <div className={styles.board}>
      <div className={styles.header}>▲ TOP EMPIRES</div>
      <div className={styles.list}>
        {entries.length === 0 && (
          <div className={styles.empty}>No territories claimed yet.<br />Be the first conqueror.</div>
        )}
        {entries.map((entry, i) => (
          <div key={entry.wallet} className={styles.entry}>
            <div className={`${styles.rank} ${i === 0 ? styles.first : i === 1 ? styles.second : i === 2 ? styles.third : ''}`}>
              {i === 0 ? '⚡' : i === 1 ? '◆' : i === 2 ? '▲' : `${i + 1}`}
            </div>
            <div className={styles.info}>
              <div className={styles.name}>{entry.name}</div>
              <div className={styles.stats}>{entry.pixelCount} pixels · {entry.totalSpent.toFixed(3)} SOL</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
