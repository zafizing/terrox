import { useState } from 'react'
import { calculateNextPrice, calculateSplit, OWNER_WALLET } from '../lib/solana'
import styles from './PixelModal.module.css'

const COLORS = [
  '#ff4d00', '#ff6b35', '#ff8c42',
  '#00d4ff', '#0099cc', '#0066aa',
  '#00ff88', '#00cc66', '#009944',
  '#ff00aa', '#cc0088', '#990066',
  '#ffd700', '#ffaa00', '#ff8800',
  '#aa44ff', '#8822dd', '#6600bb',
]

export default function PixelModal({ pixel, pixelId, onClose, onPurchaseSuccess }) {
  const [walletAddress, setWalletAddress] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [selectedColor, setSelectedColor] = useState(COLORS[0])
  const [txSignature, setTxSignature] = useState('')
  const [step, setStep] = useState('info')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (pixelId === null || pixelId === undefined) return null

  const isOwned = pixel?.owner_wallet
  const currentPrice = pixel?.current_price_sol || 0.01
  const nextPrice = isOwned ? calculateNextPrice(currentPrice) : currentPrice
  const split = isOwned ? calculateSplit(nextPrice, true) : calculateSplit(nextPrice, false)
  const paymentAddress = isOwned && pixel?.owner_wallet ? pixel.owner_wallet : OWNER_WALLET

  const handleVerifyAndClaim = async () => {
    if (!txSignature.trim()) { setError('Please enter your transaction signature'); return }
    if (!walletAddress.trim()) { setError('Please enter your wallet address'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/verify-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pixelId,
          txSignature: txSignature.trim(),
          buyerWallet: walletAddress.trim(),
          displayName: displayName.trim() || walletAddress.trim().slice(0, 8) + '...',
          color: selectedColor,
          amount: nextPrice,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setStep('success')
        onPurchaseSuccess(pixelId, txSignature, walletAddress, displayName || walletAddress.slice(0, 8) + '...', selectedColor)
      } else {
        setError(data.error || 'Verification failed. Check your transaction signature.')
      }
    } catch (e) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose}>✕</button>

        <div className={styles.header}>
          {pixel?.is_special && (
            <div className={`${styles.badge} ${pixel.special_type === 'legendary' ? styles.legendary : styles.strategic}`}>
              {pixel.special_type === 'legendary' ? '⚡ LEGENDARY' : '◆ STRATEGIC'}
            </div>
          )}
          <h2 className={styles.title}>PIXEL #{pixelId}</h2>
          {pixel?.territory_name && <div className={styles.territory}>{pixel.territory_name}</div>}
        </div>

        <div className={styles.status}>
          {isOwned ? (
            <>
              <div className={styles.statusRow}>
                <span className={styles.label}>OWNER</span>
                <span className={styles.value}>{pixel?.owner_name || pixel?.owner_wallet?.slice(0, 12) + '...'}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.label}>TIMES SOLD</span>
                <span className={styles.value}>{pixel?.purchase_count || 1}</span>
              </div>
            </>
          ) : (
            <div className={styles.unclaimed}>UNCLAIMED TERRITORY</div>
          )}
        </div>

        <div className={styles.pricing}>
          <div className={styles.priceBox}>
            <div className={styles.priceLabel}>PRICE</div>
            <div className={styles.price}>{nextPrice.toFixed(4)} SOL</div>
            <div className={styles.priceUsd}>≈ ${(nextPrice * 150).toFixed(2)} USD</div>
          </div>
          {isOwned && (
            <div className={styles.splitInfo}>
              <div className={styles.splitRow}>
                <span>→ Previous owner gets</span>
                <span className={styles.green}>{split.seller.toFixed(4)} SOL</span>
              </div>
              <div className={styles.splitRow}>
                <span>→ Platform fee</span>
                <span className={styles.orange}>{split.platform.toFixed(4)} SOL</span>
              </div>
            </div>
          )}
        </div>

        {step === 'info' && (
          <div className={styles.form}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>YOUR WALLET ADDRESS</label>
              <input className={styles.input} placeholder="Solana wallet address..." value={walletAddress} onChange={e => setWalletAddress(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>DISPLAY NAME (optional)</label>
              <input className={styles.input} placeholder="How you'll appear on the map..." value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={24} />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>TERRITORY COLOR</label>
              <div className={styles.colors}>
                {COLORS.map(color => (
                  <button key={color} className={`${styles.colorBtn} ${selectedColor === color ? styles.colorSelected : ''}`} style={{ background: color }} onClick={() => setSelectedColor(color)} />
                ))}
              </div>
            </div>
            <button className={styles.primaryBtn} onClick={() => setStep('pay')} disabled={!walletAddress.trim()}>
              PROCEED TO PAYMENT →
            </button>
          </div>
        )}

        {step === 'pay' && (
          <div className={styles.payStep}>
            <div className={styles.instruction}>
              <div className={styles.stepNum}>1</div>
              <div>
                <div className={styles.instrTitle}>SEND EXACTLY</div>
                <div className={styles.instrAmount}>{nextPrice.toFixed(4)} SOL</div>
              </div>
            </div>
            <div className={styles.instruction}>
              <div className={styles.stepNum}>2</div>
              <div>
                <div className={styles.instrTitle}>TO THIS ADDRESS</div>
                <div className={styles.addressBox}>
                  <span className={styles.address}>{paymentAddress}</span>
                  <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(paymentAddress)}>COPY</button>
                </div>
              </div>
            </div>
            <div className={styles.instruction}>
              <div className={styles.stepNum}>3</div>
              <div>
                <div className={styles.instrTitle}>PASTE TX SIGNATURE BELOW</div>
                <input className={styles.input} placeholder="Transaction signature from your wallet..." value={txSignature} onChange={e => setTxSignature(e.target.value)} />
              </div>
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button className={styles.primaryBtn} onClick={handleVerifyAndClaim} disabled={loading || !txSignature.trim()}>
              {loading ? 'VERIFYING...' : 'VERIFY & CLAIM PIXEL →'}
            </button>
            <button className={styles.backBtn} onClick={() => setStep('info')}>← BACK</button>
          </div>
        )}

        {step === 'success' && (
          <div className={styles.success}>
            <div className={styles.successIcon}>⚔</div>
            <h3 className={styles.successTitle}>TERRITORY CLAIMED</h3>
            <p className={styles.successText}>Pixel #{pixelId} is now yours. Your mark is on the world map.</p>
            <button className={styles.primaryBtn} onClick={onClose}>VIEW MY TERRITORY</button>
          </div>
        )}
      </div>
    </div>
  )
}
