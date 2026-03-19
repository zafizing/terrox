export const GRID_COLS = 400
export const GRID_ROWS = 250

export const WORLD_BOUNDS = {
  minLat: -85,
  maxLat: 85,
  minLng: -180,
  maxLng: 180,
}

export const PIXEL_WIDTH = (WORLD_BOUNDS.maxLng - WORLD_BOUNDS.minLng) / GRID_COLS
export const PIXEL_HEIGHT = (WORLD_BOUNDS.maxLat - WORLD_BOUNDS.minLat) / GRID_ROWS

export const gridToLatLng = (col, row) => {
  const lat = WORLD_BOUNDS.maxLat - (row + 0.5) * PIXEL_HEIGHT
  const lng = WORLD_BOUNDS.minLng + (col + 0.5) * PIXEL_WIDTH
  return { lat, lng }
}

export const latLngToGrid = (lat, lng) => {
  const col = Math.floor((lng - WORLD_BOUNDS.minLng) / PIXEL_WIDTH)
  const row = Math.floor((WORLD_BOUNDS.maxLat - lat) / PIXEL_HEIGHT)
  return { col, row }
}

export const gridToId = (col, row) => row * GRID_COLS + col

export const idToGrid = (id) => {
  const col = id % GRID_COLS
  const row = Math.floor(id / GRID_COLS)
  return { col, row }
}

export const SPECIAL_PIXELS = [
  { lat: 48.8584, lng: 2.2945, type: 'legendary', name: 'Eiffel Tower' },
  { lat: 40.7484, lng: -73.9967, type: 'legendary', name: 'Times Square' },
  { lat: 51.5014, lng: -0.1419, type: 'legendary', name: 'Buckingham Palace' },
  { lat: 35.6762, lng: 139.6503, type: 'legendary', name: 'Tokyo' },
  { lat: 40.6892, lng: -74.0445, type: 'legendary', name: 'Statue of Liberty' },
  { lat: -33.8568, lng: 151.2153, type: 'legendary', name: 'Sydney Opera House' },
  { lat: 27.1751, lng: 78.0421, type: 'legendary', name: 'Taj Mahal' },
  { lat: 29.9792, lng: 31.1342, type: 'legendary', name: 'Great Pyramid' },
  { lat: 41.9029, lng: 12.4534, type: 'legendary', name: 'Vatican' },
  { lat: 37.8199, lng: -122.4783, type: 'legendary', name: 'Golden Gate Bridge' },
  { lat: 40.4319, lng: 116.5704, type: 'legendary', name: 'Great Wall of China' },
  { lat: 25.1972, lng: 55.2744, type: 'legendary', name: 'Burj Khalifa' },
  { lat: 38.9072, lng: -77.0369, type: 'strategic', name: 'Washington DC' },
  { lat: 39.9042, lng: 116.4074, type: 'strategic', name: 'Beijing' },
  { lat: 28.6139, lng: 77.2090, type: 'strategic', name: 'New Delhi' },
  { lat: 52.5200, lng: 13.4050, type: 'strategic', name: 'Berlin' },
  { lat: 48.8566, lng: 2.3522, type: 'strategic', name: 'Paris' },
  { lat: 51.5072, lng: -0.1276, type: 'strategic', name: 'London' },
  { lat: 41.0082, lng: 28.9784, type: 'strategic', name: 'Istanbul' },
  { lat: 55.7558, lng: 37.6173, type: 'strategic', name: 'Moscow' },
]

export const getSpecialPixelIds = () => {
  return SPECIAL_PIXELS.map(special => {
    const { col, row } = latLngToGrid(special.lat, special.lng)
    return { id: gridToId(col, row), type: special.type, name: special.name }
  })
}
