import { useEffect, useRef, useState } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT } from '../lib/pixels'

// Land detection — returns false for obvious ocean areas
function isLandCoord(lat, lng) {
  if (lat > 84 || lat < -84) return false
  // Pacific main body
  if (lng < -125 && lat > -55 && lat < 55 && !(lat > 15 && lat < 65 && lng > -168 && lng < -140)) return false
  if (lng > 160 && lat > -50 && lat < 55) return false
  // Atlantic
  if (lng > -50 && lng < -8 && lat > 20 && lat < 65) return false
  if (lng > -38 && lng < 12 && lat > -55 && lat < 5) return false
  // Indian Ocean
  if (lng > 52 && lng < 100 && lat > -55 && lat < 2) return false
  if (lng > 55 && lng < 70 && lat > 5 && lat < 23) return false
  // Southern Ocean
  if (lat < -62) return false
  // Arctic
  if (lat > 80) return false
  return true
}

export default function PixelMap({ pixels, onPixelClick, highlightedPixelId }) {
  const mapRef = useRef(null)
  const canvasLayerRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (mapRef.current) return

    const initMap = async () => {
      const L = (await import('leaflet')).default

      const map = L.map('terrox-map', {
        center: [20, 15],
        zoom: 2,
        minZoom: 2,
        maxZoom: 7,
        zoomControl: true,
        attributionControl: false,
      })

      // Base tile layer — country borders only, no labels
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map)

      mapRef.current = map

      // ── Canvas overlay ──────────────────────────────────────────────────────
      const CanvasLayer = L.Layer.extend({
        onAdd: function (map) {
          this._map = map
          this._canvas = document.createElement('canvas')
          this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:400;'
          map.getPanes().overlayPane.appendChild(this._canvas)
          map.on('moveend zoomend resize', this._redraw, this)
          this._redraw()
        },
        onRemove: function (map) {
          map.getPanes().overlayPane.removeChild(this._canvas)
          map.off('moveend zoomend resize', this._redraw, this)
        },
        _redraw: function () {
          const map = this._map
          const canvas = this._canvas
          const size = map.getSize()
          canvas.width = size.x
          canvas.height = size.y
          const ctx = canvas.getContext('2d')
          ctx.clearRect(0, 0, size.x, size.y)
          const bounds = map.getBounds()
          const zoom = map.getZoom()

          // ── Step 1: Draw uniform pixel grid across WHOLE map as pattern ──
          // This avoids the patchy rendering completely
          const sampleLat = (bounds.getNorth() + bounds.getSouth()) / 2
          const sampleLng = (bounds.getEast() + bounds.getWest()) / 2
          const sampleTL = map.latLngToContainerPoint([sampleLat + PIXEL_HEIGHT / 2, sampleLng - PIXEL_WIDTH / 2])
          const sampleBR = map.latLngToContainerPoint([sampleLat - PIXEL_HEIGHT / 2, sampleLng + PIXEL_WIDTH / 2])
          const pxW = Math.max(1, sampleBR.x - sampleTL.x)
          const pxH = Math.max(1, sampleBR.y - sampleTL.y)

          if (zoom >= 3 && pxW > 2) {
            // Draw grid as repeating lines instead of per-pixel loop
            const originPt = map.latLngToContainerPoint([WORLD_BOUNDS.maxLat, WORLD_BOUNDS.minLng])
            ctx.strokeStyle = 'rgba(80, 160, 255, 0.35)'
            ctx.lineWidth = 0.5
            // Vertical lines
            for (let col = 0; col <= GRID_COLS; col++) {
              const x = originPt.x + col * pxW
              if (x < -pxW || x > size.x + pxW) continue
              ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.y); ctx.stroke()
            }
            // Horizontal lines
            for (let row = 0; row <= GRID_ROWS; row++) {
              const y = originPt.y + row * pxH
              if (y < -pxH || y > size.y + pxH) continue
              ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.x, y); ctx.stroke()
            }
          }

          // ── Step 2: Draw owned pixels ──────────────────────────────────────
          pixels.forEach((pixel, id) => {
            if (!pixel.owner_wallet) return
            const { col, row } = idToGrid(id)
            const { lat, lng } = gridToLatLng(col, row)
            if (!isLandCoord(lat, lng)) return
            const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
            const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
            if (tl.x > size.x || br.x < 0 || tl.y > size.y || br.y < 0) return
            const w = Math.max(1, br.x - tl.x)
            const h = Math.max(1, br.y - tl.y)
            const color = pixel.color || '#e8440a'
            ctx.shadowColor = color
            ctx.shadowBlur = zoom >= 4 ? 10 : 5
            ctx.fillStyle = color
            ctx.globalAlpha = 0.9
            ctx.fillRect(tl.x, tl.y, w, h)
            ctx.globalAlpha = 1
            ctx.shadowBlur = 0
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'
            ctx.lineWidth = 0.5
            ctx.strokeRect(tl.x, tl.y, w, h)
          })

          // ── Step 3: Highlighted pixel ──────────────────────────────────────
          if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
            const { col, row } = idToGrid(highlightedPixelId)
            const { lat, lng } = gridToLatLng(col, row)
            const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
            const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
            const w = Math.max(2, br.x - tl.x)
            const h = Math.max(2, br.y - tl.y)
            ctx.shadowColor = '#e8440a'
            ctx.shadowBlur = 20
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 2
            ctx.strokeRect(tl.x, tl.y, w, h)
            ctx.shadowBlur = 0
          }
        },
        update: function () { this._redraw() }
      })

      const layer = new CanvasLayer()
      layer.addTo(map)
      canvasLayerRef.current = layer

      map.on('mousemove', (e) => {
        map.getContainer().style.cursor = isLandCoord(e.latlng.lat, e.latlng.lng) ? 'crosshair' : 'not-allowed'
      })

      map.on('click', (e) => {
        const { lat, lng } = e.latlng
        if (!isLandCoord(lat, lng)) return
        const col = Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH)
        const row = Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT)
        if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return
        const pixelId = row * GRID_COLS + col
        const { lat: cLat, lng: cLng } = gridToLatLng(col, row)
        onPixelClick(pixelId, cLat, cLng)
      })

      setMapReady(true)
    }

    initMap()
  }, [])

  useEffect(() => {
    if (canvasLayerRef.current && mapReady) canvasLayerRef.current.update()
  }, [pixels, highlightedPixelId, mapReady])

  return (
    <div id="terrox-map" style={{ width: '100%', height: '100%', background: '#071428' }} />
  )
}
