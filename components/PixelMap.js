import { useEffect, useRef, useState } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT } from '../lib/pixels'

function lngToX(lng, w) { return ((lng + 180) / 360) * w }
function latToY(lat, h) {
  const r = Math.log(Math.tan((90 + lat) * Math.PI / 360))
  const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
  return ((maxR - r) / (2 * maxR)) * h
}

export default function PixelMap({ pixels, onPixelClick, highlightedPixelId }) {
  const canvasRef = useRef(null)
  const baseRef = useRef(null)      // pre-rendered ocean + land bitmap
  const maskRef = useRef(null)      // land mask imagedata for hit test
  const geoRef = useRef(null)
  const view = useRef({ zoom: 1, panX: 0, panY: 0 })
  const drag = useRef({ on: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false })
  const size = useRef({ w: 800, h: 600 })
  const raf = useRef(null)

  useEffect(() => {
    const el = canvasRef.current?.parentElement
    if (!el) return
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600
    size.current = { w, h }
    canvasRef.current.width = w
    canvasRef.current.height = h

    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(r => r.json())
      .then(geo => {
        geoRef.current = geo
        buildBase(w, h, geo)
        draw()
      })
      .catch(() => { buildBase(w, h, null); draw() })
  }, [])

  useEffect(() => { draw() }, [pixels, highlightedPixelId])

  function buildBase(w, h, geo) {
    // 1. Visible map canvas
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#051525'
    ctx.fillRect(0, 0, w, h)
    if (geo) {
      ctx.fillStyle = '#1e3a52'
      ctx.strokeStyle = '#4a8ab0'
      ctx.lineWidth = 0.5
      paintGeo(ctx, geo, w, h)
    }
    baseRef.current = c

    // 2. Land mask
    const m = document.createElement('canvas')
    m.width = w; m.height = h
    const mctx = m.getContext('2d')
    mctx.fillStyle = '#000'
    mctx.fillRect(0, 0, w, h)
    if (geo) {
      mctx.fillStyle = '#fff'
      mctx.strokeStyle = '#fff'
      mctx.lineWidth = 1
      paintGeo(mctx, geo, w, h)
    }
    maskRef.current = mctx.getImageData(0, 0, w, h)
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
            const x = lngToX(lng, w)
            const y = latToY(lat, h)
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

  function isLand(sx, sy) {
    const m = maskRef.current
    if (!m) return true
    const { zoom, panX, panY } = view.current
    const bx = Math.round((sx - panX) / zoom)
    const by = Math.round((sy - panY) / zoom)
    if (bx < 0 || bx >= m.width || by < 0 || by >= m.height) return false
    return m.data[(by * m.width + bx) * 4] > 128
  }

  function draw() {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !baseRef.current) return
      const { w, h } = size.current
      const { zoom, panX, panY } = view.current
      const ctx = canvas.getContext('2d')

      ctx.fillStyle = '#051525'
      ctx.fillRect(0, 0, w, h)

      // Draw pre-rendered base
      ctx.save()
      ctx.translate(panX, panY)
      ctx.scale(zoom, zoom)
      ctx.drawImage(baseRef.current, 0, 0)
      ctx.restore()

      // Claimed pixels
      const ox = lngToX(WORLD_BOUNDS.minLng, w) * zoom + panX
      const oy = latToY(WORLD_BOUNDS.maxLat, h) * zoom + panY
      const ex = lngToX(WORLD_BOUNDS.maxLng, w) * zoom + panX
      const ey = latToY(WORLD_BOUNDS.minLat, h) * zoom + panY
      const cw = (ex - ox) / GRID_COLS
      const ch = (ey - oy) / GRID_ROWS

      pixels.forEach((pixel, id) => {
        if (!pixel.owner_wallet) return
        const { col, row } = idToGrid(id)
        const x = ox + col * cw
        const y = oy + row * ch
        if (x + cw < 0 || x > w || y + ch < 0 || y > h) return
        ctx.fillStyle = pixel.color || '#e8440a'
        ctx.globalAlpha = 0.8
        ctx.fillRect(x, y, cw, ch)
        ctx.globalAlpha = 1
      })

      // Highlighted pixel
      if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
        const { col, row } = idToGrid(highlightedPixelId)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.strokeRect(ox + col * cw, oy + row * ch, cw, ch)
      }

      // Grid (only when zoomed in enough)
      if (cw > 4) {
        ctx.strokeStyle = 'rgba(80,160,255,0.3)'
        ctx.lineWidth = 0.4
        for (let col = 0; col <= GRID_COLS; col++) {
          const x = ox + col * cw
          if (x < 0 || x > w) continue
          ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, ey); ctx.stroke()
        }
        for (let row = 0; row <= GRID_ROWS; row++) {
          const y = oy + row * ch
          if (y < 0 || y > h) continue
          ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ex, y); ctx.stroke()
        }
      }
    })
  }

  function onDown(e) {
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false }
  }

  function onMove(e) {
    const d = drag.current
    if (!d.on) {
      const r = canvasRef.current.getBoundingClientRect()
      canvasRef.current.style.cursor = isLand(e.clientX - r.left, e.clientY - r.top) ? 'crosshair' : 'not-allowed'
      return
    }
    if (Math.abs(e.clientX - d.sx) > 4 || Math.abs(e.clientY - d.sy) > 4) d.moved = true
    view.current.panX += e.clientX - d.lx
    view.current.panY += e.clientY - d.ly
    d.lx = e.clientX; d.ly = e.clientY
    canvasRef.current.style.cursor = 'grabbing'
    draw()
  }

  function onUp() { drag.current.on = false }

  function onClick(e) {
    if (drag.current.moved) { drag.current.moved = false; return }
    const r = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    if (!isLand(sx, sy)) return
    const { w, h } = size.current
    const { zoom, panX, panY } = view.current
    const nx = (sx - panX) / zoom
    const ny = (sy - panY) / zoom
    const lng = (nx / w) * 360 - 180
    const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
    const lat = (Math.atan(Math.exp(maxR - (ny / h) * 2 * maxR)) * 360 / Math.PI) - 90
    const col = Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH)
    const row = Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT)
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return
    const id = row * GRID_COLS + col
    const { lat: cl, lng: cn } = gridToLatLng(col, row)
    onPixelClick(id, cl, cn)
  }

  function onWheel(e) {
    e.preventDefault()
    const r = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const f = e.deltaY > 0 ? 0.85 : 1.18
    const nz = Math.min(Math.max(view.current.zoom * f, 0.8), 24)
    const s = nz / view.current.zoom
    view.current = { zoom: nz, panX: mx - s * (mx - view.current.panX), panY: my - s * (my - view.current.panY) }
    draw()
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', background: '#051525' }}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onClick={onClick}
      onWheel={onWheel}
    />
  )
}
