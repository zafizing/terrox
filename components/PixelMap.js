import { useEffect, useRef, useState, useCallback } from 'react'
import { GRID_COLS, GRID_ROWS, WORLD_BOUNDS, gridToLatLng, idToGrid, PIXEL_WIDTH, PIXEL_HEIGHT } from '../lib/pixels'

export default function PixelMap({ pixels, onPixelClick, highlightedPixelId }) {
  const mapRef = useRef(null)
  const canvasLayerRef = useRef(null)
  const geoRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  // Load GeoJSON and init map
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (mapRef.current) return

    const initMap = async () => {
      const L = (await import('leaflet')).default

      const map = L.map('terrox-map', {
        center: [20, 10],
        zoom: 2,
        minZoom: 2,
        maxZoom: 7,
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
      })

      // Pure ocean background - no tiles
      // We use a minimal tile just for ocean texture
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        opacity: 1,
      }).addTo(map)

      mapRef.current = map

      // Load world GeoJSON for land detection and drawing
      try {
        const res = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
        const geo = await res.json()
        geoRef.current = geo

        // Draw country borders only (no fill - we use CSS filter for land color)
        L.geoJSON(geo, {
          style: {
            color: '#3a5a7a',
            weight: 0.8,
            opacity: 0.6,
            fillColor: '#1a2838',
            fillOpacity: 0.0,
          }
        }).addTo(map)

      } catch (e) {
        console.log('GeoJSON load failed, using tile-based land detection')
      }

      // Canvas overlay for pixel grid and owned pixels
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
          if (zoom >= 3) {
            ctx.strokeStyle = 'rgba(100, 180, 255, 0.15)'
            ctx.lineWidth = 0.4
            for (let row = 0; row < GRID_ROWS; row++) {
              for (let col = 0; col < GRID_COLS; col++) {
                const { lat, lng } = gridToLatLng(col, row)
                if (!bounds.contains([lat, lng])) continue
                if (!isLandCoord(lat, lng)) continue
                const tl = map.latLngToContainerPoint([lat + PIXEL_HEIGHT / 2, lng - PIXEL_WIDTH / 2])
                const br = map.latLngToContainerPoint([lat - PIXEL_HEIGHT / 2, lng + PIXEL_WIDTH / 2])
                ctx.strokeRect(tl.x, tl.y, Math.max(1, br.x - tl.x), Math.max(1, br.y - tl.y))
              }
            }
          }

          // Draw owned pixels
          pixels.forEach((pixel, id) => {
            if (!pixel.owner_wallet) return
            const { col, row } = idToGrid(id)
            const { lat, lng } = gridToLatLng(col, row)
            if (!bounds.contains([lat, lng])) return
            if (!isLandCoord(lat, lng)) return
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
            ctx.strokeStyle = 'rgba(255,255,255,0.25)'
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

      // Cursor + click handling
      map.on('mousemove', (e) => {
        const land = isLandCoord(e.latlng.lat, e.latlng.lng)
        map.getContainer().style.cursor = land ? 'crosshair' : 'not-allowed'
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
    if (canvasLayerRef.current && mapReady) {
      canvasLayerRef.current.update()
    }
  }, [pixels, highlightedPixelId, mapReady])

  return (
    <div id="terrox-map" style={{ width: '100%', height: '100%', background: '#071428' }} />
  )
}

// ─── Land detection using point-in-polygon for major landmasses ───────────────
// Comprehensive list covering all continents properly
function isLandCoord(lat, lng) {
  // Polar regions
  if (lat > 84 || lat < -84) return false

  // Check each major ocean — if point falls in ocean return false
  for (const ocean of OCEAN_ZONES) {
    if (lat > ocean[0] && lat < ocean[1] && lng > ocean[2] && lng < ocean[3]) {
      return false
    }
  }
  return true
}

// Major ocean bounding boxes - conservative (err on side of including land)
const OCEAN_ZONES = [
  // North Pacific (main)
  [-60, 65, -180, -120],
  // Central Pacific
  [-60, 60, 155, 180],
  // South Pacific
  [-65, -10, -180, -70],
  // North Atlantic main
  [25, 65, -55, -10],
  // South Atlantic
  [-55, 5, -42, 12],
  // Indian Ocean main
  [-60, 0, 50, 100],
  // Arabian Sea
  [5, 25, 55, 72],
  // Bay of Bengal
  [5, 22, 82, 100],
  // Southern Ocean
  [-84, -62, -180, 180],
  // Arctic Ocean
  [78, 84, -180, 180],
  // Hudson Bay
  [50, 66, -95, -75],
  // Greenland Sea
  [65, 80, -45, 10],
  // Bering Sea
  [52, 68, 162, 180],
  [52, 68, -180, -158],
  // Gulf of Mexico
  [18, 30, -97, -80],
  // Caribbean
  [10, 25, -87, -60],
  // Norwegian Sea
  [62, 78, -15, 30],
]
