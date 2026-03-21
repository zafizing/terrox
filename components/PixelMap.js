import { useEffect, useRef, useState } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT } from '../lib/pixels'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice } from '../lib/solana'

function lngToX(lng, w) { return ((lng + 180) / 360) * w }
function latToY(lat, h) {
  const r = Math.log(Math.tan((90 + lat) * Math.PI / 360))
  const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
  return ((maxR - r) / (2 * maxR)) * h
}

function paintGeo(ctx, geo, w, h) {
  for (const f of geo.features) {
    const g = f.geometry
    if (!g) continue
    const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const p of ps) {
      ctx.beginPath()
      for (const ring of p) {
        let first = true
        for (const [lng, lat] of ring) {
          const x = lngToX(lng, w), y = latToY(lat, h)
          first ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          first = false
        }
        ctx.closePath()
      }
      ctx.fill()
      ctx.stroke()
    }
  }
}

export default function PixelMap({ pixels, onPixelClick, highlightedPixelId }) {
  const canvasRef = useRef(null)
  const baseRef = useRef(null)     // high-res offscreen canvas
  const maskRef = useRef(null)     // CSS-res land mask
  const landPathRef = useRef(null) // Path2D in CSS coords
  const geoRef = useRef(null)
  const view = useRef({ zoom: 1, panX: 0, panY: 0 })
  const drag = useRef({ on: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false })
  const size = useRef({ w: 800, h: 600, dpr: 1 })
  const raf = useRef(null)
  const hoverTimer = useRef(null)
  const [popup, setPopup] = useState(null)

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

    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(r => r.json())
      .then(geo => { geoRef.current = geo; buildBase(w, h, dpr, geo); draw() })
      .catch(() => { buildBase(w, h, dpr, null); draw() })

    const onResize = () => {
      const dpr = window.devicePixelRatio || 1
      const nw = el.clientWidth, nh = el.clientHeight
      size.current = { w: nw, h: nh, dpr }
      canvasRef.current.width = nw * dpr
      canvasRef.current.height = nh * dpr
      canvasRef.current.style.width = nw + 'px'
      canvasRef.current.style.height = nh + 'px'
      if (geoRef.current) buildBase(nw, nh, dpr, geoRef.current)
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => { draw() }, [pixels, highlightedPixelId])

  function buildBase(w, h, dpr, geo) {
    const pw = w * dpr, ph = h * dpr

    // High-res visible map canvas
    const c = document.createElement('canvas')
    c.width = pw; c.height = ph
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#051525'
    ctx.fillRect(0, 0, pw, ph)
    if (geo) {
      ctx.fillStyle = '#1e3a52'
      ctx.strokeStyle = '#4a8ab0'
      ctx.lineWidth = 0.5 * dpr
      paintGeo(ctx, geo, pw, ph)
    }
    baseRef.current = c

    // CSS-res land mask for hit test
    const m = document.createElement('canvas')
    m.width = w; m.height = h
    const mctx = m.getContext('2d')
    mctx.fillStyle = '#000'
    mctx.fillRect(0, 0, w, h)
    if (geo) {
      mctx.fillStyle = '#fff'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 1
      paintGeo(mctx, geo, w, h)
    }
    maskRef.current = { data: mctx.getImageData(0, 0, w, h).data, w, h }

    // Path2D in CSS coords for clipping
    if (geo) {
      const path = new Path2D()
      for (const f of geo.features) {
        const g = f.geometry
        if (!g) continue
        const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
        for (const p of ps) {
          for (const ring of p) {
            let first = true
            for (const [lng, lat] of ring) {
              const x = lngToX(lng, w), y = latToY(lat, h)
              first ? path.moveTo(x, y) : path.lineTo(x, y)
              first = false
            }
            path.closePath()
          }
        }
      }
      landPathRef.current = path
    }
  }

  function isLand(sx, sy) {
    const m = maskRef.current
    if (!m) return true
    const { zoom, panX, panY } = view.current
    const bx = Math.round((sx - panX) / zoom)
    const by = Math.round((sy - panY) / zoom)
    if (bx < 0 || bx >= m.w || by < 0 || by >= m.h) return false
    return m.data[(by * m.w + bx) * 4] > 128
  }

  function screenToPixelId(sx, sy) {
    const { w, h } = size.current
    const { zoom, panX, panY } = view.current
    const nx = (sx - panX) / zoom, ny = (sy - panY) / zoom
    const lng = (nx / w) * 360 - 180
    const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
    const lat = (Math.atan(Math.exp(maxR - (ny / h) * 2 * maxR)) * 360 / Math.PI) - 90
    const col = Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH)
    const row = Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT)
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null
    return row * GRID_COLS + col
  }

  function draw() {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !baseRef.current) return
      const { w, h, dpr } = size.current
      const { zoom, panX, panY } = view.current
      const ctx = canvas.getContext('2d')

      // Scale context for DPR — everything after this is in CSS pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Ocean
      ctx.fillStyle = '#051525'
      ctx.fillRect(0, 0, w, h)

      // Base map: drawn at DPR-aware size, displayed at CSS size
      ctx.save()
      ctx.translate(panX, panY)
      ctx.scale(zoom, zoom)
      // baseRef is at physical px — scale it down by dpr when drawing
      ctx.drawImage(baseRef.current, 0, 0, w, h)
      ctx.restore()

      // Grid + pixels clipped to land
      const ox = lngToX(WORLD_BOUNDS.minLng, w) * zoom + panX
      const oy = latToY(WORLD_BOUNDS.maxLat, h) * zoom + panY
      const ex = lngToX(WORLD_BOUNDS.maxLng, w) * zoom + panX
      const ey = latToY(WORLD_BOUNDS.minLat, h) * zoom + panY
      const cw = (ex - ox) / GRID_COLS
      const ch = (ey - oy) / GRID_ROWS

      if (landPathRef.current) {
        ctx.save()
        ctx.translate(panX, panY)
        ctx.scale(zoom, zoom)
        ctx.clip(landPathRef.current)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // back to CSS coords with DPR

        // Grid
        if (cw > 4) {
          ctx.strokeStyle = 'rgba(80,160,255,0.35)'
          ctx.lineWidth = 0.4
          for (let col = 0; col <= GRID_COLS; col++) {
            const x = ox + col * cw
            if (x < -10 || x > w + 10) continue
            ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, ey); ctx.stroke()
          }
          for (let row = 0; row <= GRID_ROWS; row++) {
            const y = oy + row * ch
            if (y < -10 || y > h + 10) continue
            ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ex, y); ctx.stroke()
          }
        }

        // Claimed pixels
        pixels.forEach((pixel, id) => {
          if (!pixel.owner_wallet) return
          const { col, row } = idToGrid(id)
          const x = ox + col * cw, y = oy + row * ch
          if (x + cw < 0 || x > w || y + ch < 0 || y > h) return
          ctx.fillStyle = pixel.color || '#e8440a'
          ctx.globalAlpha = 0.85
          ctx.fillRect(x, y, cw, ch)
          ctx.globalAlpha = 1
        })

        ctx.restore()
      }

      // Highlighted pixel
      if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
        const { col, row } = idToGrid(highlightedPixelId)
        ctx.strokeStyle = '#e8440a'
        ctx.lineWidth = 2
        ctx.strokeRect(ox + col * cw, oy + row * ch, cw, ch)
      }
    })
  }

  function onDown(e) {
    clearTimeout(hoverTimer.current); setPopup(null)
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
      setPopup(null)
      draw()
      return
    }
    const r = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    const land = isLand(sx, sy)
    canvasRef.current.style.cursor = land ? 'crosshair' : 'not-allowed'
    clearTimeout(hoverTimer.current)
    if (land) {
      hoverTimer.current = setTimeout(() => {
        const pid = screenToPixelId(sx, sy)
        if (pid === null) return
        setPopup({ x: e.clientX, y: e.clientY, pixelId: pid, pixel: pixels.get(pid) || null })
      }, 500)
    } else {
      setPopup(null)
    }
  }

  function onUp() { drag.current.on = false }
  function onLeave() { drag.current.on = false; clearTimeout(hoverTimer.current); setPopup(null) }

  function onClick(e) {
    if (drag.current.moved) { drag.current.moved = false; return }
    const r = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    if (!isLand(sx, sy)) return
    const pid = screenToPixelId(sx, sy)
    if (pid === null) return
    const col = pid % GRID_COLS, row = Math.floor(pid / GRID_COLS)
    const { lat, lng } = gridToLatLng(col, row)
    onPixelClick(pid, lat, lng)
    setPopup(null)
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

  const popupPrice = popup
    ? popup.pixel?.current_price_sol ? calculateNextPrice(popup.pixel.current_price_sol) : BASE_PIXEL_PRICE_SOL
    : 0

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', background: '#051525' }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onLeave}
        onClick={onClick}
        onWheel={onWheel}
      />
      {popup && (
        <div style={{
          position: 'fixed',
          left: Math.min(popup.x + 12, window.innerWidth - 200),
          top: Math.max(popup.y - 110, 60),
          background: '#0a1f3a',
          border: '1px solid #1a4a6a',
          borderTop: '2px solid #e8440a',
          padding: '10px 14px',
          zIndex: 9999,
          minWidth: 170,
          boxShadow: '0 8px 32px rgba(0,0,0,0.9)',
          pointerEvents: 'auto',
        }}>
          <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 9, letterSpacing: 2, color: '#2a6a9a', marginBottom: 4 }}>
            PIXEL #{popup.pixelId}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: popup.pixel?.owner_wallet ? '#5a9aaa' : '#4a8a5a', marginBottom: 6 }}>
            {popup.pixel?.owner_wallet
              ? (popup.pixel.owner_name || popup.pixel.owner_wallet.slice(0, 10) + '...')
              : 'UNCLAIMED'}
          </div>
          <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 24, letterSpacing: 2, color: '#e8440a', lineHeight: 1 }}>
            {popupPrice.toFixed(4)} SOL
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#2a5a7a', marginBottom: 10 }}>
            ≈ ${(popupPrice * 150).toFixed(2)} USD
          </div>
          <button
            onClick={e => {
              e.stopPropagation()
              const col = popup.pixelId % GRID_COLS, row = Math.floor(popup.pixelId / GRID_COLS)
              const { lat, lng } = gridToLatLng(col, row)
              onPixelClick(popup.pixelId, lat, lng)
              setPopup(null)
            }}
            style={{
              width: '100%', background: '#e8440a', border: 'none', color: '#fff',
              fontFamily: 'Bebas Neue,sans-serif', fontSize: 14, letterSpacing: 2,
              padding: '8px 0', cursor: 'pointer',
            }}
          >
            CLAIM TERRITORY →
          </button>
        </div>
      )}
    </div>
  )
}
