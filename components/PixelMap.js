import { useEffect, useRef, useState } from 'react'
import { BASE_PIXEL_PRICE_SOL, calculateNextPrice } from '../lib/solana'
import { GRID_COLS, GRID_ROWS } from '../lib/pixels'

const OCEAN_COLOR  = '#060e1c'
const LAND_COLOR   = '#1a2d3f'
const BORDER_COLOR = 'rgba(70,140,200,0.65)'
const GRID_COLOR   = 'rgba(55,125,210,0.28)'
const CLAIM_COLOR  = '#e8440a'

export default function PixelMap({ pixels, onPurchaseIntent, highlightedPixelId }) {
  const canvasRef  = useRef(null)
  const worldRef   = useRef(null)
  const hitRef     = useRef(null)
  const baseCache  = useRef({})   // zoom-level → offscreen canvas
  const view       = useRef({ zoom: 1, panX: 0, panY: 0 })
  const drag       = useRef({ on: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false })
  const sz         = useRef({ w: 800, h: 600, dpr: 1 })
  const raf        = useRef(null)
  const hoverTm    = useRef(null)
  const [popup,    setPopup]   = useState(null)
  const [loading,  setLoading] = useState(true)

  useEffect(() => {
    const el = canvasRef.current?.parentElement
    if (!el) return
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600
    sz.current = { w, h, dpr }
    canvasRef.current.width  = w * dpr
    canvasRef.current.height = h * dpr
    canvasRef.current.style.width  = w + 'px'
    canvasRef.current.style.height = h + 'px'

    fetch('/worldmap.json').then(r => r.json()).then(data => {
      worldRef.current = data
      buildHitmap(w, h, data)
      setLoading(false)
      draw()
    })

    const onResize = () => {
      const dpr = window.devicePixelRatio || 1
      const nw = el.clientWidth, nh = el.clientHeight
      sz.current = { w: nw, h: nh, dpr }
      canvasRef.current.width  = nw * dpr
      canvasRef.current.height = nh * dpr
      canvasRef.current.style.width  = nw + 'px'
      canvasRef.current.style.height = nh + 'px'
      baseCache.current = {}
      if (worldRef.current) buildHitmap(nw, nh, worldRef.current)
      draw()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => { if (!loading) draw() }, [pixels, highlightedPixelId, loading])

  // ── Parse SVG path ─────────────────────────────────────────────────────────
  function parsePath(d) {
    const rings = []
    for (const seg of d.split('Z')) {
      if (!seg.trim()) continue
      const pts = seg.replace(/^M/, '').split(/[ML]/).map(s => {
        const [x, y] = s.split(',').map(Number)
        return [x, y]
      }).filter(p => !isNaN(p[0]))
      if (pts.length >= 3) rings.push(pts)
    }
    return rings
  }

  function drawRings(ctx, rings, w, h, zoom, panX, panY, world) {
    const cols = world.cols, rows = world.rows
    ctx.beginPath()
    for (const ring of rings) {
      if (!ring.length) continue
      ctx.moveTo(ring[0][0] / cols * w * zoom + panX, ring[0][1] / rows * h * zoom + panY)
      for (let i = 1; i < ring.length; i++) {
        ctx.lineTo(ring[i][0] / cols * w * zoom + panX, ring[i][1] / rows * h * zoom + panY)
      }
      ctx.closePath()
    }
  }

  // ── Build base map at specific zoom level (cached) ────────────────────────
  function getBaseCanvas(zoom) {
    const key = Math.round(zoom * 4) / 4  // cache per 0.25 zoom steps
    if (baseCache.current[key]) return baseCache.current[key]

    const world = worldRef.current
    if (!world) return null
    const { w, h, dpr } = sz.current
    const pw = w * dpr, ph = h * dpr

    const c = document.createElement('canvas')
    c.width = pw; c.height = ph
    const ctx = c.getContext('2d')

    // Ocean
    ctx.fillStyle = OCEAN_COLOR
    ctx.fillRect(0, 0, pw, ph)

    // Ocean grid
    ctx.strokeStyle = 'rgba(8,24,52,0.6)'
    ctx.lineWidth = 0.4 * dpr
    for (let x = 0; x < pw; x += 80 * dpr) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,ph); ctx.stroke() }
    for (let y = 0; y < ph; y += 60 * dpr) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(pw,y); ctx.stroke() }

    // Land fill — all same color
    ctx.fillStyle = LAND_COLOR
    ctx.strokeStyle = 'transparent'
    for (const country of world.countries) {
      const rings = parsePath(country.p)
      drawRings(ctx, rings, w, h, 1, 0, 0, world)
      ctx.fill()
    }

    // Borders
    ctx.strokeStyle = BORDER_COLOR
    ctx.lineWidth = Math.max(0.5, 0.7 * dpr / zoom)
    for (const country of world.countries) {
      const rings = parsePath(country.p)
      drawRings(ctx, rings, w, h, 1, 0, 0, world)
      ctx.stroke()
    }

    // Limit cache size
    const keys = Object.keys(baseCache.current)
    if (keys.length > 8) delete baseCache.current[keys[0]]
    baseCache.current[key] = c
    return c
  }

  // ── Hitmap ─────────────────────────────────────────────────────────────────
  function buildHitmap(w, h, world) {
    const off = document.createElement('canvas')
    off.width = w; off.height = h
    const ctx = off.getContext('2d')

    world.countries.forEach((country, idx) => {
      const r = (idx + 1) & 0xff
      const g = ((idx + 1) >> 8) & 0xff
      ctx.fillStyle = `rgb(${r},${g},0)`
      ctx.strokeStyle = `rgb(${r},${g},0)`
      ctx.lineWidth = 1.5
      const rings = parsePath(country.p)
      drawRings(ctx, rings, w, h, 1, 0, 0, world)
      ctx.fill()
      ctx.stroke()
    })

    const img = ctx.getImageData(0, 0, w, h).data
    const hit = new Uint16Array(w * h)
    for (let i = 0; i < w * h; i++) hit[i] = img[i*4] + (img[i*4+1] << 8)
    hitRef.current = { data: hit, w, h }
  }

  function getCountryIdx(sx, sy) {
    const hit = hitRef.current
    if (!hit) return -1
    const { zoom, panX, panY } = view.current
    const bx = Math.round((sx - panX) / zoom)
    const by = Math.round((sy - panY) / zoom)
    if (bx < 0 || bx >= hit.w || by < 0 || by >= hit.h) return -1
    return hit.data[by * hit.w + bx] - 1
  }

  function screenToPixelId(sx, sy) {
    const { w, h } = sz.current
    const { zoom, panX, panY } = view.current
    const col = Math.floor((sx - panX) / zoom / w * GRID_COLS)
    const row = Math.floor((sy - panY) / zoom / h * GRID_ROWS)
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null
    return row * GRID_COLS + col
  }

  function getCountryPixels(countryName) {
    const world = worldRef.current; const hit = hitRef.current
    if (!world || !hit) return []
    const idx = world.countries.findIndex(c => c.n === countryName) + 1
    if (!idx) return []
    const { w, h } = sz.current
    const res = []
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const sx = Math.round((col + 0.5) / GRID_COLS * w)
        const sy = Math.round((row + 0.5) / GRID_ROWS * h)
        if (sx < hit.w && sy < hit.h && hit.data[sy * hit.w + sx] === idx)
          res.push(row * GRID_COLS + col)
      }
    }
    return res
  }

  function getSubregionPixels(subregion) {
    const world = worldRef.current; const hit = hitRef.current
    if (!world || !hit) return []
    const idxSet = new Set(world.countries.map((c,i) => c.s === subregion ? i+1 : 0).filter(Boolean))
    const { w, h } = sz.current
    const res = []
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const sx = Math.round((col + 0.5) / GRID_COLS * w)
        const sy = Math.round((row + 0.5) / GRID_ROWS * h)
        if (sx < hit.w && sy < hit.h && idxSet.has(hit.data[sy * hit.w + sx]))
          res.push(row * GRID_COLS + col)
      }
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

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !worldRef.current) return
      const { w, h, dpr } = sz.current
      const { zoom, panX, panY } = view.current
      const world = worldRef.current
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Ocean bg
      ctx.fillStyle = OCEAN_COLOR
      ctx.fillRect(0, 0, w, h)

      // Base map (from cache, rendered at base scale, then transformed)
      const base = getBaseCanvas(zoom)
      if (base) {
        ctx.save()
        ctx.translate(panX, panY)
        ctx.scale(zoom, zoom)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(base, 0, 0, w, h)
        ctx.restore()
      }

      // Grid + pixels clipped to land
      const cw = w * zoom / GRID_COLS
      const ch = h * zoom / GRID_ROWS

      if (cw > 2) {
        ctx.save()
        // Clip to land
        ctx.translate(panX, panY)
        ctx.scale(zoom, zoom)
        ctx.beginPath()
        for (const country of world.countries) {
          const rings = parsePath(country.p)
          for (const ring of rings) {
            if (!ring.length) continue
            ctx.moveTo(ring[0][0] / world.cols * w, ring[0][1] / world.rows * h)
            for (let i = 1; i < ring.length; i++) {
              ctx.lineTo(ring[i][0] / world.cols * w, ring[i][1] / world.rows * h)
            }
            ctx.closePath()
          }
        }
        ctx.clip()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        // Grid
        if (cw > 5) {
          const sc = Math.max(0, Math.floor(-panX / cw))
          const ec = Math.min(GRID_COLS, Math.ceil((w - panX) / cw))
          const sr = Math.max(0, Math.floor(-panY / ch))
          const er = Math.min(GRID_ROWS, Math.ceil((h - panY) / ch))
          ctx.strokeStyle = GRID_COLOR; ctx.lineWidth = 0.4
          for (let c = sc; c <= ec; c++) {
            const x = panX + c * cw
            ctx.beginPath(); ctx.moveTo(x, panY+sr*ch); ctx.lineTo(x, panY+er*ch); ctx.stroke()
          }
          for (let r = sr; r <= er; r++) {
            const y = panY + r * ch
            ctx.beginPath(); ctx.moveTo(panX+sc*cw, y); ctx.lineTo(panX+ec*cw, y); ctx.stroke()
          }
        }

        // Claimed pixels
        pixels.forEach((pixel, id) => {
          if (!pixel.owner_wallet) return
          const col = id % GRID_COLS, row = Math.floor(id / GRID_COLS)
          const x = panX + col * cw, y = panY + row * ch
          if (x+cw < 0 || x > w || y+ch < 0 || y > h) return
          ctx.shadowColor = pixel.color || CLAIM_COLOR
          ctx.shadowBlur = zoom > 3 ? 8 : 4
          ctx.fillStyle = pixel.color || CLAIM_COLOR
          ctx.globalAlpha = 0.85
          ctx.fillRect(x, y, cw, ch)
          ctx.globalAlpha = 1; ctx.shadowBlur = 0
        })
        ctx.restore()
      }

      // Highlighted
      if (highlightedPixelId != null) {
        const col = highlightedPixelId % GRID_COLS
        const row = Math.floor(highlightedPixelId / GRID_COLS)
        ctx.strokeStyle = CLAIM_COLOR; ctx.lineWidth = 2
        ctx.strokeRect(panX + col * cw, panY + row * ch, cw, ch)
      }
    })
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function onDown(e) {
    clearTimeout(hoverTm.current)
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false }
  }

  function onMove(e) {
    const d = drag.current
    if (d.on) {
      if (Math.abs(e.clientX-d.sx) > 4 || Math.abs(e.clientY-d.sy) > 4) d.moved = true
      view.current.panX += e.clientX - d.lx
      view.current.panY += e.clientY - d.ly
      d.lx = e.clientX; d.ly = e.clientY
      canvasRef.current.style.cursor = 'grabbing'
      setPopup(null); draw(); return
    }
    const r = canvasRef.current.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    const ci = getCountryIdx(sx, sy)
    canvasRef.current.style.cursor = ci >= 0 ? 'crosshair' : 'not-allowed'
    clearTimeout(hoverTm.current)
    if (ci >= 0) {
      hoverTm.current = setTimeout(() => {
        const world = worldRef.current; if (!world) return
        const country = world.countries[ci]
        const pid = screenToPixelId(sx, sy); if (pid === null) return
        const cPids = getCountryPixels(country.n)
        const sPids = getSubregionPixels(country.s)
        setPopup({
          x: e.clientX, y: e.clientY, pixelId: pid,
          pixel: pixels.get(pid) || null,
          country: country.n, subregion: country.s, continent: country.k,
          cPids, sPids,
          pixelPrice: pixels.get(pid)?.current_price_sol
            ? calculateNextPrice(pixels.get(pid).current_price_sol) : BASE_PIXEL_PRICE_SOL,
          countryPrice: calcPrice(cPids),
          subregionPrice: calcPrice(sPids),
        })
      }, 400)
    } else setPopup(null)
  }

  function onUp() { drag.current.on = false }
  function onLeave() { drag.current.on = false; clearTimeout(hoverTm.current) }
  function onClick(e) { if (drag.current.moved) { drag.current.moved = false } }

  function onWheel(e) {
    e.preventDefault(); setPopup(null)
    const r = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const f = e.deltaY > 0 ? 0.85 : 1.18
    const nz = Math.min(Math.max(view.current.zoom * f, 0.8), 24)
    const s = nz / view.current.zoom
    view.current = { zoom: nz, panX: mx - s*(mx - view.current.panX), panY: my - s*(my - view.current.panY) }
    draw()
  }

  const fmtPrice = (p) => `${p.toFixed(p > 10 ? 1 : 4)} SOL`
  const fmtUsd   = (p) => `≈ $${(p * 150).toFixed(p > 10 ? 0 : 2)}`

  return (
    <div style={{ width:'100%', height:'100%', position:'relative', overflow:'hidden' }}>
      <canvas ref={canvasRef} style={{ display:'block', background:OCEAN_COLOR }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onMouseLeave={onLeave} onClick={onClick} onWheel={onWheel} />

      {loading && (
        <div style={{ position:'absolute', inset:0, background:OCEAN_COLOR, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16 }}>
          <div style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:13, letterSpacing:8, color:'#1a4a6a' }}>LOADING MAP</div>
          <div style={{ width:100, height:1, background:'#0a1830', overflow:'hidden', position:'relative' }}>
            <div style={{ position:'absolute', width:'40%', height:'100%', background:CLAIM_COLOR, animation:'terrox-slide 1.2s ease-in-out infinite' }} />
          </div>
          <style>{`@keyframes terrox-slide{0%{left:-40%}100%{left:140%}}`}</style>
        </div>
      )}

      {popup && (
        <div
          onMouseEnter={() => clearTimeout(hoverTm.current)}
          onMouseLeave={() => setPopup(null)}
          style={{
            position:'fixed',
            left: Math.min(popup.x + 16, window.innerWidth - 260),
            top:  Math.max(popup.y - 20, 60),
            background:'#08111e',
            border:'1px solid #1e3a58',
            borderTop:`2px solid ${CLAIM_COLOR}`,
            width:248,
            boxShadow:'0 16px 48px rgba(0,0,0,0.95)',
            zIndex:9999,
            pointerEvents:'auto',
            fontFamily:'Inter,sans-serif',
          }}
        >
          {/* Header */}
          <div style={{ padding:'12px 16px 10px', borderBottom:'1px solid #102030' }}>
            <div style={{ fontSize:10, letterSpacing:2, color:'#3a6a90', marginBottom:4, textTransform:'uppercase' }}>
              Pixel #{popup.pixelId} · {popup.subregion}
            </div>
            <div style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:22, letterSpacing:3, color:'#d8eaf8', lineHeight:1 }}>
              {popup.country}
            </div>
            <div style={{ fontSize:11, color: popup.pixel?.owner_wallet ? '#5a9abc' : '#3a9a6a', marginTop:4 }}>
              {popup.pixel?.owner_wallet
                ? `Owned by ${popup.pixel.owner_name || popup.pixel.owner_wallet.slice(0,8)+'...'}`
                : 'Unclaimed territory'}
            </div>
          </div>

          {/* Options */}
          <div style={{ padding:'10px 16px 14px' }}>
            {[
              { label:'This Pixel', sub:'Single pixel', price: popup.pixelPrice,
                onClick:() => { onPurchaseIntent({type:'pixel', pixelId:popup.pixelId, pixel:popup.pixel, priceSol:popup.pixelPrice}); setPopup(null) }},
              { label: popup.country, sub:`${popup.cPids.length.toLocaleString()} pixels`, price: popup.countryPrice,
                onClick:() => { onPurchaseIntent({type:'country', country:popup.country, pixelIds:popup.cPids, priceSol:popup.countryPrice}); setPopup(null) }},
              { label: popup.subregion, sub:`${popup.sPids.length.toLocaleString()} pixels`, price: popup.subregionPrice,
                onClick:() => { onPurchaseIntent({type:'subregion', subregion:popup.subregion, pixelIds:popup.sPids, priceSol:popup.subregionPrice}); setPopup(null) }},
            ].map((opt, i) => (
              <div key={i} style={{ marginBottom: i < 2 ? 10 : 0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:5 }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'#c8dff0', letterSpacing:0.5 }}>
                      {opt.label.length > 24 ? opt.label.slice(0,24)+'…' : opt.label}
                    </div>
                    <div style={{ fontSize:10, color:'#3a5a78', marginTop:1 }}>{opt.sub}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:'Bebas Neue,sans-serif', fontSize:16, color:CLAIM_COLOR, lineHeight:1 }}>
                      {fmtPrice(opt.price)}
                    </div>
                    <div style={{ fontSize:10, color:'#3a5a78' }}>{fmtUsd(opt.price)}</div>
                  </div>
                </div>
                <BuyButton onClick={opt.onClick} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BuyButton({ onClick }) {
  const [h, setH] = useState(false)
  return (
    <button
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      onClick={onClick}
      style={{
        width:'100%', padding:'8px 0',
        background: h ? '#c83a08' : '#e8440a',
        border:'none', color:'#fff',
        fontFamily:'Bebas Neue,sans-serif', fontSize:13, letterSpacing:3,
        cursor:'pointer', transition:'background 0.15s',
      }}
    >CLAIM →</button>
  )
}
