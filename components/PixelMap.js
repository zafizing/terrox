import { useEffect, useRef, useState } from 'react'
import {
  GRID_COLS, GRID_ROWS, WORLD_BOUNDS,
  gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT
} from '../lib/pixels'

const OCEAN_COLOR = '#051525'
const LAND_COLOR = '#1e3a52'
const BORDER_COLOR = '#4a8ab0'
const GRID_COLOR = 'rgba(80, 160, 255, 0.45)'
const HIGHLIGHT_COLOR = '#e8440a'

function lngToX(lng, w) { return ((lng + 180) / 360) * w }
function latToY(lat, h) {
  const r = Math.log(Math.tan((90 + lat) * Math.PI / 360))
  const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
  return ((maxR - r) / (2 * maxR)) * h
}
function screenToLatLng(sx, sy, w, h, zoom, panX, panY) {
  const nx = (sx - panX) / zoom
  const ny = (sy - panY) / zoom
  const lng = (nx / w) * 360 - 180
  const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
  const r = maxR - (ny / h) * (2 * maxR)
  const lat = (Math.atan(Math.exp(r)) * 360 / Math.PI) - 90
  return { lat, lng }
}

// Draw all GeoJSON polygons onto a context
function drawGeo(ctx, geo, w, h, zoom, panX, panY, fill, stroke, lineWidth) {
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  for (const f of geo.features) {
    const geom = f.geometry
    if (!geom) continue
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates : []
    for (const poly of polys) {
      for (const ring of poly) {
        ctx.beginPath()
        let first = true
        for (const [lng, lat] of ring) {
          const x = lngToX(lng, w) * zoom + panX
          const y = latToY(lat, h) * zoom + panY
          first ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          first = false
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }
  }
}

// Build clip path from GeoJSON (reusable)
function buildClipPath(ctx, geo, w, h, zoom, panX, panY) {
  ctx.beginPath()
  for (const f of geo.features) {
    const geom = f.geometry
    if (!geom) continue
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates : []
    for (const poly of polys) {
      for (const ring of poly) {
        let first = true
        for (const [lng, lat] of ring) {
          const x = lngToX(lng, w) * zoom + panX
          const y = latToY(lat, h) * zoom + panY
          first ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          first = false
        }
        ctx.closePath()
      }
    }
  }
}

export default function PixelMap({ pixels, onPixelClick, highlightedPixelId }) {
  const canvasRef = useRef(null)
  // Pre-rendered offscreen canvases — built ONCE, reused every frame
  const baseCanvasRef = useRef(null)   // ocean + land + borders (zoom=1)
  const landMaskRef = useRef(null)     // white=land black=ocean for hit testing
  const geoRef = useRef(null)
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 })
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false })
  const sizeRef = useRef({ w: 800, h: 600 })
  const rafRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = canvasRef.current?.parentElement
    if (!container) return
    const w = container.clientWidth || 800
    const h = container.clientHeight || 600
    sizeRef.current = { w, h }
    canvasRef.current.width = w
    canvasRef.current.height = h

    const load = async () => {
      try {
        const res = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
        geoRef.current = await res.json()
      } catch (e) {
        geoRef.current = null
      }
      prebuild(w, h)
      setReady(true)
    }
    load()

    const onResize = () => {
      const nw = container.clientWidth
      const nh = container.clientHeight
      sizeRef.current = { w: nw, h: nh }
      canvasRef.current.width = nw
      canvasRef.current.height = nh
      prebuild(nw, nh)
      scheduleRender()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => { if (ready) scheduleRender() }, [ready, pixels, highlightedPixelId])

  // ─── Pre-build offscreen canvases at BASE resolution (zoom=1, pan=0) ──────
  // This is the expensive work — done ONCE per resize
  function prebuild(w, h) {
    // 1. Base map canvas (ocean + land + borders)
    const base = document.createElement('canvas')
    base.width = w; base.height = h
    const bCtx = base.getContext('2d')
    bCtx.fillStyle = OCEAN_COLOR
    bCtx.fillRect(0, 0, w, h)
    if (geoRef.current) {
      drawGeo(bCtx, geoRef.current, w, h, 1, 0, 0, LAND_COLOR, BORDER_COLOR, 0.5)
    }
    baseCanvasRef.current = base

    // 2. Land mask (white=land, black=ocean) for hit testing
    const mask = document.createElement('canvas')
    mask.width = w; mask.height = h
    const mCtx = mask.getContext('2d')
    mCtx.fillStyle = '#000'
    mCtx.fillRect(0, 0, w, h)
    if (geoRef.current) {
      drawGeo(mCtx, geoRef.current, w, h, 1, 0, 0, '#fff', '#fff', 1)
    }
    // Store as ImageData for fast pixel lookup
    landMaskRef.current = { data: mCtx.getImageData(0, 0, w, h).data, w, h }
  }

  // ─── Fast land check (bitmap lookup, O(1)) ─────────────────────────────────
  function isLand(screenX, screenY) {
    const { zoom, panX, panY } = viewRef.current
    // Map screen → base coords (zoom=1, pan=0)
    const bx = Math.round((screenX - panX) / zoom)
    const by = Math.round((screenY - panY) / zoom)
    const m = landMaskRef.current
    if (!m) return true
    if (bx < 0 || bx >= m.w || by < 0 || by >= m.h) return false
    return m.data[(by * m.w + bx) * 4] > 128
  }

  // ─── Schedule render (debounced via RAF) ───────────────────────────────────
  function scheduleRender() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(render)
  }

  // ─── Main render — fast, no GeoJSON iteration ─────────────────────────────
  function render() {
    const canvas = canvasRef.current
    if (!canvas || !baseCanvasRef.current) return
    const { w, h } = sizeRef.current
    const { zoom, panX, panY } = viewRef.current
    const ctx = canvas.getContext('2d')

    // Clear
    ctx.clearRect(0, 0, w, h)

    // Draw pre-rendered base map scaled + translated
    ctx.save()
    ctx.translate(panX, panY)
    ctx.scale(zoom, zoom)
    ctx.drawImage(baseCanvasRef.current, 0, 0)
    ctx.restore()

    // Pixel grid — land only via clip
    const originX = lngToX(WORLD_BOUNDS.minLng, w) * zoom + panX
    const originY = latToY(WORLD_BOUNDS.maxLat, h) * zoom + panY
    const endX = lngToX(WORLD_BOUNDS.maxLng, w) * zoom + panX
    const endY = latToY(WORLD_BOUNDS.minLat, h) * zoom + panY
    const cellW = (endX - originX) / GRID_COLS
    const cellH = (endY - originY) / GRID_ROWS

    if (cellW > 1.5 && geoRef.current) {
      ctx.save()
      // Clip to land using transformed GeoJSON
      buildClipPath(ctx, geoRef.current, w, h, zoom, panX, panY)
      ctx.clip()
      ctx.strokeStyle = GRID_COLOR
      ctx.lineWidth = 0.4
      for (let col = 0; col <= GRID_COLS; col++) {
        const x = originX + col * cellW
        if (x < -10 || x > w + 10) continue
        ctx.beginPath(); ctx.moveTo(x, originY); ctx.lineTo(x, endY); ctx.stroke()
      }
      for (let row = 0; row <= GRID_ROWS; row++) {
        const y = originY + row * cellH
        if (y < -10 || y > h + 10) continue
        ctx.beginPath(); ctx.moveTo(originX, y); ctx.lineTo(endX, y); ctx.stroke()
      }
      ctx.restore()
    }

    // Claimed pixels — also clipped to land
    if (pixels.size > 0 && geoRef.current) {
      ctx.save()
      buildClipPath(ctx, geoRef.current, w, h, zoom, panX, panY)
      ctx.clip()
      pixels.forEach((pixel, id) => {
        if (!pixel.owner_wallet) return
        const { col, row } = idToGrid(id)
        const x = originX + col * cellW
        const y = originY + row * cellH
        if (x + cellW < 0 || x > w || y + cellH < 0 || y > h) return
        const color = pixel.color || HIGHLIGHT_COLOR
        ctx.shadowColor = color
        ctx.shadowBlur = zoom >= 4 ? 8 : 4
        ctx.fillStyle = color
        ctx.globalAlpha = 0.85
        ctx.fillRect(x, y, cellW, cellH)
        ctx.globalAlpha = 1
        ctx.shadowBlur = 0
      })
      ctx.restore()
    }

    // Highlighted pixel
    if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
      const { col, row } = idToGrid(highlightedPixelId)
      const x = originX + col * cellW
      const y = originY + row * cellH
      ctx.save()
      ctx.shadowColor = HIGHLIGHT_COLOR
      ctx.shadowBlur = 20
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, cellW, cellH)
      ctx.restore()
    }
  }

  // ─── Mouse events ─────────────────────────────────────────────────────────
  function onMouseDown(e) {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false }
  }

  function onMouseMove(e) {
    const d = dragRef.current
    if (d.dragging) {
      const dx = e.clientX - d.lastX
      const dy = e.clientY - d.lastY
      if (Math.abs(e.clientX - d.startX) > 4 || Math.abs(e.clientY - d.startY) > 4) d.moved = true
      viewRef.current.panX += dx
      viewRef.current.panY += dy
      d.lastX = e.clientX
      d.lastY = e.clientY
      scheduleRender()
      canvasRef.current.style.cursor = 'grabbing'
      return
    }
    const rect = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    canvasRef.current.style.cursor = isLand(sx, sy) ? 'crosshair' : 'not-allowed'
  }

  function onMouseUp() { dragRef.current.dragging = false }
  function onMouseLeave() { dragRef.current.dragging = false }

  function onClick(e) {
    const d = dragRef.current
    if (d.moved) { d.moved = false; return }
    const rect = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    if (!isLand(sx, sy)) return
    const { w, h } = sizeRef.current
    const { zoom, panX, panY } = viewRef.current
    const { lat, lng } = screenToLatLng(sx, sy, w, h, zoom, panX, panY)
    const col = Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH)
    const row = Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT)
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return
    onPixelClick(row * GRID_COLS + col, gridToLatLng(col, row).lat, gridToLatLng(col, row).lng)
  }

  function onWheel(e) {
    e.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY > 0 ? 0.85 : 1.18
    const newZoom = Math.min(Math.max(viewRef.current.zoom * factor, 0.8), 24)
    const scale = newZoom / viewRef.current.zoom
    viewRef.current = {
      zoom: newZoom,
      panX: mx - scale * (mx - viewRef.current.panX),
      panY: my - scale * (my - viewRef.current.panY),
    }
    scheduleRender()
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', background: OCEAN_COLOR }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onWheel={onWheel}
    />
  )
}
