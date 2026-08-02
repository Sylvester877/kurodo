// Generates build/icon.ico (multi-size, PNG-compressed entries) from dist/icon-256.png
// so electron-builder's NSIS target has a real Windows .ico icon.
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const SIZES = [16, 24, 32, 48, 64, 128, 256]

function icoHeader(count) {
  const b = Buffer.alloc(6)
  b.writeUInt16LE(0, 0) // reserved
  b.writeUInt16LE(1, 2) // type: icon
  b.writeUInt16LE(count, 4)
  return b
}

function icoEntry(width, height, size, offset) {
  const b = Buffer.alloc(16)
  b.writeUInt8(width === 256 ? 0 : width, 0)
  b.writeUInt8(height === 256 ? 0 : height, 1)
  b.writeUInt8(0, 2) // palette
  b.writeUInt8(0, 3) // reserved
  b.writeUInt16LE(1, 4) // planes
  b.writeUInt16LE(32, 6) // bpp
  b.writeUInt32LE(size, 8)
  b.writeUInt32LE(offset, 12)
  return b
}

const src = await readFile('dist/icon-256.png')
const images = []
let offset = 6 + SIZES.length * 16
for (const size of SIZES) {
  const png = await sharp(src)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
  images.push({ size, data: png, offset })
  offset += png.length
}

const header = icoHeader(SIZES.length)
const entries = Buffer.concat(images.map((i) => icoEntry(i.size, i.size, i.data.length, i.offset)))
const body = Buffer.concat(images.map((i) => i.data))
await writeFile('build/icon.ico', Buffer.concat([header, entries, body]))
console.log(`OK build/icon.ico written (${images.length} sizes, ${offset} bytes)`)
