import { useEffect, useRef, useState } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT } from '../lib/pixels'

// Simplified land detection — blocks obvious ocean areas
function isLand(lat, lng) {
  // Arctic/Antarctic
  if (lat > 84 || lat < -80) return false

  // Pacific Ocean (main body)
  if (lng < -130 && lat > -55 && lat < 55) return false
  if (lng > 150 && lat > -50 && lat < 55 && !(lat > -50 && lng > 160 && lat < -30)) return false

  // North Atlantic
  if (lng > -55 && lng < -10 && lat > 25 && lat < 65) return false

  // South Atlantic
  if (lng > -38 && lng < 15 && lat > -55 && lat < 0) return false

  // Indian Ocean (main)
  if (lng > 55 && lng < 100 && lat > -55 && lat < 0) return false

  // Arabian Sea
  if (lng > 55 && lng < 68 && lat > 10 && lat < 25) return false

  // Bay of Bengal  
  if (lng > 82 && lng < 100 && lat > 5 && lat < 22) return false

  return true
}

// Color palette for war game feel
const TERRITORY_COLORS = [
  '#e8440a', '#0066ff', '#00aa44', '#cc00aa',
  '#ffaa00', '#00ccff', '#ff4466', '#44ff88',
]

export default function PixelMap({ pixels, onPixelClick, highlightedPixelId }) {
  const mapRef = useRef(null)
  const canvasLayerRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [tooltip, setTooltip] = useState(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (mapRef.current) return

    const initMap = async () => {
      const L = (await import('leaflet')).default

      const map = L.map('terrox-map', {
        center: [25, 15],
        zoom: 2,
        minZoom: 2,
        maxZoom: 7,
        zoomControl: true,
        attributionControl: false,
      })

      // Stamen Toner - COUNTRY BORDERS ONLY, no provinces, no roads, no labels
      L.tileLayer('https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        opacity: 1,
      }).addTo(map)

      mapRef.current = map

      const CanvasLayer = L.Layer.extend({
        onAdd: function (map) {
          this._map = map
          this._canvas = document.createElement('canvas')
          this._canvas.style.position = 'absolute'
          this._canvas.style.top = '0'
          this._canvas.style.left = '0'
          this._canvas.style.pointerEvents = 'none'
          this._canvas.style.zIndex = '400'
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

          // Draw pixel grid on land only
          for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
              const { lat, lng } = gridToLatLng(col, row)
              if (!bounds.contains([lat, lng])) continue
              if (!isLand(lat, lng)) continue

              const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
              const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
              const w = Math.max(1, br.x - tl.x)
              const h = Math.max(1, br.y - tl.y)

              // Visible grid on land
              ctx.strokeStyle = 'rgba(100, 160, 255, 0.18)'
              ctx.lineWidth = 0.5
              ctx.strokeRect(tl.x, tl.y, w, h)
            }
          }

          // Draw owned pixels with glow
          pixels.forEach((pixel, id) => {
            if (!pixel.owner_wallet) return
            const { col, row } = idToGrid(id)
            const { lat, lng } = gridToLatLng(col, row)
            if (!bounds.contains([lat, lng])) return
            if (!isLand(lat, lng)) return

            const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
            const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
            const w = Math.max(1, br.x - tl.x)
            const h = Math.max(1, br.y - tl.y)

            const color = pixel.color || '#e8440a'

            // Glow
            ctx.shadowColor = color
            ctx.shadowBlur = zoom >= 4 ? 8 : 4
            ctx.fillStyle = color
            ctx.globalAlpha = 0.85
            ctx.fillRect(tl.x, tl.y, w, h)
            ctx.globalAlpha = 1
            ctx.shadowBlur = 0

            // Border
            ctx.strokeStyle = 'rgba(255,255,255,0.25)'
            ctx.lineWidth = 0.5
            ctx.strokeRect(tl.x, tl.y, w, h)
          })

          // Highlighted pixel - pulsing border
          if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
            const { col, row } = idToGrid(highlightedPixelId)
            const { lat, lng } = gridToLatLng(col, row)
            const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
            const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
            const w = Math.max(2, br.x - tl.x)
            const h = Math.max(2, br.y - tl.y)

            ctx.shadowColor = '#e8440a'
            ctx.shadowBlur = 16
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 2
            ctx.strokeRect(tl.x, tl.y, w, h)
            ctx.shadowBlur = 0
          }
        },
        update: function () { this._redraw() }
      })

      const canvasLayer = new CanvasLayer()
      canvasLayer.addTo(map)
      canvasLayerRef.current = canvasLayer

      // Hover cursor change
      map.on('mousemove', (e) => {
        const { lat, lng } = e.latlng
        if (isLand(lat, lng)) {
          map.getContainer().style.cursor = 'crosshair'
        } else {
          map.getContainer().style.cursor = 'default'
        }
      })

      // Click - land only
      map.on('click', (e) => {
        const { lat, lng } = e.latlng
        if (!isLand(lat, lng)) return

        const col = Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH)
        const row = Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT)
        if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return

        const pixelId = row * GRID_COLS + col
        const { lat: centerLat, lng: centerLng } = gridToLatLng(col, row)
        onPixelClick(pixelId, centerLat, centerLng)
      })

      setMapReady(true)
    }

    initMap()
  }, [])

  useEffect(() => {
    if (canvasLayerRef.current && mapReady) {
      canvasLayerRef.current.update()
    }
  }, [pixels, highlightedPixelId, mapReady])

  return (
    <div
      id="terrox-map"
      style={{
        width: '100%',
        height: '100%',
        background: '#0a1f3d',
        cursor: 'crosshair',
      }}
    />
  )
}
