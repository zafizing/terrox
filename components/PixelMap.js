import { useEffect, useRef, useState } from 'react'
import {
  GRID_COLS, GRID_ROWS, WORLD_BOUNDS,
  gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT
} from '../lib/pixels'

// ─── Colors ───────────────────────────────────────────────────────────────────
const OCEAN_COLOR = '#051525'
const LAND_COLOR = '#1e3a52'
const BORDER_COLOR = '#4a8ab0'
const GRID_COLOR = 'rgba(80, 160, 255, 0.45)'
const HIGHLIGHT_COLOR = '#e8440a'

// ─── Mercator projection helpers ──────────────────────────────────────────────
function lngToX(lng, width) {
  return ((lng + 180) / 360) * width
}
function latToY(lat, height) {
  const r = Math.log(Math.tan((90 + lat) * Math.PI / 360))
  const maxR = Math.log(Math.tan((90 + 85) * Math.PI / 360))
  return ((maxR - r) / (2 * maxR)) * height
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

export default function PixelMap({ pixels, onPixelClick, highlightedPixelId }) {
  const canvasRef = useRef(null)
  const geoRef = useRef(null)
  const landBitmapRef = useRef(null) // offscreen pixel-level land mask
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 })
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, moved: false })
  const sizeRef = useRef({ w: 800, h: 600 })
  const [ready, setReady] = useState(false)

  // ─── Setup ────────────────────────────────────────────────────────────────
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
        const res = await fetch(
          'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson'
        )
        geoRef.current = await res.json()
      } catch (e) {
        geoRef.current = null
      }
      buildLandMask(w, h)
      setReady(true)
    }
    load()

    const onResize = () => {
      const nw = container.clientWidth
      const nh = container.clientHeight
      sizeRef.current = { w: nw, h: nh }
      if (canvasRef.current) {
        canvasRef.current.width = nw
        canvasRef.current.height = nh
      }
      buildLandMask(nw, nh)
      renderMap()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (ready) renderMap()
  }, [ready, pixels, highlightedPixelId])

  // ─── Land mask (offscreen canvas at zoom=1, pan=0) ────────────────────────
  // We render all land polygons once at base view.
  // isLand() samples this bitmap — O(1) per lookup, perfectly accurate.
  function buildLandMask(w, h) {
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const ctx = off.getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    if (geoRef.current) {
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 0.5
      drawGeo(ctx, geoRef.current, w, h, 1, 0, 0)
    }
    landBitmapRef.current = { data: ctx.getImageData(0, 0, w, h).data, w, h }
  }

  function isLand(screenX, screenY) {
    // Convert screen coords back to base (zoom=1, pan=0) coords
    const { zoom, panX, panY } = viewRef.current
    const bx = (screenX - panX) / zoom
    const by = (screenY - panY) / zoom
    const bm = landBitmapRef.current
    if (!bm) return true
    const ix = Math.round(bx)
    const iy = Math.round(by)
    if (ix < 0 || ix >= bm.w || iy < 0 || iy >= bm.h) return false
    return bm.data[(iy * bm.w + ix) * 4] > 128
  }

  // ─── Draw GeoJSON ─────────────────────────────────────────────────────────
  function drawGeo(ctx, geo, w, h, zoom, panX, panY) {
    for (const f of geo.features) {
      const geom = f.geometry
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
  function renderMap() {
    const canvas = canvasRef.current
    if (!canvas) return
    const { w, h } = sizeRef.current
    const { zoom, panX, panY } = viewRef.current
    const ctx = canvas.getContext('2d')

    // Ocean
    ctx.fillStyle = OCEAN_COLOR
    ctx.fillRect(0, 0, w, h)

    // Subtle ocean grid
    ctx.strokeStyle = 'rgba(10, 40, 80, 0.5)'
    ctx.lineWidth = 0.3
    for (let x = 0; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = 0; y < h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

    // Land
    if (geoRef.current) {
      ctx.fillStyle = LAND_COLOR
      ctx.strokeStyle = BORDER_COLOR
      ctx.lineWidth = 0.8 / zoom
      drawGeo(ctx, geoRef.current, w, h, zoom, panX, panY)
    }

    // Pixel grid — LAND ONLY using clipPath per polygon
    const originX = lngToX(WORLD_BOUNDS.minLng, w) * zoom + panX
    const originY = latToY(WORLD_BOUNDS.maxLat, h) * zoom + panY
    const endX = lngToX(WORLD_BOUNDS.maxLng, w) * zoom + panX
    const endY = latToY(WORLD_BOUNDS.minLat, h) * zoom + panY
    const cellW = (endX - originX) / GRID_COLS
    const cellH = (endY - originY) / GRID_ROWS

    if (cellW > 1.5 && geoRef.current) {
      // Clip grid to land shapes only
      ctx.save()
      ctx.beginPath()
      for (const f of geoRef.current.features) {
        const geom = f.geometry
        if (!geom) continue
        const polys = geom.type === 'Polygon'
          ? [geom.coordinates]
          : geom.type === 'MultiPolygon'
            ? geom.coordinates
            : []
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
      ctx.clip()

      // Now draw grid — only visible inside land clip
      ctx.strokeStyle = GRID_COLOR
      ctx.lineWidth = 0.4
      for (let col = 0; col <= GRID_COLS; col++) {
        const x = originX + col * cellW
        if (x < -cellW || x > w + cellW) continue
        ctx.beginPath(); ctx.moveTo(x, originY); ctx.lineTo(x, endY); ctx.stroke()
      }
      for (let row = 0; row <= GRID_ROWS; row++) {
        const y = originY + row * cellH
        if (y < -cellH || y > h + cellH) continue
        ctx.beginPath(); ctx.moveTo(originX, y); ctx.lineTo(endX, y); ctx.stroke()
      }
      ctx.restore()
    }

    // Claimed pixels — also clipped to land
    if (geoRef.current) {
      ctx.save()
      ctx.beginPath()
      for (const f of geoRef.current.features) {
        const geom = f.geometry
        if (!geom) continue
        const polys = geom.type === 'Polygon'
          ? [geom.coordinates]
          : geom.type === 'MultiPolygon'
            ? geom.coordinates
            : []
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
      ctx.clip()

      pixels.forEach((pixel, id) => {
        if (!pixel.owner_wallet) return
        const { col, row } = idToGrid(id)
        const { lat, lng } = gridToLatLng(col, row)
        const x = originX + col * cellW
        const y = originY + row * cellH
        if (x + cellW < 0 || x > w || y + cellH < 0 || y > h) return
        const color = pixel.color || HIGHLIGHT_COLOR
        ctx.shadowColor = color
        ctx.shadowBlur = zoom >= 4 ? 10 : 5
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
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    }
  }

  function onMouseMove(e) {
    const d = dragRef.current
    if (d.dragging) {
      const dx = e.clientX - d.lastX
      const dy = e.clientY - d.lastY
      // Mark as moved if dragged more than 4px total
      const totalDx = e.clientX - d.startX
      const totalDy = e.clientY - d.startY
      if (Math.abs(totalDx) > 4 || Math.abs(totalDy) > 4) d.moved = true
      viewRef.current.panX += dx
      viewRef.current.panY += dy
      d.lastX = e.clientX
      d.lastY = e.clientY
      renderMap()
    }
    // Cursor feedback
    const rect = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    canvasRef.current.style.cursor = d.dragging
      ? 'grabbing'
      : isLand(sx, sy) ? 'crosshair' : 'not-allowed'
  }

  function onMouseUp(e) {
    dragRef.current.dragging = false
  }

  function onMouseLeave() {
    dragRef.current.dragging = false
  }

  function onClick(e) {
    const d = dragRef.current
    // Ignore if this was a drag
    if (d.moved) { d.moved = false; return }

    const rect = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    // Block ocean clicks
    if (!isLand(sx, sy)) return

    const { w, h } = sizeRef.current
    const { zoom, panX, panY } = viewRef.current
    const { lat, lng } = screenToLatLng(sx, sy, w, h, zoom, panX, panY)

    const col = Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH)
    const row = Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT)
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return

    const pixelId = row * GRID_COLS + col
    const { lat: cLat, lng: cLng } = gridToLatLng(col, row)
    onPixelClick(pixelId, cLat, cLng)
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
    renderMap()
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', background: OCEAN_COLOR, cursor: 'crosshair' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onWheel={onWheel}
    />
  )
}
