import { useEffect, useRef, useState } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT, getContinent } from '../lib/pixels'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice, solToUsd } from '../lib/solana'

// ── Projection ────────────────────────────────────────────────────────────────
const lngToX = (lng, w) => ((lng + 180) / 360) * w
const latToY = (lat, h) => {
  const r = Math.log(Math.tan((90 + lat) * Math.PI / 360))
  const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
  return ((maxR - r) / (2 * maxR)) * h
}

function paintGeo(ctx, geo, w, h) {
  for (const f of geo.features) {
    const g = f.geometry
    if (!g) continue
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const poly of polys) {
      ctx.beginPath()
      for (const ring of poly) {
        let first = true
        for (const [lng, lat] of ring) {
          first ? ctx.moveTo(lngToX(lng, w), latToY(lat, h)) : ctx.lineTo(lngToX(lng, w), latToY(lat, h))
          first = false
        }
        ctx.closePath()
      }
      ctx.fill()
      ctx.stroke()
    }
  }
}

export default function PixelMap({ pixels, onPurchaseIntent, highlightedPixelId }) {
  const canvasRef = useRef(null)
  const baseRef = useRef(null)
  const maskRef = useRef(null)
  const landPathRef = useRef(null)
  const countryMapRef = useRef(null) // pixelId → countryName
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
    const init = () => {
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
    }
    init()
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
    // Hi-res map
    const c = document.createElement('canvas')
    c.width = pw; c.height = ph
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#051525'; ctx.fillRect(0, 0, pw, ph)
    if (geo) {
      ctx.fillStyle = '#1e3a52'; ctx.strokeStyle = '#4a8ab0'; ctx.lineWidth = 0.6 * dpr
      paintGeo(ctx, geo, pw, ph)
    }
    baseRef.current = c

    // Land mask (CSS res)
    const m = document.createElement('canvas')
    m.width = w; m.height = h
    const mctx = m.getContext('2d')
    mctx.fillStyle = '#000'; mctx.fillRect(0, 0, w, h)
    if (geo) { mctx.fillStyle = '#fff'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 1; paintGeo(mctx, geo, w, h) }
    maskRef.current = { data: mctx.getImageData(0, 0, w, h).data, w, h }

    // Path2D for clipping (CSS coords)
    if (geo) {
      const path = new Path2D()
      for (const f of geo.features) {
        const g = f.geometry
        if (!g) continue
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
        for (const poly of polys) {
          for (const ring of poly) {
            let first = true
            for (const [lng, lat] of ring) {
              first ? path.moveTo(lngToX(lng, w), latToY(lat, h)) : path.lineTo(lngToX(lng, w), latToY(lat, h))
              first = false
            }
            path.closePath()
          }
        }
      }
      landPathRef.current = path
    }

    // Build country map: pixelId → country name
    if (geo) buildCountryMap(w, h, geo)
  }

  function buildCountryMap(w, h, geo) {
    // For each country, check which pixels fall inside it
    // We use a separate offscreen canvas per country for accuracy
    const map = new Map()
    for (const f of geo.features) {
      const name = f.properties?.ADMIN || f.properties?.name || 'Unknown'
      const g = f.geometry
      if (!g) continue
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []

      // Build bounding box first for efficiency
      let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90
      for (const poly of polys) {
        for (const ring of poly) {
          for (const [lng, lat] of ring) {
            if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng
            if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
          }
        }
      }

      // Find pixel range
      const colMin = Math.max(0, Math.floor((minLng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH))
      const colMax = Math.min(GRID_COLS - 1, Math.ceil((maxLng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH))
      const rowMin = Math.max(0, Math.floor((WORLD_BOUNDS.maxLat - maxLat) / PIXEL_HEIGHT))
      const rowMax = Math.min(GRID_ROWS - 1, Math.ceil((WORLD_BOUNDS.maxLat - minLat) / PIXEL_HEIGHT))

      // Use canvas point-in-path for accuracy
      const off = document.createElement('canvas')
      off.width = w; off.height = h
      const octx = off.getContext('2d')
      octx.fillStyle = '#fff'
      for (const poly of polys) {
        octx.beginPath()
        for (const ring of poly) {
          let first = true
          for (const [lng, lat] of ring) {
            first ? octx.moveTo(lngToX(lng, w), latToY(lat, h)) : octx.lineTo(lngToX(lng, w), latToY(lat, h))
            first = false
          }
          octx.closePath()
        }
        octx.fill()
      }
      const imgData = octx.getImageData(0, 0, w, h).data

      for (let row = rowMin; row <= rowMax; row++) {
        for (let col = colMin; col <= colMax; col++) {
          const { lat, lng } = gridToLatLng(col, row)
          const px = Math.round(lngToX(lng, w))
          const py = Math.round(latToY(lat, h))
          if (px < 0 || px >= w || py < 0 || py >= h) continue
          if (imgData[(py * w + px) * 4] > 128) {
            map.set(row * GRID_COLS + col, name)
          }
        }
      }
    }
    countryMapRef.current = map
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

  function getPixelCountry(pixelId) {
    return countryMapRef.current?.get(pixelId) || null
  }

  function getCountryPixels(countryName) {
    if (!countryMapRef.current) return []
    const result = []
    for (const [pid, name] of countryMapRef.current.entries()) {
      if (name === countryName) result.push(pid)
    }
    return result
  }

  function getContinentPixels(continentName) {
    if (!countryMapRef.current) return []
    const result = []
    for (const [pid] of countryMapRef.current.entries()) {
      const { lat, lng } = gridToLatLng(pid % GRID_COLS, Math.floor(pid / GRID_COLS))
      if (getContinent(lat, lng) === continentName) result.push(pid)
    }
    return result
  }

  function calcBulkPrice(pixelIds) {
    let total = 0
    for (const pid of pixelIds) {
      const pixel = pixels.get(pid)
      total += pixel?.current_price_sol ? calculateNextPrice(pixel.current_price_sol) : BASE_PIXEL_PRICE_SOL
    }
    return parseFloat(total.toFixed(4))
  }

  function draw() {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !baseRef.current) return
      const { w, h, dpr } = size.current
      const { zoom, panX, panY } = view.current
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Ocean
      ctx.fillStyle = '#051525'; ctx.fillRect(0, 0, w, h)

      // Base map
      ctx.save()
      ctx.translate(panX, panY); ctx.scale(zoom, zoom)
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
        ctx.translate(panX, panY); ctx.scale(zoom, zoom)
        ctx.clip(landPathRef.current)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        // Grid
        if (cw > 4) {
          ctx.strokeStyle = 'rgba(80,160,255,0.3)'; ctx.lineWidth = 0.4
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

      // Highlighted
      if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
        const { col, row } = idToGrid(highlightedPixelId)
        ctx.strokeStyle = '#e8440a'; ctx.lineWidth = 2
        ctx.strokeRect(ox + col * cw, oy + row * ch, cw, ch)
      }
    })
  }

  // ── Mouse ──────────────────────────────────────────────────────────────────
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
      setPopup(null)
      draw(); return
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
        const country = getPixelCountry(pid)
        const continent = country ? getContinent(
          gridToLatLng(pid % GRID_COLS, Math.floor(pid / GRID_COLS)).lat,
          gridToLatLng(pid % GRID_COLS, Math.floor(pid / GRID_COLS)).lng
        ) : null
        setPopup({ x: e.clientX, y: e.clientY, pixelId: pid, pixel: pixels.get(pid) || null, country, continent })
      }, 400)
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
    const country = getPixelCountry(pid)
    const continent = country ? getContinent(
      gridToLatLng(pid % GRID_COLS, Math.floor(pid / GRID_COLS)).lat,
      gridToLatLng(pid % GRID_COLS, Math.floor(pid / GRID_COLS)).lng
    ) : null
    setPopup({ x: e.clientX, y: e.clientY, pixelId: pid, pixel: pixels.get(pid) || null, country, continent })
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

  // ── Popup prices ───────────────────────────────────────────────────────────
  const pixelPrice = popup ? (popup.pixel?.current_price_sol ? calculateNextPrice(popup.pixel.current_price_sol) : BASE_PIXEL_PRICE_SOL) : 0
  const countryPixels = popup?.country ? getCountryPixels(popup.country) : []
  const continentPixels = popup?.continent ? getContinentPixels(popup.continent) : []
  const countryPrice = popup?.country ? calcBulkPrice(countryPixels) : 0
  const continentPrice = popup?.continent ? calcBulkPrice(continentPixels) : 0

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
          left: Math.min(popup.x + 16, window.innerWidth - 260),
          top: Math.max(popup.y - 20, 60),
          background: '#080f1e',
          border: '1px solid #1a3a5a',
          borderTop: '2px solid #e8440a',
          width: 240,
          boxShadow: '0 12px 40px rgba(0,0,0,0.9)',
          zIndex: 9999,
          pointerEvents: 'auto',
          userSelect: 'none',
        }}>
          {/* Header */}
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #0e2a42' }}>
            <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 8, letterSpacing: 2, color: '#2a5a7a', marginBottom: 2 }}>
              PIXEL #{popup.pixelId}
              {popup.country && <span style={{ color: '#4a8ab0', marginLeft: 8 }}>{popup.country}</span>}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: popup.pixel?.owner_wallet ? '#5a9aaa' : '#4a8a5a' }}>
              {popup.pixel?.owner_wallet
                ? `Owned by ${popup.pixel.owner_name || popup.pixel.owner_wallet.slice(0, 8) + '...'}`
                : 'UNCLAIMED TERRITORY'}
            </div>
          </div>

          {/* Buy options */}
          <div style={{ padding: '10px 14px' }}>

            {/* Single pixel */}
            <PurchaseRow
              label="This Pixel"
              count={1}
              priceSol={pixelPrice}
              onClick={() => {
                onPurchaseIntent({ type: 'pixel', pixelId: popup.pixelId, pixel: popup.pixel, priceSol: pixelPrice })
                setPopup(null)
              }}
            />

            {/* Country */}
            {popup.country && (
              <PurchaseRow
                label={popup.country}
                count={countryPixels.length}
                priceSol={countryPrice}
                onClick={() => {
                  onPurchaseIntent({ type: 'country', country: popup.country, pixelIds: countryPixels, priceSol: countryPrice })
                  setPopup(null)
                }}
              />
            )}

            {/* Continent */}
            {popup.continent && (
              <PurchaseRow
                label={popup.continent}
                count={continentPixels.length}
                priceSol={continentPrice}
                onClick={() => {
                  onPurchaseIntent({ type: 'continent', continent: popup.continent, pixelIds: continentPixels, priceSol: continentPrice })
                  setPopup(null)
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PurchaseRow({ label, count, priceSol, onClick }) {
  const usd = (priceSol * 150).toFixed(count > 1 ? 0 : 2)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div>
          <div style={{ fontFamily: 'Space Mono,monospace', fontSize: 9, color: '#4a8ab0', letterSpacing: 1 }}>
            {label.toUpperCase()}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#2a4a6a' }}>
            {count > 1 ? `${count.toLocaleString()} pixels` : 'Single pixel'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Bebas Neue,sans-serif', fontSize: 16, color: '#e8440a', letterSpacing: 1, lineHeight: 1 }}>
            {priceSol.toFixed(count > 1 ? 2 : 4)} SOL
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#2a5a7a' }}>≈ ${usd}</div>
        </div>
      </div>
      <button
        onClick={onClick}
        style={{
          width: '100%', background: '#e8440a', border: 'none', color: '#fff',
          fontFamily: 'Bebas Neue,sans-serif', fontSize: 13, letterSpacing: 2,
          padding: '7px 0', cursor: 'pointer', transition: 'opacity 0.15s',
        }}
        onMouseOver={e => e.target.style.opacity = '0.85'}
        onMouseOut={e => e.target.style.opacity = '1'}
      >
        CLAIM {label.toUpperCase()} →
      </button>
    </div>
  )
}
