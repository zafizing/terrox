import { useEffect, useRef, useState } from 'react'
import {
  GRID_COLS, GRID_ROWS, WORLD_BOUNDS,
  gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT
} from '../lib/pixels'

// ─── Constants ────────────────────────────────────────────────────────────────
const OCEAN_COLOR = '#071c3a'
const LAND_COLOR = '#1a2535'
const BORDER_COLOR = '#2a4a6a'
const GRID_COLOR = 'rgba(60, 140, 255, 0.25)'
const HIGHLIGHT_COLOR = '#e8440a'

// ─── Coordinate helpers ───────────────────────────────────────────────────────
function lngToX(lng, width) {
  return ((lng + 180) / 360) * width
}
function latToY(lat, height) {
  const r = Math.log(Math.tan((90 + lat) * Math.PI / 360))
  const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
  return ((maxR - r) / (2 * maxR)) * height
}

export default function PixelMap({ pixels, onPixelClick, highlightedPixelId }) {
  const canvasRef = useRef(null)
  const overlayRef = useRef(null)
  const geoRef = useRef(null)
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 })
  const dragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const landBitmapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [size, setSize] = useState({ w: 800, h: 600 })

  // ─── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = canvasRef.current?.parentElement
    if (!container) return
    const w = container.clientWidth
    const h = container.clientHeight
    setSize({ w, h })

    const loadGeo = async () => {
      try {
        const res = await fetch(
          'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson'
        )
        geoRef.current = await res.json()
      } catch (e) {
        // Fallback: basic land rectangles if GeoJSON fails
        geoRef.current = null
      }
      buildLandBitmap(w, h)
      setReady(true)
    }
    loadGeo()

    const handleResize = () => {
      const nw = container.clientWidth
      const nh = container.clientHeight
      setSize({ w: nw, h: nh })
      buildLandBitmap(nw, nh)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // ─── Build land bitmap for hit testing ────────────────────────────────────
  function buildLandBitmap(w, h) {
    const offscreen = document.createElement('canvas')
    offscreen.width = w
    offscreen.height = h
    const ctx = offscreen.getContext('2d')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, w, h)

    if (geoRef.current) {
      ctx.fillStyle = '#ffffff'
      drawGeoJSON(ctx, geoRef.current, w, h, 1, 0, 0)
    }
    landBitmapRef.current = ctx.getImageData(0, 0, w, h)
  }

  function isLandPixel(screenX, screenY) {
    if (!landBitmapRef.current) return true
    const { w, h } = size
    if (screenX < 0 || screenX >= w || screenY < 0 || screenY >= h) return false
    const idx = (Math.floor(screenY) * w + Math.floor(screenX)) * 4
    return landBitmapRef.current.data[idx] > 128
  }

  // ─── Draw GeoJSON polygons ─────────────────────────────────────────────────
  function drawGeoJSON(ctx, geo, w, h, zoom, panX, panY) {
    if (!geo) return
    for (const feature of geo.features) {
      const geom = feature.geometry
      if (!geom) continue
      const polys = geom.type === 'Polygon'
        ? [geom.coordinates]
        : geom.type === 'MultiPolygon'
          ? geom.coordinates
          : []

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

  // ─── Main render ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !canvasRef.current) return
    render()
  }, [ready, size, pixels, highlightedPixelId])

  function render() {
    const canvas = canvasRef.current
    if (!canvas) return
    const { w, h } = size
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const { zoom, panX, panY } = viewRef.current

    // Ocean background
    ctx.fillStyle = OCEAN_COLOR
    ctx.fillRect(0, 0, w, h)

    // Ocean grid lines
    ctx.strokeStyle = 'rgba(10, 35, 70, 0.6)'
    ctx.lineWidth = 0.4
    for (let x = 0; x < w; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
    }
    for (let y = 0; y < h; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }

    // Land polygons
    if (geoRef.current) {
      ctx.fillStyle = LAND_COLOR
      ctx.strokeStyle = BORDER_COLOR
      ctx.lineWidth = 0.7 / zoom
      drawGeoJSON(ctx, geoRef.current, w, h, zoom, panX, panY)
    }

    // Pixel grid — uniform lines, always consistent
    const originX = lngToX(WORLD_BOUNDS.minLng, w) * zoom + panX
    const originY = latToY(WORLD_BOUNDS.maxLat, h) * zoom + panY
    const endX = lngToX(WORLD_BOUNDS.maxLng, w) * zoom + panX
    const endY = latToY(WORLD_BOUNDS.minLat, h) * zoom + panY
    const gridW = endX - originX
    const gridH = endY - originY
    const cellW = gridW / GRID_COLS
    const cellH = gridH / GRID_ROWS

    if (cellW > 2) {
      ctx.strokeStyle = GRID_COLOR
      ctx.lineWidth = 0.4
      for (let col = 0; col <= GRID_COLS; col++) {
        const x = originX + col * cellW
        if (x < 0 || x > w) continue
        ctx.beginPath(); ctx.moveTo(x, originY); ctx.lineTo(x, endY); ctx.stroke()
      }
      for (let row = 0; row <= GRID_ROWS; row++) {
        const y = originY + row * cellH
        if (y < 0 || y > h) continue
        ctx.beginPath(); ctx.moveTo(originX, y); ctx.lineTo(endX, y); ctx.stroke()
      }
    }

    // Claimed pixels
    pixels.forEach((pixel, id) => {
      if (!pixel.owner_wallet) return
      const { col, row } = idToGrid(id)
      const { lat, lng } = gridToLatLng(col, row)
      const x = lngToX(lng - PIXEL_WIDTH / 2, w) * zoom + panX
      const y = latToY(lat + PIXEL_HEIGHT / 2, h) * zoom + panY
      const pw = cellW
      const ph = cellH
      if (x + pw < 0 || x > w || y + ph < 0 || y > h) return
      const color = pixel.color || HIGHLIGHT_COLOR
      ctx.shadowColor = color
      ctx.shadowBlur = 6
      ctx.fillStyle = color
      ctx.globalAlpha = 0.85
      ctx.fillRect(x, y, pw, ph)
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    })

    // Highlighted pixel
    if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
      const { col, row } = idToGrid(highlightedPixelId)
      const { lat, lng } = gridToLatLng(col, row)
      const x = lngToX(lng - PIXEL_WIDTH / 2, w) * zoom + panX
      const y = latToY(lat + PIXEL_HEIGHT / 2, h) * zoom + panY
      ctx.shadowColor = HIGHLIGHT_COLOR
      ctx.shadowBlur = 16
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, cellW, cellH)
      ctx.shadowBlur = 0
    }
  }

  // ─── Screen coords → world coords ─────────────────────────────────────────
  function screenToWorld(screenX, screenY) {
    const { w, h } = size
    const { zoom, panX, panY } = viewRef.current
    const nx = (screenX - panX) / zoom
    const ny = (screenY - panY) / zoom
    const lng = (nx / w) * 360 - 180
    const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
    const r = maxR - (ny / h) * (2 * maxR)
    const lat = (Math.atan(Math.exp(r)) * 360 / Math.PI) - 90
    return { lat, lng }
  }

  // ─── Zoom ──────────────────────────────────────────────────────────────────
  function handleWheel(e) {
    e.preventDefault()
    const { w, h } = size
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const delta = e.deltaY > 0 ? 0.85 : 1.18
    const newZoom = Math.min(Math.max(viewRef.current.zoom * delta, 0.8), 20)
    const scale = newZoom / viewRef.current.zoom
    viewRef.current = {
      zoom: newZoom,
      panX: mx - scale * (mx - viewRef.current.panX),
      panY: my - scale * (my - viewRef.current.panY),
    }
    render()
  }

  // ─── Pan ───────────────────────────────────────────────────────────────────
  function handleMouseDown(e) {
    dragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }

  function handleMouseMove(e) {
    if (dragging.current) {
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      viewRef.current.panX += dx
      viewRef.current.panY += dy
      lastMouse.current = { x: e.clientX, y: e.clientY }
      render()
      return
    }
    // Cursor
    const rect = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    canvasRef.current.style.cursor = isLandPixel(sx, sy) ? 'crosshair' : 'not-allowed'
  }

  function handleMouseUp() { dragging.current = false }

  // ─── Click ────────────────────────────────────────────────────────────────
  function handleClick(e) {
    if (Math.abs(e.clientX - lastMouse.current.x) > 3) return
    const rect = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    if (!isLandPixel(sx, sy)) return
    const { lat, lng } = screenToWorld(sx, sy)
    const col = Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH)
    const row = Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT)
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return
    const pixelId = row * GRID_COLS + col
    const { lat: cLat, lng: cLng } = gridToLatLng(col, row)
    onPixelClick(pixelId, cLat, cLng)
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', background: OCEAN_COLOR }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
    />
  )
}
