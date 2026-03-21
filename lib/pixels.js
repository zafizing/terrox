export const GRID_COLS = 320
export const GRID_ROWS = 160
export const TOTAL_PIXELS = GRID_COLS * GRID_ROWS // ~51,200 ≈ 50k

export const WORLD_BOUNDS = {
  minLat: -85, maxLat: 85,
  minLng: -180, maxLng: 180,
}

export const PIXEL_WIDTH = (WORLD_BOUNDS.maxLng - WORLD_BOUNDS.minLng) / GRID_COLS
export const PIXEL_HEIGHT = (WORLD_BOUNDS.maxLat - WORLD_BOUNDS.minLat) / GRID_ROWS

export const gridToLatLng = (col, row) => ({
  lat: WORLD_BOUNDS.maxLat - (row + 0.5) * PIXEL_HEIGHT,
  lng: WORLD_BOUNDS.minLng + (col + 0.5) * PIXEL_WIDTH,
})

export const latLngToGrid = (lat, lng) => ({
  col: Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH),
  row: Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT),
})

export const gridToId = (col, row) => row * GRID_COLS + col
export const idToGrid = (id) => ({ col: id % GRID_COLS, row: Math.floor(id / GRID_COLS) })

// Continent mapping by lat/lng
export const getContinent = (lat, lng) => {
  if (lat > 35 && lng > -25 && lng < 65) return 'Europe'
  if (lat > -40 && lat < 35 && lng > -20 && lng < 55) return 'Africa'
  if (lat > 5 && lng > 25 && lng < 180) return 'Asia'
  if (lat > -15 && lat < 5 && lng > 95 && lng < 180) return 'Asia'
  if (lat > -50 && lat < 15 && lng > 95 && lng < 180) return 'Oceania'
  if (lat > 15 && lng > -170 && lng < -50) return 'North America'
  if (lat <= 15 && lat > -60 && lng > -85 && lng < -30) return 'South America'
  if (lat <= 15 && lng > -170 && lng < -85) return 'North America'
  return 'Other'
}
