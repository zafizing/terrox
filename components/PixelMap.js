import { useEffect, useRef, useState } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT } from '../lib/pixels'

// Rough land bounding boxes to prevent ocean pixel purchases
// These are simplified polygons for major land masses
function isLand(lat, lng) {
  // Exclude clear ocean areas
  // North Atlantic
  if (lat > 20 && lat < 65 && lng > -60 && lng < -10) return false
  // South Atlantic
  if (lat > -55 && lat < 5 && lng > -40 && lng < 10) return false
  // Central Pacific
  if (lat > -50 && lat < 60 && lng > 160 && lng < 180) return false
  if (lat > -50 && lat < 60 && lng > -180 && lng < -100) return false
  // Indian Ocean
  if (lat > -50 && lat < 5 && lng > 55 && lng < 95) return false
  // Arctic Ocean
  if (lat > 80) return false
  // Antarctic Ocean
  if (lat < -78) return false
  // North Pacific
  if (lat > 20 && lat < 60 && lng > -180 && lng < -130) return false
  if (lat > 20 && lat < 60 && lng > 155 && lng < 180) return false
  // Mediterranean (allow - has islands)
  // Caribbean rough
  if (lat > 10 && lat < 25 && lng > -85 && lng < -60) return false

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
        center: [25, 15],
        zoom: 2,
        minZoom: 2,
        maxZoom: 6,
        zoomControl: true,
        attributionControl: false,
      })

      // Ocean layer - deep blue styled
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
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

          // Draw pixel grid only on land cells
          ctx.lineWidth = 0.5

          for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
              const { lat, lng } = gridToLatLng(col, row)
              if (!bounds.contains([lat, lng])) continue
              if (!isLand(lat, lng)) continue

              const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
              const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
              const w = Math.max(1, br.x - tl.x)
              const h = Math.max(1, br.y - tl.y)

              // Subtle land tint
              if (zoom >= 3) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.015)'
                ctx.fillRect(tl.x, tl.y, w, h)
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
                ctx.strokeRect(tl.x, tl.y, w, h)
              }
            }
          }

          // Draw owned pixels
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

            // Glow effect
            ctx.shadowColor = pixel.color || '#e8440a'
            ctx.shadowBlur = 6
            ctx.fillStyle = pixel.color || 'rgba(232, 68, 10, 0.8)'
            ctx.fillRect(tl.x, tl.y, w, h)
            ctx.shadowBlur = 0
            ctx.strokeStyle = 'rgba(255,255,255,0.2)'
            ctx.lineWidth = 0.5
            ctx.strokeRect(tl.x, tl.y, w, h)
          })

          // Highlighted pixel
          if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
            const { col, row } = idToGrid(highlightedPixelId)
            const { lat, lng } = gridToLatLng(col, row)
            const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
            const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
            const w = Math.max(2, br.x - tl.x)
            const h = Math.max(2, br.y - tl.y)
            ctx.shadowColor = '#e8440a'
            ctx.shadowBlur = 12
            ctx.strokeStyle = '#e8440a'
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

      map.on('click', (e) => {
        const { lat, lng } = e.latlng

        // Block ocean clicks
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
    <div id="terrox-map" style={{ width: '100%', height: '100%', background: '#0a1628' }} />
  )
}
