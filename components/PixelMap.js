import { useEffect, useRef, useState } from 'react'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice } from '../lib/solana'
import { GRID_COLS, GRID_ROWS } from '../lib/pixels'

const OCEAN_COLOR = '#060e1c'
const LAND_COLOR  = '#1a2d3f'
const BORDER_COLOR = 'rgba(70, 130, 190, 0.6)'
const GRID_COLOR  = 'rgba(60, 130, 220, 0.3)'
const CLAIM_COLOR = '#e8440a'

export default function PixelMap({ pixels, onPurchaseIntent, highlightedPixelId }) {
  const canvasRef = useRef(null)
  const baseRef   = useRef(null)
  const worldRef  = useRef(null)
  const hitRef    = useRef(null)  // Uint16Array: per CSS-pixel country index (0=ocean)
  const view      = useRef({ zoom: 1, panX: 0, panY: 0 })
  const drag      = useRef({ on: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false })
  const sz        = useRef({ w: 800, h: 600, dpr: 1 })
  const raf       = useRef(null)
  const hoverTm   = useRef(null)
  const [popup,   setPopup]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = canvasRef.current?.parentElement
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600
    sz.current = { w, h, dpr }
    canvasRef.current.width  = w * dpr
    canvasRef.current.height = h * dpr
    canvasRef.current.style.width  = w + 'px'
    canvasRef.current.style.height = h + 'px'

    fetch('/worldmap.json').then(r => r.json()).then(data => {
      worldRef.current = data
      buildAll(w, h, dpr, data)
      setLoading(false)
      draw()
    })

    const onResize = () => {
      const dpr = window.devicePixelRatio || 1
      const nw = el.clientWidth, nh = el.clientHeight
      sz.current = { w: nw, h: nh, dpr }
      canvasRef.current.width  = nw * dpr
      canvasRef.current.height = nh * dpr
      canvasRef.current.style.width  = nw + 'px'
      canvasRef.current.style.height = nh + 'px'
      if (worldRef.current) buildAll(nw, nh, dpr, worldRef.current)
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => { if (!loading) draw() }, [pixels, highlightedPixelId, loading])

  // ── Parse path string → rings of [x,y] in grid coords ───────────────────
  function parsePath(d) {
    const rings = []
    for (const seg of d.split('Z')) {
      if (!seg.trim()) continue
      const pts = seg.replace(/^M/, '').split(/[ML]/).map(s => {
        const [x, y] = s.split(',').map(Number)
        return [x, y]
      }).filter(p => !isNaN(p[0]) && !isNaN(p[1]))
      if (pts.length >= 3) rings.push(pts)
    }
    return rings
  }

  // ── Scale grid coords to screen coords ───────────────────────────────────
  function scaleRings(rings, w, h, zoom, panX, panY) {
    const cols = worldRef.current.cols
    const rows = worldRef.current.rows
    return rings.map(ring => ring.map(([gx, gy]) => [
      gx / cols * w * zoom + panX,
      gy / rows * h * zoom + panY,
    ]))
  }

  function drawRings(ctx, rings) {
    ctx.beginPath()
    for (const ring of rings) {
      if (!ring.length) continue
      ctx.moveTo(ring[0][0], ring[0][1])
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1])
      ctx.closePath()
    }
  }

  // ── Build base map + hitmap once ─────────────────────────────────────────
  function buildAll(w, h, dpr, world) {
    const pw = w * dpr, ph = h * dpr

    // 1. Base canvas (hi-res)
    const base = document.createElement('canvas')
    base.width = pw; base.height = ph
    const ctx = base.getContext('2d')

    // Ocean background
    ctx.fillStyle = OCEAN_COLOR
    ctx.fillRect(0, 0, pw, ph)

    // Ocean grid (subtle)
    ctx.strokeStyle = 'rgba(8,28,58,0.7)'
    ctx.lineWidth = 0.5 * dpr
    for (let x = 0; x < pw; x += 80 * dpr) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ph); ctx.stroke() }
    for (let y = 0; y < ph; y += 60 * dpr) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(pw,y); ctx.stroke() }

    // All countries — uniform land color, clipped to their shapes
    for (const country of world.countries) {
      const rings = parsePath(country.p)
      const scaled = rings.map(ring => ring.map(([gx, gy]) => [
        gx / world.cols * pw,
        gy / world.rows * ph,
      ]))
      ctx.fillStyle = LAND_COLOR
      ctx.strokeStyle = 'transparent'
      drawRings(ctx, scaled)
      ctx.fill()
    }

    // Borders on top
    ctx.strokeStyle = BORDER_COLOR
    ctx.lineWidth = 0.7 * dpr
    for (const country of world.countries) {
      const rings = parsePath(country.p)
      const scaled = rings.map(ring => ring.map(([gx, gy]) => [
        gx / world.cols * pw,
        gy / world.rows * ph,
      ]))
      drawRings(ctx, scaled)
      ctx.stroke()
    }

    baseRef.current = base

    // 2. Hitmap at CSS resolution (country index per pixel, 0=ocean)
    const hit = document.createElement('canvas')
    hit.width = w; hit.height = h
    const hctx = hit.getContext('2d')

    // Each country gets a unique color encoding its 1-based index
    world.countries.forEach((country, idx) => {
      const r = (idx + 1) & 0xff
      const g = ((idx + 1) >> 8) & 0xff
      hctx.fillStyle = `rgb(${r},${g},0)`
      hctx.strokeStyle = `rgb(${r},${g},0)`
      hctx.lineWidth = 1.5 // slightly wider for coast coverage
      const rings = parsePath(country.p)
      const scaled = rings.map(ring => ring.map(([gx, gy]) => [
        gx / world.cols * w,
        gy / world.rows * h,
      ]))
      drawRings(hctx, scaled)
      hctx.fill()
      hctx.stroke()
    })

    const imgData = hctx.getImageData(0, 0, w, h).data
    const hitArr = new Uint16Array(w * h)
    for (let i = 0; i < w * h; i++) {
      hitArr[i] = imgData[i * 4] + (imgData[i * 4 + 1] << 8) // decode index
    }
    hitRef.current = { data: hitArr, w, h }
  }

  // ── Hit test ──────────────────────────────────────────────────────────────
  function getCountryIdx(sx, sy) {
    const hit = hitRef.current
    if (!hit) return -1
    const { zoom, panX, panY } = view.current
    const bx = Math.round((sx - panX) / zoom)
    const by = Math.round((sy - panY) / zoom)
    if (bx < 0 || bx >= hit.w || by < 0 || by >= hit.h) return -1
    return hit.data[by * hit.w + bx] - 1  // -1 = ocean
  }

  function screenToPixelId(sx, sy) {
    const { w, h } = sz.current
    const { zoom, panX, panY } = view.current
    const bx = (sx - panX) / zoom
    const by = (sy - panY) / zoom
    const col = Math.floor(bx / w * GRID_COLS)
    const row = Math.floor(by / h * GRID_ROWS)
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null
    return row * GRID_COLS + col
  }

  function isLandPixel(pixelId) {
    const hit = hitRef.current
    if (!hit) return false
    const { w, h } = sz.current
    const col = pixelId % GRID_COLS
    const row = Math.floor(pixelId / GRID_COLS)
    const sx = Math.round(col / GRID_COLS * w + 0.5 / GRID_COLS * w)
    const sy = Math.round(row / GRID_ROWS * h + 0.5 / GRID_ROWS * h)
    if (sx < 0 || sx >= hit.w || sy < 0 || sy >= hit.h) return false
    return hit.data[sy * hit.w + sx] > 0
  }

  function getCountryPixels(countryName) {
    const world = worldRef.current
    const hit = hitRef.current
    if (!world || !hit) return []
    const idx = world.countries.findIndex(c => c.n === countryName) + 1
    if (idx === 0) return []
    const { w, h } = sz.current
    const result = []
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const sx = Math.round((col + 0.5) / GRID_COLS * w)
        const sy = Math.round((row + 0.5) / GRID_ROWS * h)
        if (sx >= hit.w || sy >= hit.h) continue
        if (hit.data[sy * hit.w + sx] === idx) result.push(row * GRID_COLS + col)
      }
    }
    return result
  }

  function getSubregionPixels(subregion) {
    const world = worldRef.current
    const hit = hitRef.current
    if (!world || !hit) return []
    const idxSet = new Set(
      world.countries.map((c, i) => c.s === subregion ? i + 1 : 0).filter(Boolean)
    )
    const { w, h } = sz.current
    const result = []
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const sx = Math.round((col + 0.5) / GRID_COLS * w)
        const sy = Math.round((row + 0.5) / GRID_ROWS * h)
        if (sx >= hit.w || sy >= hit.h) continue
        if (idxSet.has(hit.data[sy * hit.w + sx])) result.push(row * GRID_COLS + col)
      }
    }
    return result
  }

  function calcPrice(pixelIds) {
    let t = 0
    for (const pid of pixelIds) {
      const p = pixels.get(pid)
      t += p?.current_price_sol ? calculateNextPrice(p.current_price_sol) : BASE_PIXEL_PRICE_SOL
    }
    return parseFloat(t.toFixed(4))
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function draw() {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !baseRef.current || !worldRef.current) return
      const { w, h, dpr } = sz.current
      const { zoom, panX, panY } = view.current
      const ctx = canvas.getContext('2d')
      const world = worldRef.current

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = OCEAN_COLOR
      ctx.fillRect(0, 0, w, h)

      // Base map
      ctx.save()
      ctx.translate(panX, panY)
      ctx.scale(zoom, zoom)
      ctx.drawImage(baseRef.current, 0, 0, w, h)
      ctx.restore()

      // Pixel grid + claimed — clipped to land shapes
      const cw = w * zoom / GRID_COLS
      const ch = h * zoom / GRID_ROWS

      if (cw > 3) {
        // Build land clip path
        ctx.save()
        ctx.translate(panX, panY)
        ctx.scale(zoom, zoom)
        ctx.beginPath()
        for (const country of world.countries) {
          const rings = parsePath(country.p)
          for (const ring of rings) {
            if (!ring.length) continue
            ctx.moveTo(ring[0][0] / world.cols * w, ring[0][1] / world.rows * h)
            for (let i = 1; i < ring.length; i++) {
              ctx.lineTo(ring[i][0] / world.cols * w, ring[i][1] / world.rows * h)
            }
            ctx.closePath()
          }
        }
        ctx.clip()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        // Grid
        if (cw > 5) {
          const sc = Math.max(0, Math.floor(-panX / cw))
          const ec = Math.min(GRID_COLS, Math.ceil((w - panX) / cw))
          const sr = Math.max(0, Math.floor(-panY / ch))
          const er = Math.min(GRID_ROWS, Math.ceil((h - panY) / ch))
          ctx.strokeStyle = GRID_COLOR
          ctx.lineWidth = 0.4
          for (let c = sc; c <= ec; c++) {
            const x = panX + c * cw
            ctx.beginPath(); ctx.moveTo(x, panY + sr * ch); ctx.lineTo(x, panY + er * ch); ctx.stroke()
          }
          for (let r = sr; r <= er; r++) {
            const y = panY + r * ch
            ctx.beginPath(); ctx.moveTo(panX + sc * cw, y); ctx.lineTo(panX + ec * cw, y); ctx.stroke()
          }
        }

        // Claimed pixels
        pixels.forEach((pixel, id) => {
          if (!pixel.owner_wallet) return
          const col = id % GRID_COLS, row = Math.floor(id / GRID_COLS)
          const x = panX + col * cw, y = panY + row * ch
          if (x + cw < 0 || x > w || y + ch < 0 || y > h) return
          ctx.shadowColor = pixel.color || CLAIM_COLOR
          ctx.shadowBlur = zoom > 3 ? 8 : 4
          ctx.fillStyle = pixel.color || CLAIM_COLOR
          ctx.globalAlpha = 0.85
          ctx.fillRect(x, y, cw, ch)
          ctx.globalAlpha = 1
          ctx.shadowBlur = 0
        })

        ctx.restore()
      }

      // Highlighted pixel
      if (highlightedPixelId != null) {
        const col = highlightedPixelId % GRID_COLS
        const row = Math.floor(highlightedPixelId / GRID_COLS)
        ctx.strokeStyle = CLAIM_COLOR
        ctx.lineWidth = 2
        ctx.strokeRect(panX + col * cw, panY + row * ch, cw, ch)
      }
    })
  }

  // ── Mouse events ──────────────────────────────────────────────────────────
  function onDown(e) {
    clearTimeout(hoverTm.current)
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
    const ci = getCountryIdx(sx, sy)
    canvasRef.current.style.cursor = ci >= 0 ? 'crosshair' : 'not-allowed'

    clearTimeout(hoverTm.current)
    if (ci >= 0) {
      hoverTm.current = setTimeout(() => {
        const world = worldRef.current
        if (!world) return
        const country = world.countries[ci]
        const pid = screenToPixelId(sx, sy)
        if (pid === null) return
        const countryPids = getCountryPixels(country.n)
        const subregionPids = getSubregionPixels(country.s)
        setPopup({
          x: e.clientX, y: e.clientY,
          pixelId: pid, pixel: pixels.get(pid) || null,
          country: country.n, subregion: country.s, continent: country.k,
          countryPids, subregionPids,
          pixelPrice: pixels.get(pid)?.current_price_sol
            ? calculateNextPrice(pixels.get(pid).current_price_sol)
            : BASE_PIXEL_PRICE_SOL,
          countryPrice: calcPrice(countryPids),
          subregionPrice: calcPrice(subregionPids),
        })
      }, 400)
    } else {
      setPopup(null)
    }
  }

  function onUp() { drag.current.on = false }
  function onLeave() { drag.current.on = false; clearTimeout(hoverTm.current) }
  function onClick(e) { if (drag.current.moved) { drag.current.moved = false } }

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
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onMouseLeave={onLeave} onClick={onClick} onWheel={onWheel}
      />

      {loading && (
        <div style={{ position: 'absolute', inset: 0, background: OCEAN_COLOR, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 14, letterSpacing: 8, color: '#1a4a6a' }}>LOADING MAP</div>
          <div style={{ width: 120, height: 1, background: '#0a2040', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', width: '40%', height: '100%', background: CLAIM_COLOR, animation: 'slide 1.2s ease-in-out infinite' }} />
          </div>
        </div>
      )}

      {popup && (
        <div
          onMouseEnter={() => clearTimeout(hoverTm.current)}
          onMouseLeave={() => setPopup(null)}
          style={{
            position: 'fixed',
            left: Math.min(popup.x + 16, window.innerWidth - 255),
            top: Math.max(popup.y - 20, 60),
            background: '#080f1e',
            border: '1px solid #1a3a5a',
            borderTop: '2px solid ' + CLAIM_COLOR,
            width: 240,
            boxShadow: '0 12px 40px rgba(0,0,0,0.95)',
            zIndex: 9999,
            pointerEvents: 'auto',
          }}
        >
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #0e2a42' }}>
            <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 8, letterSpacing: 2, color: '#2a5a7a' }}>
              #{popup.pixelId} · {popup.subregion}
            </div>
            <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 20, letterSpacing: 3, color: '#d0e4f0', lineHeight: 1.1, marginTop: 2 }}>
              {popup.country}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: popup.pixel?.owner_wallet ? '#5a8aaa' : '#3a8a5a', marginTop: 2 }}>
              {popup.pixel?.owner_wallet
                ? `Owned · ${popup.pixel.owner_name || popup.pixel.owner_wallet.slice(0, 8) + '...'}`
                : 'Unclaimed territory'}
            </div>
          </div>

          <div style={{ padding: '8px 14px 12px' }}>
            <PurchaseRow label="This Pixel" sub="Single pixel" price={popup.pixelPrice}
              onClick={() => { onPurchaseIntent({ type: 'pixel', pixelId: popup.pixelId, pixel: popup.pixel, priceSol: popup.pixelPrice }); setPopup(null) }} />
            <PurchaseRow label={popup.country} sub={`${popup.countryPids.length.toLocaleString()} pixels`} price={popup.countryPrice}
              onClick={() => { onPurchaseIntent({ type: 'country', country: popup.country, pixelIds: popup.countryPids, priceSol: popup.countryPrice }); setPopup(null) }} />
            <PurchaseRow label={popup.subregion} sub={`${popup.subregionPids.length.toLocaleString()} pixels`} price={popup.subregionPrice}
              onClick={() => { onPurchaseIntent({ type: 'subregion', subregion: popup.subregion, pixelIds: popup.subregionPids, priceSol: popup.subregionPrice }); setPopup(null) }} last />
          </div>
        </div>
      )}
    </div>
  )
}

function PurchaseRow({ label, sub, price, onClick, last }) {
  const [hover, setHover] = useState(false)
  return (
    <div style={{ marginBottom: last ? 0 : 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 9, color: '#4a8ab0', letterSpacing: 1 }}>
            {label.length > 22 ? label.slice(0, 22) + '…' : label}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#1e4a6a' }}>{sub}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 15, color: CLAIM_COLOR, lineHeight: 1 }}>
            {price.toFixed(price > 10 ? 1 : 4)} SOL
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#1e4a6a' }}>${(price * 150).toFixed(price > 10 ? 0 : 2)}</div>
        </div>
      </div>
      <button
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onClick={onClick}
        style={{
          width: '100%', background: hover ? '#c83a08' : CLAIM_COLOR,
          border: 'none', color: '#fff',
          fontFamily: 'Bebas Neue,sans-serif', fontSize: 12, letterSpacing: 2,
          padding: '6px 0', cursor: 'pointer', transition: 'background 0.15s',
        }}
      >CLAIM →</button>
    </div>
  )
}
