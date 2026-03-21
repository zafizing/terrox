// World grid constants — matches worldmap.json
export const GRID_COLS = 320
export const GRID_ROWS = 160
export const TOTAL_PIXELS = GRID_COLS * GRID_ROWS // 51,200

export const idToGrid = (id) => ({
  col: id % GRID_COLS,
  row: Math.floor(id / GRID_COLS)
})

export const gridToId = (col, row) => row * GRID_COLS + col

export const gridToLatLng = (col, row) => ({
  lat: 85 - (row + 0.5) * 170 / GRID_ROWS,
  lng: -180 + (col + 0.5) * 360 / GRID_COLS,
})
