import { useEffect, useRef, useState } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT } from '../lib/pixels'

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
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 6,
        zoomControl: true,
        attributionControl: false,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',
        opacity: 0.3,
      }).addTo(map)

      mapRef.current = map

      const CanvasLayer = L.Layer.extend({
        onAdd: function(map) {
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
        onRemove: function(map) {
          map.getPanes().overlayPane.removeChild(this._canvas)
          map.off('moveend zoomend resize', this._redraw, this)
        },
        _redraw: function() {
          const map = this._map
          const canvas = this._canvas
          const size = map.getSize()
          canvas.width = size.x
          canvas.height = size.y
          const ctx = canvas.getContext('2d')
          ctx.clearRect(0, 0, size.x, size.y)

          const bounds = map.getBounds()
          const zoom = map.getZoom()
          if (zoom < 2) return

          pixels.forEach((pixel, id) => {
            if (!pixel.owner_wallet) return
            const { col, row } = idToGrid(id)
            const { lat, lng } = gridToLatLng(col, row)
            if (!bounds.contains([lat, lng])) return

            const topLeft = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
            const bottomRight = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
            const w = Math.max(1, bottomRight.x - topLeft.x)
            const h = Math.max(1, bottomRight.y - topLeft.y)

            if (pixel.is_special && pixel.special_type === 'legendary') {
              ctx.fillStyle = 'rgba(255, 215, 0, 0.7)'
              ctx.shadowColor = '#ffd700'
              ctx.shadowBlur = 8
            } else if (pixel.is_special && pixel.special_type === 'strategic') {
              ctx.fillStyle = 'rgba(0, 212, 255, 0.6)'
              ctx.shadowColor = '#00d4ff'
              ctx.shadowBlur = 6
            } else {
              ctx.fillStyle = pixel.color || 'rgba(255, 77, 0, 0.5)'
              ctx.shadowBlur = 0
            }

            ctx.fillRect(topLeft.x, topLeft.y, w, h)
            ctx.shadowBlur = 0
            ctx.strokeStyle = 'rgba(255,255,255,0.1)'
            ctx.lineWidth = 0.5
            ctx.strokeRect(topLeft.x, topLeft.y, w, h)
          })

          if (highlightedPixelId !== null && highlightedPixelId !== undefined) {
            const { col, row } = idToGrid(highlightedPixelId)
            const { lat, lng } = gridToLatLng(col, row)
            const topLeft = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
            const bottomRight = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
            const w = Math.max(2, bottomRight.x - topLeft.x)
            const h = Math.max(2, bottomRight.y - topLeft.y)
            ctx.strokeStyle = '#ff4d00'
            ctx.lineWidth = 2
            ctx.strokeRect(topLeft.x, topLeft.y, w, h)
          }
        },
        update: function() {
          this._redraw()
        }
      })

      const canvasLayer = new CanvasLayer()
      canvasLayer.addTo(map)
      canvasLayerRef.current = canvasLayer

      map.on('click', (e) => {
        const { lat, lng } = e.latlng
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
      style={{ width: '100%', height: '100%', background: '#080a0e' }}
    />
  )
}
