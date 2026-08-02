// Generates premium space-themed BMP assets for the NSIS installer.
//
//   sidebar.bmp  — 164×314 vertical banner (drawn on the left of the wizard)
//   header.bmp   — 150×57  header bar (drawn at the top of each page)
//
// Design: deep cosmic gradient with layered nebula clouds, scattered stars,
//         and subtle constellation-like line patterns for a premium feel.
//
// Run: node build/gen-assets.mjs

import sharp from 'sharp'
import { writeFileSync } from 'fs'

// ── Helper: fill a raw RGB buffer with a multi-stop gradient ───────
function createGradientPixels(w, h, ...stops) {
  // Each stop: [yFraction 0–1, r, g, b]
  const buf = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    const pct = y / (h - 1)
    let lo = stops[0], hi = stops[stops.length - 1]
    for (let i = 0; i < stops.length - 1; i++) {
      if (pct >= stops[i][0] && pct <= stops[i + 1][0]) {
        lo = stops[i]; hi = stops[i + 1]; break
      }
    }
    const span = hi[0] - lo[0] || 1
    const t = (pct - lo[0]) / span
    // Smooth easing for cinematic gradient transitions
    const et = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const r = Math.round(lo[1] + (hi[1] - lo[1]) * et)
    const g = Math.round(lo[2] + (hi[2] - lo[2]) * et)
    const b = Math.round(lo[3] + (hi[3] - lo[3]) * et)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b
    }
  }
  return buf
}

// ── Add scattered stars with variable brightness + glow ────────────
function addStars(buf, w, h, count = 120) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * w)
    const y = Math.floor(Math.random() * h)
    const brightness = 120 + Math.floor(Math.random() * 135) // 120–255
    const idx = (y * w + x) * 3
    // Core star pixel
    buf[idx] = Math.min(255, buf[idx] + brightness)
    buf[idx + 1] = Math.min(255, buf[idx + 1] + brightness)
    buf[idx + 2] = Math.min(255, buf[idx + 2] + brightness)
    // Cross-shaped glow for brighter stars (40% chance)
    if (Math.random() < 0.4) {
      for (let r = 1; r <= 2; r++) {
        const glow = Math.floor(brightness * (0.35 / r))
        const offsets = [[r, 0], [-r, 0], [0, r], [0, -r]]
        for (const [dx, dy] of offsets) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          const ni = (ny * w + nx) * 3
          buf[ni] = Math.min(255, buf[ni] + glow)
          buf[ni + 1] = Math.min(255, buf[ni + 1] + glow)
          buf[ni + 2] = Math.min(255, buf[ni + 2] + glow)
        }
      }
    }
  }
}

// ── Add a soft nebula cloud (elliptical Gaussian-like falloff) ─────
function addNebula(buf, w, h, cx, cy, rx, ry, hueR, hueG, hueB, alpha) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > 1.8) continue
      // Smooth outer falloff
      const t = dist < 1 ? 1 - dist * dist * 0.7 : Math.max(0, (1.8 - dist) / 0.8)
      const fade = t * t * alpha
      const idx = (y * w + x) * 3
      buf[idx] = Math.min(255, buf[idx] + Math.round(hueR * fade))
      buf[idx + 1] = Math.min(255, buf[idx + 1] + Math.round(hueG * fade))
      buf[idx + 2] = Math.min(255, buf[idx + 2] + Math.round(hueB * fade))
    }
  }
}

// ── Draw subtle constellation lines between nearby bright stars ────
function addConstellations(buf, w, h) {
  // Find bright spots (pre-existing pixels that are significantly
  // brighter than their neighbours — these are the "stars").
  const brightSpots = []
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = (y * w + x) * 3
      const lum = buf[idx] + buf[idx + 1] + buf[idx + 2]
      // Only count very bright isolated pixels
      if (lum < 360) continue
      // Check isolation: is this pixel brighter than all immediate
      // neighbours? If so it's likely a star added by addStars.
      let isStar = true
      for (let dy = -2; dy <= 2 && isStar; dy++) {
        for (let dx = -2; dx <= 2 && isStar; dx++) {
          if (dx === 0 && dy === 0) continue
          const ni = ((y + dy) * w + (x + dx)) * 3
          const nl = buf[ni] + buf[ni + 1] + buf[ni + 2]
          if (nl >= lum * 0.9) isStar = false
        }
      }
      if (isStar) brightSpots.push({ x, y, lum })
    }
  }

  // Connect pairs of nearby stars with faint white lines
  const MAX_DIST = 45
  for (let i = 0; i < brightSpots.length; i++) {
    const a = brightSpots[i]
    for (let j = i + 1; j < brightSpots.length; j++) {
      const b = brightSpots[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > MAX_DIST || dist < 8) continue
      // Only connect ~15% of eligible pairs for a natural look
      if (Math.random() > 0.15) continue

      // Line alpha fades with distance, brightens with star luminosity
      const lineAlpha = Math.floor((1 - dist / MAX_DIST) * Math.min(a.lum, b.lum) / 255 * 35)
      if (lineAlpha < 6) continue

      // Bresenham-like line
      const steps = Math.max(Math.abs(dx), Math.abs(dy))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const lx = Math.round(a.x + dx * t)
        const ly = Math.round(a.y + dy * t)
        if (lx < 0 || lx >= w || ly < 0 || ly >= h) continue
        const li = (ly * w + lx) * 3
        buf[li] = Math.min(255, buf[li] + lineAlpha)
        buf[li + 1] = Math.min(255, buf[li + 1] + lineAlpha)
        buf[li + 2] = Math.min(255, buf[li + 2] + lineAlpha)
      }
    }
  }
}

// ── Save raw RGB pixels as 24-bit BMP (bottom-up) ──────────────────
function saveBmp(filepath, buf, w, h) {
  const rowSize = Math.floor((w * 3 + 3) / 4) * 4
  const pixelDataSize = rowSize * h
  const fileSize = 54 + pixelDataSize

  const header = Buffer.alloc(54)
  header.write('BM', 0)
  header.writeUInt32LE(fileSize, 2)
  header.writeUInt32LE(54, 10)          // pixel data offset
  header.writeUInt32LE(40, 14)          // DIB header size
  header.writeInt32LE(w, 18)
  header.writeInt32LE(h, 22)            // positive = bottom-up
  header.writeUInt16LE(1, 26)           // planes
  header.writeUInt16LE(24, 28)          // bpp
  header.writeUInt32LE(pixelDataSize, 34)
  header.writeInt32LE(2835, 38)         // 72 DPI
  header.writeInt32LE(2835, 42)

  const pixelData = Buffer.alloc(pixelDataSize)
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 3
    const dstRow = y * rowSize
    buf.copy(pixelData, dstRow, srcRow, srcRow + w * 3)
  }

  writeFileSync(filepath, Buffer.concat([header, pixelData]))
  console.log(`  ${filepath}  (${w}×${h}, ${(fileSize / 1024).toFixed(1)} KB)`)
}

// ══════════════════════════════════════════════════════════════════════
// Generate assets
// ══════════════════════════════════════════════════════════════════════
console.log('Kurōdo — generating premium space-themed NSIS assets\n')

// ── Sidebar (164×314) — deep cosmic canvas ────────────────────────
{
  const w = 164, h = 314
  // Rich multi-stop gradient: deep void → indigo core → violet → dark
  const pixels = createGradientPixels(w, h,
    [0.00, 4, 2, 16],     // near-black void
    [0.12, 10, 6, 38],    // deep indigo
    [0.30, 22, 10, 65],   // rich violet
    [0.48, 35, 14, 82],   // vivid purple core
    [0.62, 20, 10, 56],   // soft plum
    [0.80, 12, 6, 34],    // deep indigo
    [1.00, 4, 2, 14],     // back to void
  )

  // Layered nebula clouds for depth
  addNebula(pixels, w, h, 100, 90,  95, 70,  50, 25, 105, 0.28)  // magenta-purple
  addNebula(pixels, w, h, 55, 180,  80, 60,  20, 60, 130, 0.22)  // cyan-blue
  addNebula(pixels, w, h, 120, 240, 65, 55,  70, 15, 90,  0.18)  // violet

  // Starfield with constellation connections
  addStars(pixels, w, h, 100)
  addConstellations(pixels, w, h)

  saveBmp('build/sidebar.bmp', pixels, w, h)
}

// ── Header (150×57) — subtle elegant gradient ─────────────────────
{
  const w = 150, h = 57
  const pixels = createGradientPixels(w, h,
    [0.00, 6, 3, 22],
    [0.35, 14, 8, 48],
    [0.65, 10, 5, 34],
    [1.00, 4, 2, 18],
  )

  // Single nebula accent near center-right
  addNebula(pixels, w, h, 110, 28, 55, 35, 30, 15, 90, 0.15)

  // Lighter star count for the small header
  addStars(pixels, w, h, 28)

  saveBmp('build/header.bmp', pixels, w, h)
}

console.log('\n✓ Assets generated successfully.')
console.log('  Run `npm run electron:build:win` to rebuild the installer.\n')
