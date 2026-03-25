import { useEffect, useRef, useState, useCallback } from 'react'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice } from '../lib/solana'
import { GRID_COLS, GRID_ROWS } from '../lib/pixels'

// ── Color Palette ──────────────────────────────────────────────────────────
const CONTINENT_COLORS = {
  'Africa':   { base: '#1e2a1a', bright: '#2a3d22' },
  'Americas': { base: '#1a2220', bright: '#243530' },
  'Asia':     { base: '#2a221a', bright: '#3d3222' },
  'Europe':   { base: '#1a1e28', bright: '#252e3d' },
  'Oceania':  { base: '#1a2628', bright: '#22353d' },
}
const DEFAULT_CONT = { base: '#1a2028', bright: '#253040' }

const OCEAN_DEEP    = '#030a18'
const OCEAN_MID     = '#061428'
const OCEAN_SHALLOW = '#0a1e38'
const BORDER_COLOR  = 'rgba(80,160,220,0.45)'
const GRID_COLOR    = 'rgba(60,130,200,0.18)'
const CLAIM_GLOW    = '#e8440a'

// ── SVG Path Parsing ───────────────────────────────────────────────────────
function parsePath(d) {
  const rings = []
  for (const seg of d.split('Z')) {
    if (!seg.trim()) continue
    const pts = seg.replace(/^M/, '').split(/[ML]/).map(s => {
      const [x, y] = s.split(',').map(Number)
      return [x, y]
    }).filter(p => !isNaN(p[0]) && !isNaN(p[1]))
    if (pts.length >= 3) rings.push(pts)
  }
  return rings
}

function traceCountry(ctx, rings, cols, rows, w, h) {
  for (const ring of rings) {
    if (!ring.length) continue
    ctx.moveTo(ring[0][0] / cols * w, ring[0][1] / rows * h)
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(ring[i][0] / cols * w, ring[i][1] / rows * h)
    }
    ctx.closePath()
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function PixelMap({ pixels, onPurchaseIntent, highlightedPixelId }) {
  const canvasRef = useRef(null)
  const worldRef  = useRef(null)
  const cacheRef  = useRef({
    base: null, clipMask: null, hitData: null, hitW: 0, hitH: 0,
    parsedPaths: null, lastW: 0, lastH: 0, lastDpr: 0, baseTier: 0,
  })
  const viewRef   = useRef({ zoom: 1, panX: 0, panY: 0 })
  const dragRef   = useRef({ on: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false })
  const sizeRef   = useRef({ w: 800, h: 600, dpr: 1 })
  const rafRef    = useRef(null)
  const hoverRef  = useRef(null)
  const touchRef  = useRef({ lastDist: 0 })
  const [popup, setPopup]     = useState(null)
  const [loading, setLoading] = useState(true)

  // ── Build all caches (runs once on load + on resize) ─────────────────
  const buildCaches = useCallback((w, h, dpr, world) => {
    const cache = cacheRef.current
    if (cache.lastW === w && cache.lastH === h && cache.lastDpr === dpr && cache.base) return
    cache.lastW = w; cache.lastH = h; cache.lastDpr = dpr

    const { cols, rows, countries } = world

    // Pre-parse paths once
    if (!cache.parsedPaths) {
      cache.parsedPaths = countries.map(c => ({
        rings: parsePath(c.p), continent: c.k, name: c.n, subregion: c.s,
      }))
    }

    // Build base at current zoom tier
    rebuildBase(w, h, dpr, world, 1)

    // ── Clip mask (CSS resolution, white = land) ──────────────────────
    const clip = document.createElement('canvas')
    clip.width = w; clip.height = h
    const mx = clip.getContext('2d')
    mx.fillStyle = '#000'
    mx.fillRect(0, 0, w, h)
    mx.fillStyle = '#fff'
    for (const p of cache.parsedPaths) {
      mx.beginPath()
      traceCountry(mx, p.rings, cols, rows, w, h)
      mx.fill()
    }
    cache.clipMask = clip

    // ── Hit map (CSS resolution, country index per pixel) ─────────────
    const hit = document.createElement('canvas')
    hit.width = w; hit.height = h
    const hx = hit.getContext('2d')
    countries.forEach((country, idx) => {
      const r = (idx + 1) & 0xff, g = ((idx + 1) >> 8) & 0xff
      hx.fillStyle = hx.strokeStyle = `rgb(${r},${g},0)`
      hx.lineWidth = 1.5
      hx.beginPath()
      traceCountry(hx, cache.parsedPaths[idx].rings, cols, rows, w, h)
      hx.fill(); hx.stroke()
    })
    const img = hx.getImageData(0, 0, w, h).data
    const hitArr = new Uint16Array(w * h)
    for (let i = 0; i < w * h; i++) hitArr[i] = img[i * 4] + (img[i * 4 + 1] << 8)
    cache.hitData = hitArr; cache.hitW = w; cache.hitH = h
  }, [])

  // ── Rebuild base map at a specific scale tier ───────────────────────
  function rebuildBase(w, h, dpr, world, tier) {
    const cache = cacheRef.current
    const { cols, rows } = world
    const scale = tier
    const pw = Math.round(w * dpr * scale), ph = Math.round(h * dpr * scale)

    // Cap at 4096px to avoid memory issues
    const maxDim = 4096
    const actualW = Math.min(pw, maxDim)
    const actualH = Math.min(ph, maxDim)

    const base = document.createElement('canvas')
    base.width = actualW; base.height = actualH
    const bx = base.getContext('2d')

    // Ocean radial gradient
    const cx = actualW / 2, cy = actualH * 0.45
    const grad = bx.createRadialGradient(cx, cy, 0, cx, cy, actualW * 0.7)
    grad.addColorStop(0, OCEAN_SHALLOW)
    grad.addColorStop(0.5, OCEAN_MID)
    grad.addColorStop(1, OCEAN_DEEP)
    bx.fillStyle = grad
    bx.fillRect(0, 0, actualW, actualH)

    // Subtle ocean wave lines
    bx.strokeStyle = 'rgba(15,40,80,0.2)'
    bx.lineWidth = 0.5 * dpr * scale
    for (let y = 0; y < actualH; y += 30 * dpr * scale) {
      bx.beginPath()
      for (let x = 0; x < actualW; x += 4) {
        const wave = Math.sin(x * 0.008 / scale + y * 0.003 / scale) * 3 * dpr * scale
        x === 0 ? bx.moveTo(x, y + wave) : bx.lineTo(x, y + wave)
      }
      bx.stroke()
    }

    // Land fills per continent
    for (const p of cache.parsedPaths) {
      const pal = CONTINENT_COLORS[p.continent] || DEFAULT_CONT
      bx.beginPath()
      traceCountry(bx, p.rings, cols, rows, actualW, actualH)
      bx.fillStyle = pal.base
      bx.fill()
    }

    // Borders with glow
    bx.strokeStyle = BORDER_COLOR
    bx.lineWidth = 0.7 * dpr * scale
    bx.shadowColor = 'rgba(60,140,220,0.25)'
    bx.shadowBlur = 3 * dpr * scale
    for (const p of cache.parsedPaths) {
      bx.beginPath()
      traceCountry(bx, p.rings, cols, rows, actualW, actualH)
      bx.stroke()
    }
    bx.shadowBlur = 0

    cache.base = base
    cache.baseTier = tier
  }

  // ── Init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasRef.current?.parentElement
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth || 800, h = el.clientHeight || 600
    sizeRef.current = { w, h, dpr }
    const c = canvasRef.current
    c.width = w * dpr; c.height = h * dpr
    c.style.width = w + 'px'; c.style.height = h + 'px'

    fetch('/worldmap.json').then(r => r.json()).then(data => {
      worldRef.current = data
      buildCaches(w, h, dpr, data)
      setLoading(false)
      draw()
    })

    const onResize = () => {
      const dpr = window.devicePixelRatio || 1
      const nw = el.clientWidth, nh = el.clientHeight
      sizeRef.current = { w: nw, h: nh, dpr }
      c.width = nw * dpr; c.height = nh * dpr
      c.style.width = nw + 'px'; c.style.height = nh + 'px'
      if (worldRef.current) {
        cacheRef.current.lastW = 0 // force rebuild
        buildCaches(nw, nh, dpr, worldRef.current)
      }
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [buildCaches])

  useEffect(() => { if (!loading) draw() }, [pixels, highlightedPixelId, loading])

  // ── Hit test ─────────────────────────────────────────────────────────
  function getCountryIdx(sx, sy) {
    const c = cacheRef.current
    if (!c.hitData) return -1
    const { zoom, panX, panY } = viewRef.current
    const bx = Math.round((sx - panX) / zoom), by = Math.round((sy - panY) / zoom)
    if (bx < 0 || bx >= c.hitW || by < 0 || by >= c.hitH) return -1
    return c.hitData[by * c.hitW + bx] - 1
  }

  function screenToPixelId(sx, sy) {
    const { w, h } = sizeRef.current
    const { zoom, panX, panY } = viewRef.current
    const col = Math.floor((sx - panX) / zoom / w * GRID_COLS)
    const row = Math.floor((sy - panY) / zoom / h * GRID_ROWS)
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null
    return row * GRID_COLS + col
  }

  function getCountryPixels(countryName) {
    const world = worldRef.current, c = cacheRef.current
    if (!world || !c.hitData) return []
    const idx = world.countries.findIndex(ct => ct.n === countryName) + 1
    if (!idx) return []
    const { w, h } = sizeRef.current
    const res = []
    for (let row = 0; row < GRID_ROWS; row++)
      for (let col = 0; col < GRID_COLS; col++) {
        const sx = Math.round((col + 0.5) / GRID_COLS * w)
        const sy = Math.round((row + 0.5) / GRID_ROWS * h)
        if (sx < c.hitW && sy < c.hitH && c.hitData[sy * c.hitW + sx] === idx)
          res.push(row * GRID_COLS + col)
      }
    return res
  }

  function getSubregionPixels(subregion) {
    const world = worldRef.current, c = cacheRef.current
    if (!world || !c.hitData) return []
    const idxSet = new Set()
    world.countries.forEach((ct, i) => { if (ct.s === subregion) idxSet.add(i + 1) })
    const { w, h } = sizeRef.current
    const res = []
    for (let row = 0; row < GRID_ROWS; row++)
      for (let col = 0; col < GRID_COLS; col++) {
        const sx = Math.round((col + 0.5) / GRID_COLS * w)
        const sy = Math.round((row + 0.5) / GRID_ROWS * h)
        if (sx < c.hitW && sy < c.hitH && idxSet.has(c.hitData[sy * c.hitW + sx]))
          res.push(row * GRID_COLS + col)
      }
    return res
  }

  function calcPrice(pids) {
    let t = 0
    for (const pid of pids) {
      const p = pixels.get(pid)
      t += p?.current_price_sol ? calculateNextPrice(p.current_price_sol) : BASE_PIXEL_PRICE_SOL
    }
    return parseFloat(t.toFixed(4))
  }

  // ── Build popup data ─────────────────────────────────────────────────
  function buildPopup(screenX, screenY, canvasX, canvasY) {
    const ci = getCountryIdx(canvasX, canvasY)
    if (ci < 0) return null
    const world = worldRef.current
    if (!world) return null
    const country = world.countries[ci]
    const pid = screenToPixelId(canvasX, canvasY)
    if (pid === null) return null
    const cPids = getCountryPixels(country.n)
    const sPids = getSubregionPixels(country.s)
    return {
      x: screenX, y: screenY,
      pixelId: pid, pixel: pixels.get(pid) || null,
      country: country.n, subregion: country.s, continent: country.k,
      cPids, sPids,
      pixelPrice: pixels.get(pid)?.current_price_sol
        ? calculateNextPrice(pixels.get(pid).current_price_sol) : BASE_PIXEL_PRICE_SOL,
      countryPrice: calcPrice(cPids),
      subregionPrice: calcPrice(sPids),
    }
  }

  // ── Main render ──────────────────────────────────────────────────────
  const draw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const cache = cacheRef.current
      if (!canvas || !cache.base) return
      const { w, h, dpr } = sizeRef.current
      const { zoom, panX, panY } = viewRef.current
      const ctx = canvas.getContext('2d')

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = OCEAN_DEEP
      ctx.fillRect(0, 0, w, h)

      // Re-render base at higher res if zoom tier changed (debounced)
      const neededTier = zoom <= 1.5 ? 1 : zoom <= 3 ? 2 : zoom <= 6 ? 3 : 4
      if (cache.baseTier !== neededTier && worldRef.current && !cache.rebuildPending) {
        cache.rebuildPending = true
        setTimeout(() => {
          rebuildBase(w, h, dpr, worldRef.current, neededTier)
          cache.rebuildPending = false
          draw()  // re-render with new base
        }, 150)
      }

      // Base map — higher tier = more pixels = sharper at zoom
      ctx.save()
      ctx.translate(panX, panY)
      ctx.scale(zoom, zoom)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(cache.base, 0, 0, w, h)
      ctx.restore()

      const cw = w * zoom / GRID_COLS
      const ch = h * zoom / GRID_ROWS

      // Grid + claimed pixels masked to land
      if (cw > 3 && cache.clipMask) {
        // Step 1: Draw grid + claimed pixels onto a temp canvas
        const tmp = document.createElement('canvas')
        tmp.width = w; tmp.height = h
        const tx = tmp.getContext('2d')

        const cellW = w / GRID_COLS, cellH = h / GRID_ROWS

        // Visible range in grid coordinates
        const sc = Math.max(0, Math.floor(-panX / zoom / cellW) - 1)
        const ec = Math.min(GRID_COLS, Math.ceil((w - panX) / zoom / cellW) + 1)
        const sr = Math.max(0, Math.floor(-panY / zoom / cellH) - 1)
        const er = Math.min(GRID_ROWS, Math.ceil((h - panY) / zoom / cellH) + 1)

        // Grid lines
        if (cw > 6) {
          tx.strokeStyle = GRID_COLOR
          tx.lineWidth = 0.4
          for (let c = sc; c <= ec; c++) {
            const x = c * cellW
            tx.beginPath(); tx.moveTo(x, sr * cellH); tx.lineTo(x, er * cellH); tx.stroke()
          }
          for (let r = sr; r <= er; r++) {
            const y = r * cellH
            tx.beginPath(); tx.moveTo(sc * cellW, y); tx.lineTo(ec * cellW, y); tx.stroke()
          }
        }

        // Claimed pixels with glow
        pixels.forEach((pixel, id) => {
          if (!pixel.owner_wallet) return
          const col = id % GRID_COLS, row = Math.floor(id / GRID_COLS)
          const x = col * cellW, y = row * cellH
          tx.shadowColor = pixel.color || CLAIM_GLOW
          tx.shadowBlur = 4
          tx.fillStyle = pixel.color || CLAIM_GLOW
          tx.globalAlpha = 0.8
          tx.fillRect(x, y, cellW, cellH)
          tx.globalAlpha = 1
          tx.shadowBlur = 0
        })

        // Step 2: Cut with land mask — only land pixels survive
        tx.globalCompositeOperation = 'destination-in'
        tx.drawImage(cache.clipMask, 0, 0)
        tx.globalCompositeOperation = 'source-over'

        // Step 3: Overlay masked grid onto main canvas with zoom
        ctx.save()
        ctx.translate(panX, panY)
        ctx.scale(zoom, zoom)
        ctx.imageSmoothingEnabled = zoom < 2.5
        ctx.drawImage(tmp, 0, 0)
        ctx.restore()
      }

      // Highlighted pixel
      if (highlightedPixelId != null) {
        const cellW = w / GRID_COLS * zoom, cellH = h / GRID_ROWS * zoom
        const col = highlightedPixelId % GRID_COLS
        const row = Math.floor(highlightedPixelId / GRID_COLS)
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.shadowColor = CLAIM_GLOW
        ctx.shadowBlur = 8
        ctx.strokeRect(panX + col * cellW, panY + row * cellH, cellW, cellH)
        ctx.shadowBlur = 0
      }
    })
  }, [pixels, highlightedPixelId])

  // ── Mouse events ─────────────────────────────────────────────────────
  function onDown(e) {
    clearTimeout(hoverRef.current)
    dragRef.current = { on: true, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false }
  }

  function onMove(e) {
    const d = dragRef.current
    if (d.on) {
      if (Math.abs(e.clientX - d.sx) > 4 || Math.abs(e.clientY - d.sy) > 4) d.moved = true
      viewRef.current.panX += e.clientX - d.lx
      viewRef.current.panY += e.clientY - d.ly
      d.lx = e.clientX; d.ly = e.clientY
      canvasRef.current.style.cursor = 'grabbing'
      setPopup(null); draw(); return
    }
    const r = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    const ci = getCountryIdx(sx, sy)
    canvasRef.current.style.cursor = ci >= 0 ? 'crosshair' : 'default'

    clearTimeout(hoverRef.current)
    if (ci >= 0) {
      hoverRef.current = setTimeout(() => {
        const p = buildPopup(e.clientX, e.clientY, sx, sy)
        if (p) setPopup(p)
      }, 350)
    } else {
      setPopup(null)
    }
  }

  function onUp() { dragRef.current.on = false }
  function onLeave() { dragRef.current.on = false; clearTimeout(hoverRef.current) }

  function onClick(e) {
    if (dragRef.current.moved) { dragRef.current.moved = false; return }
    const r = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    clearTimeout(hoverRef.current)
    const p = buildPopup(e.clientX, e.clientY, sx, sy)
    if (p) setPopup(p)
  }

  function onWheel(e) {
    e.preventDefault(); setPopup(null)
    const r = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const f = e.deltaY > 0 ? 0.85 : 1.18
    const nz = Math.min(Math.max(viewRef.current.zoom * f, 0.8), 30)
    const s = nz / viewRef.current.zoom
    viewRef.current = { zoom: nz, panX: mx - s * (mx - viewRef.current.panX), panY: my - s * (my - viewRef.current.panY) }
    draw()
  }

  // ── Touch events ─────────────────────────────────────────────────────
  function onTouchStart(e) {
    setPopup(null)
    if (e.touches.length === 1) {
      const t = e.touches[0]
      dragRef.current = { on: true, sx: t.clientX, sy: t.clientY, lx: t.clientX, ly: t.clientY, moved: false }
    } else if (e.touches.length === 2) {
      dragRef.current.on = false
      const [a, b] = [e.touches[0], e.touches[1]]
      touchRef.current.lastDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }
  }

  function onTouchMove(e) {
    e.preventDefault()
    if (e.touches.length === 1 && dragRef.current.on) {
      const t = e.touches[0]
      if (Math.abs(t.clientX - dragRef.current.sx) > 4 || Math.abs(t.clientY - dragRef.current.sy) > 4)
        dragRef.current.moved = true
      viewRef.current.panX += t.clientX - dragRef.current.lx
      viewRef.current.panY += t.clientY - dragRef.current.ly
      dragRef.current.lx = t.clientX; dragRef.current.ly = t.clientY
      draw()
    } else if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
      if (touchRef.current.lastDist > 0) {
        const r = canvasRef.current.getBoundingClientRect()
        const mx = mid.x - r.left, my = mid.y - r.top
        const f = dist / touchRef.current.lastDist
        const nz = Math.min(Math.max(viewRef.current.zoom * f, 0.8), 30)
        const s = nz / viewRef.current.zoom
        viewRef.current = { zoom: nz, panX: mx - s * (mx - viewRef.current.panX), panY: my - s * (my - viewRef.current.panY) }
      }
      touchRef.current.lastDist = dist
      draw()
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) touchRef.current.lastDist = 0
    if (e.touches.length === 0) {
      if (!dragRef.current.moved && dragRef.current.on) {
        const r = canvasRef.current.getBoundingClientRect()
        const sx = dragRef.current.sx - r.left, sy = dragRef.current.sy - r.top
        const p = buildPopup(dragRef.current.sx, dragRef.current.sy, sx, sy)
        if (p) setPopup(p)
      }
      dragRef.current = { on: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', touchAction: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', background: OCEAN_DEEP }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onMouseLeave={onLeave} onClick={onClick} onWheel={onWheel}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      />

      {loading && (
        <div style={{
          position: 'absolute', inset: 0, background: OCEAN_DEEP,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 12, color: '#1a3a5a' }}>
            LOADING WORLD
          </div>
          <div style={{ width: 120, height: 2, background: '#0a1830', overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', width: '30%', height: '100%', background: CLAIM_GLOW, animation: 'tslide 1s ease-in-out infinite' }} />
          </div>
          <style>{`@keyframes tslide{0%{left:-30%}100%{left:130%}}`}</style>
        </div>
      )}

      {popup && (
        <div
          onMouseEnter={() => clearTimeout(hoverRef.current)}
          onMouseLeave={() => setPopup(null)}
          style={{
            position: 'fixed',
            left: Math.min(popup.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 800) - 280),
            top: Math.max(popup.y - 16, 60),
            background: 'linear-gradient(180deg, #0c1a2e 0%, #081222 100%)',
            border: '1px solid #1a3050',
            borderTop: `2px solid ${CLAIM_GLOW}`,
            width: 260, zIndex: 9999, pointerEvents: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.9), 0 0 30px rgba(232,68,10,0.08)',
          }}
        >
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid #0e2035' }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 9, letterSpacing: 3, color: '#2a5a80', marginBottom: 6, textTransform: 'uppercase' }}>
              Pixel #{popup.pixelId} · {popup.subregion}
            </div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 24, letterSpacing: 4, color: '#d8eaf8', lineHeight: 1 }}>
              {popup.country}
            </div>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, marginTop: 6, color: popup.pixel?.owner_wallet ? '#5a9abc' : '#3aaa6a' }}>
              {popup.pixel?.owner_wallet
                ? `Owned by ${popup.pixel.owner_name || popup.pixel.owner_wallet.slice(0, 8) + '…'}`
                : '⬡ Unclaimed territory'}
            </div>
          </div>
          <div style={{ padding: '12px 18px 16px' }}>
            {[
              { label: 'This Pixel', sub: 'Single territory', price: popup.pixelPrice,
                onClick: () => { onPurchaseIntent({ type: 'pixel', pixelId: popup.pixelId, pixel: popup.pixel, priceSol: popup.pixelPrice }); setPopup(null) } },
              { label: popup.country, sub: `${popup.cPids.length.toLocaleString()} pixels`, price: popup.countryPrice,
                onClick: () => { onPurchaseIntent({ type: 'country', country: popup.country, pixelIds: popup.cPids, priceSol: popup.countryPrice }); setPopup(null) } },
              { label: popup.subregion, sub: `${popup.sPids.length.toLocaleString()} pixels`, price: popup.subregionPrice,
                onClick: () => { onPurchaseIntent({ type: 'subregion', subregion: popup.subregion, pixelIds: popup.sPids, priceSol: popup.subregionPrice }); setPopup(null) } },
            ].map((opt, i) => (
              <div key={i} style={{ marginBottom: i < 2 ? 10 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 12, fontWeight: 600, color: '#c8dff0' }}>
                      {opt.label.length > 22 ? opt.label.slice(0, 22) + '…' : opt.label}
                    </div>
                    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 10, color: '#2a4a68', marginTop: 2 }}>{opt.sub}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, color: CLAIM_GLOW, lineHeight: 1 }}>
                      {opt.price.toFixed(opt.price > 10 ? 1 : 4)} SOL
                    </div>
                    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 9, color: '#2a4a68' }}>
                      ≈ ${(opt.price * 150).toFixed(opt.price > 10 ? 0 : 2)}
                    </div>
                  </div>
                </div>
                <ClaimBtn onClick={opt.onClick} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ClaimBtn({ onClick }) {
  const [h, setH] = useState(false)
  return (
    <button
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      onClick={onClick}
      style={{
        width: '100%', padding: '9px 0',
        background: h ? 'linear-gradient(90deg, #c83a08, #d84a18)' : 'linear-gradient(90deg, #e8440a, #d03a08)',
        border: 'none', color: '#fff',
        fontFamily: "'Bebas Neue',sans-serif", fontSize: 12, letterSpacing: 4,
        cursor: 'pointer', transition: 'all 0.15s',
        boxShadow: h ? '0 4px 16px rgba(232,68,10,0.3)' : 'none',
      }}
    >CLAIM TERRITORY →</button>
  )
}
