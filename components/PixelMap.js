import { useEffect, useRef, useState } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT } from '../lib/pixels'

function isLand(lat, lng) {
  if (lat > 84 || lat < -80) return false
  if (lng < -130 && lat > -55 && lat < 55) return false
  if (lng > 155 && lat > -50 && lat < 55) return false
  if (lng > -55 && lng < -10 && lat > 25 && lat < 65) return false
  if (lng > -38 && lng < 15 && lat > -55 && lat < 0) return false
  if (lng > 55 && lng < 100 && lat > -55 && lat < 0) return false
  if (lng > 55 && lng < 68 && lat > 10 && lat < 25) return false
  if (lng > 82 && lng < 100 && lat > 5 && lat < 22) return false
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
        maxZoom: 7,
        zoomControl: true,
        attributionControl: false,
      })

      // CartoDB Positron No Labels - free, no API key, clean country borders only
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
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

          // Pixel grid on land only
          for (let row = 0; row < GRID_ROWS; row++) {
            for (let col = 0; col < GRID_COLS; col++) {
              const { lat, lng } = gridToLatLng(col, row)
              if (!bounds.contains([lat, lng])) continue
              if (!isLand(lat, lng)) continue
              const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
              const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
              const w = Math.max(1, br.x - tl.x)
              const h = Math.max(1, br.y - tl.y)
              ctx.strokeStyle = 'rgba(120, 180, 255, 0.2)'
              ctx.lineWidth = 0.5
              ctx.strokeRect(tl.x, tl.y, w, h)
            }
          }

          // Owned pixels with glow
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
            ctx.shadowColor = color
            ctx.shadowBlur = zoom >= 4 ? 10 : 5
            ctx.fillStyle = color
            ctx.globalAlpha = 0.85
            ctx.fillRect(tl.x, tl.y, w, h)
            ctx.globalAlpha = 1
            ctx.shadowBlur = 0
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'
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

      map.on('mousemove', (e) => {
        map.getContainer().style.cursor = isLand(e.latlng.lat, e.latlng.lng) ? 'crosshair' : 'not-allowed'
      })

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
    <div id="terrox-map" style={{ width: '100%', height: '100%', background: '#0a1f3d' }} />
  )
}
