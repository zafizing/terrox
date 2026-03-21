import { useState, useCallback } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { buildPaymentTransaction, buildBulkPaymentTransaction, BASE_PIXEL_PRICE_SOL, calculateNextPrice, getConnection } from '../lib/solana'
import { idToGrid, gridToLatLng, GRID_COLS } from '../lib/pixels'

const COLORS = [
  '#e8440a','#ff6b35','#ffaa00','#ffd700',
  '#00cc66','#00aa44','#0066ff','#0099cc',
  '#00d4ff','#cc00aa','#9933ff','#ff0066',
  '#ffffff','#aabbcc','#445566','#1e3a52',
]

export default function PurchaseModal({ intent, onClose, onSuccess }) {
  const { publicKey, sendTransaction, connected } = useWallet()
  const { setVisible } = useWalletModal()
  const [selectedColor, setSelectedColor] = useState(COLORS[0])
  const [displayName, setDisplayName] = useState('')
  const [status, setStatus] = useState('idle') // idle | paying | verifying | success | error
  const [errorMsg, setErrorMsg] = useState('')

  if (!intent) return null

  const isPixel = intent.type === 'pixel'
  const isBulk = intent.type === 'country' || intent.type === 'continent'
  const title = isPixel
    ? `Pixel #${intent.pixelId}`
    : intent.type === 'country' ? intent.country : intent.continent

  const handlePurchase = useCallback(async () => {
    if (!connected || !publicKey) {
      setVisible(true)
      return
    }

    setStatus('paying')
    setErrorMsg('')

    try {
      const connection = getConnection()
      let tx

      if (isPixel) {
        const isResale = !!intent.pixel?.owner_wallet
        tx = await buildPaymentTransaction(
          publicKey,
          intent.priceSol,
          intent.pixel?.owner_wallet || null,
          isResale
        )
      } else {
        // Bulk: build pixel groups with owner info
        const pixelGroups = intent.pixelIds.map(pid => ({
          pixelId: pid,
          currentPriceSol: BASE_PIXEL_PRICE_SOL, // simplified — use actual prices in production
          ownerWallet: null, // TODO: look up actual owners
        }))
        tx = await buildBulkPaymentTransaction(publicKey, pixelGroups)
      }

      // Send transaction via connected wallet — user approves in their wallet UI
      const signature = await sendTransaction(tx, connection)

      setStatus('verifying')

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed')

      // Record purchase in database
      const res = await fetch('/api/verify-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: intent.type,
          pixelId: intent.pixelId,
          pixelIds: intent.pixelIds,
          txSignature: signature,
          buyerWallet: publicKey.toString(),
          displayName: displayName || publicKey.toString().slice(0, 8) + '...',
          color: selectedColor,
        }),
      })
      const data = await res.json()

      if (data.success) {
        setStatus('success')
        onSuccess()
      } else {
        throw new Error(data.error || 'Verification failed')
      }
    } catch (err) {
      setStatus('error')
      setErrorMsg(err.message || 'Transaction failed')
    }
  }, [connected, publicKey, intent, selectedColor, displayName])

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(4px)',
        zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#080f1e',
          border: '1px solid #1a3a5a',
          borderTop: '2px solid #e8440a',
          width: '100%',
          maxWidth: 420,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #0e2a42', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 9, letterSpacing: 3, color: '#2a5a7a', marginBottom: 4 }}>
              {intent.type.toUpperCase()} PURCHASE
            </div>
            <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 28, letterSpacing: 4, color: '#d0e4f0', lineHeight: 1 }}>
              {title}
            </div>
            {isBulk && (
              <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#4a7a9a', marginTop: 4 }}>
                {intent.pixelIds?.length?.toLocaleString()} pixels
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#2a5a7a', fontSize: 18, cursor: 'pointer', padding: '0 0 0 16px' }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Price */}
          <div style={{ background: '#0a1828', border: '1px solid #0e2a42', padding: '14px 16px', marginBottom: 20 }}>
            <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 8, letterSpacing: 2, color: '#2a5a7a', marginBottom: 6 }}>
              TOTAL PRICE
            </div>
            <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 36, color: '#e8440a', letterSpacing: 2, lineHeight: 1 }}>
              {intent.priceSol?.toFixed(isBulk ? 2 : 4)} SOL
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#2a5a7a', marginTop: 4 }}>
              ≈ ${(intent.priceSol * 150).toFixed(isBulk ? 0 : 2)} USD
            </div>
            {isPixel && intent.pixel?.owner_wallet && (
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#3a6a4a', marginTop: 8, padding: '6px 10px', background: 'rgba(0,200,100,0.05)', borderLeft: '2px solid #2a5a3a' }}>
                Previous owner receives {(intent.priceSol * 0.95).toFixed(4)} SOL (+5% profit)
              </div>
            )}
          </div>

          {/* Color picker — only for pixel */}
          {isPixel && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 9, letterSpacing: 2, color: '#2a5a7a', marginBottom: 10 }}>
                TERRITORY COLOR
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setSelectedColor(c)}
                    style={{
                      width: 28, height: 28,
                      background: c,
                      border: selectedColor === c ? '2px solid #fff' : '2px solid transparent',
                      cursor: 'pointer',
                      transform: selectedColor === c ? 'scale(1.2)' : 'scale(1)',
                      transition: 'transform 0.1s',
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Display name */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 9, letterSpacing: 2, color: '#2a5a7a', marginBottom: 8 }}>
              DISPLAY NAME (optional)
            </div>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="How you'll appear on the map..."
              maxLength={24}
              style={{
                width: '100%', background: '#0a1828', border: '1px solid #1a3a5a',
                color: '#d0e4f0', fontFamily: 'monospace', fontSize: 12,
                padding: '10px 12px', outline: 'none',
              }}
            />
          </div>

          {/* Wallet connection status */}
          {!connected && (
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#8a6a3a', padding: '10px 12px', background: 'rgba(200,100,0,0.08)', border: '1px solid #3a2a1a', marginBottom: 16 }}>
              Connect your Phantom or Solflare wallet to purchase
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#e8440a', padding: '10px 12px', background: 'rgba(232,68,10,0.08)', border: '1px solid #3a1a0a', marginBottom: 16 }}>
              {errorMsg}
            </div>
          )}

          {/* Success */}
          {status === 'success' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚔️</div>
              <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 24, letterSpacing: 4, color: '#e8440a' }}>TERRITORY CLAIMED</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#4a7a9a', marginTop: 8 }}>Your mark is on the world map</div>
            </div>
          )}

          {/* Purchase button */}
          {status !== 'success' && (
            <button
              onClick={handlePurchase}
              disabled={status === 'paying' || status === 'verifying'}
              style={{
                width: '100%', background: status === 'idle' ? '#e8440a' : '#3a2a1a',
                border: 'none', color: '#fff',
                fontFamily: 'Bebas Neue,sans-serif', fontSize: 16, letterSpacing: 3,
                padding: '16px 0', cursor: status === 'idle' ? 'pointer' : 'wait',
                opacity: (status === 'paying' || status === 'verifying') ? 0.7 : 1,
              }}
            >
              {!connected
                ? 'CONNECT WALLET →'
                : status === 'paying'
                  ? 'CONFIRM IN WALLET...'
                  : status === 'verifying'
                    ? 'VERIFYING TRANSACTION...'
                    : `CLAIM ${title.toUpperCase()} →`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
