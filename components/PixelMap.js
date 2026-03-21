import { useEffect, useRef, useState } from 'react'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice } from '../lib/solana'

// Subregion colors for map rendering
const SUBREGION_COLORS = {
  'Northern Africa':        '#2a3a28',
  'Western Africa':         '#283a28',
  'Middle Africa':          '#253828',
  'Eastern Africa':         '#283528',
  'Southern Africa':        '#263530',
  'Northern America':       '#28303a',
  'Central America':        '#28352a',
  'Caribbean':              '#2a3035',
  'South America':          '#253035',
  'Western Asia':           '#3a3028',
  'Central Asia':           '#382e28',
  'Southern Asia':          '#352a28',
  'Eastern Asia':           '#302835',
  'South-eastern Asia':     '#2a2835',
  'Northern Europe':        '#283038',
  'Western Europe':         '#283238',
  'Southern Europe':        '#28303a',
  'Eastern Europe':         '#252e38',
  'Australia and New Zealand': '#302838',
  'Melanesia':              '#2a2a35',
  'Polynesia':              '#282a35',
  'Micronesia':             '#262835',
}

const OCEAN_COLOR = '#051525'
const OCEAN_GRID = 'rgba(10, 40, 80, 0.4)'
const LAND_BORDER = 'rgba(80, 140, 200, 0.5)'
const GRID_COLOR = 'rgba(80, 160, 255, 0.4)'
const HIGHLIGHT_COLOR = '#e8440a'

export default function PixelMap({ pixels, onPurchaseIntent, highlightedPixelId }) {
  const canvasRef = useRef(null)
  const worldRef = useRef(null)      // parsed worldmap.json
  const baseRef = useRef(null)       // pre-rendered offscreen canvas
  const view = useRef({ zoom: 1, panX: 0, panY: 0 })
  const drag = useRef({ on: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false })
  const size = useRef({ w: 800, h: 600, dpr: 1 })
  const raf = useRef(null)
  const hoverTimer = useRef(null)
  const [popup, setPopup] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = canvasRef.current?.parentElement
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600
    size.current = { w, h, dpr }
    canvasRef.current.width = w * dpr
    canvasRef.current.height = h * dpr
    canvasRef.current.style.width = w + 'px'
    canvasRef.current.style.height = h + 'px'

    // Load our pre-computed worldmap — no GeoJSON, instant lookup
    fetch('/worldmap.json')
      .then(r => r.json())
      .then(data => {
        worldRef.current = data
        buildBase(w, h, dpr, data)
        setLoading(false)
        draw()
      })

    const onResize = () => {
      const dpr = window.devicePixelRatio || 1
      const nw = el.clientWidth, nh = el.clientHeight
      size.current = { w: nw, h: nh, dpr }
      canvasRef.current.width = nw * dpr
      canvasRef.current.height = nh * dpr
      canvasRef.current.style.width = nw + 'px'
      canvasRef.current.style.height = nh + 'px'
      if (worldRef.current) buildBase(nw, nh, dpr, worldRef.current)
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => { if (!loading) draw() }, [pixels, highlightedPixelId, loading])

  // ── Build base map once ───────────────────────────────────────────────────
  function buildBase(w, h, dpr, world) {
    const pw = w * dpr, ph = h * dpr
    const { cols, rows, subregions, pixels: wPixels } = world

    const c = document.createElement('canvas')
    c.width = pw; c.height = ph
    const ctx = c.getContext('2d')

    // Ocean
    ctx.fillStyle = OCEAN_COLOR
    ctx.fillRect(0, 0, pw, ph)

    // Ocean grid lines
    ctx.strokeStyle = OCEAN_GRID
    ctx.lineWidth = 0.5
    for (let x = 0; x < pw; x += 60 * dpr) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ph); ctx.stroke()
    }
    for (let y = 0; y < ph; y += 60 * dpr) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke()
    }

    const cw = pw / cols
    const ch = ph / rows

    // Draw land pixels grouped by subregion color
    for (const [pidStr, [ci, si, ki]] of Object.entries(wPixels)) {
      const pid = parseInt(pidStr)
      const col = pid % cols
      const row = Math.floor(pid / cols)
      const x = col * cw, y = row * ch
      const subregion = subregions[si]
      ctx.fillStyle = SUBREGION_COLORS[subregion] || '#1e3a52'
      ctx.fillRect(x, y, cw + 0.5, ch + 0.5)
    }

    // Country borders — draw slightly brighter edge where neighbors differ
    ctx.strokeStyle = LAND_BORDER
    ctx.lineWidth = 0.5 * dpr
    for (const [pidStr, [ci, si, ki]] of Object.entries(wPixels)) {
      const pid = parseInt(pidStr)
      const col = pid % cols
      const row = Math.floor(pid / cols)
      const x = col * cw, y = row * ch
      // Check right neighbor
      const rightPid = pid + 1
      const bottomPid = pid + cols
      const right = col < cols - 1 ? wPixels[rightPid] : null
      const bottom = row < rows - 1 ? wPixels[bottomPid] : null
      if (right && right[0] !== ci) {
        ctx.beginPath(); ctx.moveTo(x + cw, y); ctx.lineTo(x + cw, y + ch); ctx.stroke()
      }
      if (bottom && bottom[0] !== ci) {
        ctx.beginPath(); ctx.moveTo(x, y + ch); ctx.lineTo(x + cw, y + ch); ctx.stroke()
      }
      // Coast border (land next to ocean)
      if (!right && col < cols - 1) {
        ctx.beginPath(); ctx.moveTo(x + cw, y); ctx.lineTo(x + cw, y + ch); ctx.stroke()
      }
      if (!bottom && row < rows - 1) {
        ctx.beginPath(); ctx.moveTo(x, y + ch); ctx.lineTo(x + cw, y + ch); ctx.stroke()
      }
    }

    baseRef.current = c
  }

  // ── Fast pixel lookup ─────────────────────────────────────────────────────
  function getPixelData(pixelId) {
    const w = worldRef.current
    if (!w) return null
    const entry = w.pixels[pixelId]
    if (!entry) return null
    return {
      country: w.countries[entry[0]],
      subregion: w.subregions[entry[1]],
      continent: w.continents[entry[2]],
    }
  }

  function isLandPixel(pixelId) {
    return !!worldRef.current?.pixels[pixelId]
  }

  function screenToPixelId(sx, sy) {
    const w = worldRef.current
    if (!w) return null
    const { w: sw, h: sh } = size.current
    const { zoom, panX, panY } = view.current
    const bx = (sx - panX) / zoom
    const by = (sy - panY) / zoom
    const col = Math.floor(bx / sw * w.cols)
    const row = Math.floor(by / sh * w.rows)
    if (col < 0 || col >= w.cols || row < 0 || row >= w.rows) return null
    return row * w.cols + col
  }

  function getSubregionPixels(subregion) {
    const w = worldRef.current
    if (!w) return []
    return Object.entries(w.pixels)
      .filter(([, [ci, si]]) => w.subregions[si] === subregion)
      .map(([pid]) => parseInt(pid))
  }

  function getContinentPixels(continent) {
    const w = worldRef.current
    if (!w) return []
    return Object.entries(w.pixels)
      .filter(([, [ci, si, ki]]) => w.continents[ki] === continent)
      .map(([pid]) => parseInt(pid))
  }

  function getCountryPixels(country) {
    const w = worldRef.current
    if (!w) return []
    return Object.entries(w.pixels)
      .filter(([, [ci]]) => w.countries[ci] === country)
      .map(([pid]) => parseInt(pid))
  }

  function calcBulkPrice(pixelIds) {
    let total = 0
    for (const pid of pixelIds) {
      const p = pixels.get(pid)
      total += p?.current_price_sol ? calculateNextPrice(p.current_price_sol) : BASE_PIXEL_PRICE_SOL
    }
    return parseFloat(total.toFixed(4))
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function draw() {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !baseRef.current || !worldRef.current) return
      const { w, h, dpr } = size.current
      const { zoom, panX, panY } = view.current
      const ctx = canvas.getContext('2d')
      const world = worldRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Ocean background
      ctx.fillStyle = OCEAN_COLOR
      ctx.fillRect(0, 0, w, h)

      // Base map
      ctx.save()
      ctx.translate(panX, panY); ctx.scale(zoom, zoom)
      ctx.drawImage(baseRef.current, 0, 0, w, h)
      ctx.restore()

      // Pixel grid + claimed pixels
      const cw = w * zoom / world.cols
      const ch = h * zoom / world.rows

      // Grid — only when zoomed enough
      if (cw > 4) {
        ctx.strokeStyle = GRID_COLOR
        ctx.lineWidth = 0.4
        const startCol = Math.max(0, Math.floor(-panX / cw))
        const endCol = Math.min(world.cols, Math.ceil((w - panX) / cw))
        const startRow = Math.max(0, Math.floor(-panY / ch))
        const endRow = Math.min(world.rows, Math.ceil((h - panY) / ch))

        for (let col = startCol; col <= endCol; col++) {
          const x = panX + col * cw
          ctx.beginPath(); ctx.moveTo(x, panY + startRow * ch); ctx.lineTo(x, panY + endRow * ch); ctx.stroke()
        }
        for (let row = startRow; row <= endRow; row++) {
          const y = panY + row * ch
          ctx.beginPath(); ctx.moveTo(panX + startCol * cw, y); ctx.lineTo(panX + endCol * cw, y); ctx.stroke()
        }
      }

      // Claimed pixels
      pixels.forEach((pixel, id) => {
        if (!pixel.owner_wallet || !isLandPixel(id)) return
        const col = id % world.cols
        const row = Math.floor(id / world.cols)
        const x = panX + col * cw, y = panY + row * ch
        if (x + cw < 0 || x > w || y + ch < 0 || y > h) return
        ctx.shadowColor = pixel.color || HIGHLIGHT_COLOR
        ctx.shadowBlur = zoom > 3 ? 8 : 4
        ctx.fillStyle = pixel.color || HIGHLIGHT_COLOR
        ctx.globalAlpha = 0.85
        ctx.fillRect(x, y, cw, ch)
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
      })

      // Highlighted pixel
      if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
        const col = highlightedPixelId % world.cols
        const row = Math.floor(highlightedPixelId / world.cols)
        ctx.strokeStyle = HIGHLIGHT_COLOR
        ctx.lineWidth = 2
        ctx.strokeRect(panX + col * cw, panY + row * ch, cw, ch)
      }
    })
  }

  // ── Mouse ─────────────────────────────────────────────────────────────────
  function onDown(e) {
    clearTimeout(hoverTimer.current)
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false }
  }

  function onMove(e) {
    const d = drag.current
    if (d.on) {
      if (Math.abs(e.clientX - d.sx) > 4 || Math.abs(e.clientY - d.sy) > 4) d.moved = true
      view.current.panX += e.clientX - d.lx
      view.current.panY += e.clientY - d.ly
      d.lx = e.clientX; d.ly = e.clientY
      canvasRef.current.style.cursor = 'grabbing'
      setPopup(null); draw(); return
    }
    const r = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    const pid = screenToPixelId(sx, sy)
    const land = pid !== null && isLandPixel(pid)
    canvasRef.current.style.cursor = land ? 'crosshair' : 'not-allowed'

    clearTimeout(hoverTimer.current)
    if (land) {
      hoverTimer.current = setTimeout(() => {
        const pdata = getPixelData(pid)
        if (!pdata) return
        const countryPixelIds = getCountryPixels(pdata.country)
        const subregionPixelIds = getSubregionPixels(pdata.subregion)
        setPopup({
          x: e.clientX, y: e.clientY,
          pixelId: pid,
          pixel: pixels.get(pid) || null,
          country: pdata.country,
          subregion: pdata.subregion,
          continent: pdata.continent,
          countryPixelIds,
          subregionPixelIds,
          countryPrice: calcBulkPrice(countryPixelIds),
          subregionPrice: calcBulkPrice(subregionPixelIds),
          pixelPrice: pixels.get(pid)?.current_price_sol
            ? calculateNextPrice(pixels.get(pid).current_price_sol)
            : BASE_PIXEL_PRICE_SOL,
        })
      }, 400)
    } else {
      setPopup(null)
    }
  }

  function onUp() { drag.current.on = false }
  function onLeave() {
    drag.current.on = false
    clearTimeout(hoverTimer.current)
    // Don't close popup on leave — let user click the popup buttons
  }

  function onClick(e) {
    if (drag.current.moved) { drag.current.moved = false; return }
    // Don't handle click if popup is open — let popup handle it
  }

  function onWheel(e) {
    e.preventDefault(); setPopup(null)
    const r = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const f = e.deltaY > 0 ? 0.85 : 1.18
    const nz = Math.min(Math.max(view.current.zoom * f, 0.8), 24)
    const s = nz / view.current.zoom
    view.current = { zoom: nz, panX: mx - s * (mx - view.current.panX), panY: my - s * (my - view.current.panY) }
    draw()
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', background: OCEAN_COLOR }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        onClick={onClick}
        onWheel={onWheel}
      />

      {loading && (
        <div style={{
          position: 'absolute', inset: 0, background: OCEAN_COLOR,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 14, letterSpacing: 8, color: '#1a4a6a' }}>
            LOADING WORLD MAP
          </div>
          <div style={{ width: 120, height: 1, background: '#0a2040', overflow: 'hidden', position: 'relative' }}>
            <div style={{
              position: 'absolute', width: '40%', height: '100%', background: '#e8440a',
              animation: 'slide 1.2s ease-in-out infinite',
            }} />
          </div>
        </div>
      )}

      {/* Hover Popup — stays visible when mouse moves to it */}
      {popup && (
        <div
          onMouseEnter={() => clearTimeout(hoverTimer.current)}
          onMouseLeave={() => setPopup(null)}
          style={{
            position: 'fixed',
            left: Math.min(popup.x + 16, window.innerWidth - 255),
            top: Math.max(popup.y - 20, 60),
            background: '#080f1e',
            border: '1px solid #1a3a5a',
            borderTop: '2px solid #e8440a',
            width: 240,
            boxShadow: '0 12px 40px rgba(0,0,0,0.95)',
            zIndex: 9999,
            pointerEvents: 'auto',
          }}
        >
          {/* Header */}
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #0e2a42' }}>
            <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 8, letterSpacing: 2, color: '#2a5a7a' }}>
              #{popup.pixelId} · {popup.subregion}
            </div>
            <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 18, letterSpacing: 3, color: '#d0e4f0', lineHeight: 1.1, marginTop: 2 }}>
              {popup.country}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: popup.pixel?.owner_wallet ? '#5a8aaa' : '#3a7a5a', marginTop: 2 }}>
              {popup.pixel?.owner_wallet
                ? `Owned · ${popup.pixel.owner_name || popup.pixel.owner_wallet.slice(0, 8) + '...'}`
                : 'Unclaimed territory'}
            </div>
          </div>

          {/* Purchase options */}
          <div style={{ padding: '8px 14px 12px' }}>
            <PurchaseRow
              label="This Pixel"
              sub="Single pixel"
              price={popup.pixelPrice}
              onClick={() => {
                onPurchaseIntent({ type: 'pixel', pixelId: popup.pixelId, pixel: popup.pixel, priceSol: popup.pixelPrice })
                setPopup(null)
              }}
            />
            <PurchaseRow
              label={popup.country}
              sub={`${popup.countryPixelIds.length.toLocaleString()} pixels`}
              price={popup.countryPrice}
              onClick={() => {
                onPurchaseIntent({ type: 'country', country: popup.country, pixelIds: popup.countryPixelIds, priceSol: popup.countryPrice })
                setPopup(null)
              }}
            />
            <PurchaseRow
              label={popup.subregion}
              sub={`${popup.subregionPixelIds.length.toLocaleString()} pixels`}
              price={popup.subregionPrice}
              onClick={() => {
                onPurchaseIntent({ type: 'subregion', subregion: popup.subregion, pixelIds: popup.subregionPixelIds, priceSol: popup.subregionPrice })
                setPopup(null)
              }}
              last
            />
          </div>
        </div>
      )}
    </div>
  )
}

function PurchaseRow({ label, sub, price, onClick, last }) {
  const [hover, setHover] = useState(false)
  return (
    <div style={{ marginBottom: last ? 0 : 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 9, color: '#4a8ab0', letterSpacing: 1 }}>
            {label.length > 20 ? label.slice(0, 20) + '…' : label}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#1e4a6a' }}>{sub}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 15, color: '#e8440a', lineHeight: 1 }}>
            {price.toFixed(price > 10 ? 1 : 4)} SOL
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#1e4a6a' }}>
            ${(price * 150).toFixed(price > 10 ? 0 : 2)}
          </div>
        </div>
      </div>
      <button
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={onClick}
        style={{
          width: '100%', background: hover ? '#c83a08' : '#e8440a',
          border: 'none', color: '#fff',
          fontFamily: 'Bebas Neue,sans-serif', fontSize: 12, letterSpacing: 2,
          padding: '6px 0', cursor: 'pointer', transition: 'background 0.15s',
        }}
      >
        CLAIM →
      </button>
    </div>
  )
}
