/**
 * 生成应用图标：黑底白色像素 K（与 PixelK 组件同字形，4x6 网格）。
 * 用法：node scripts/generate-icon.mjs
 * 输出：public/icon-192.png、public/icon-512.png
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public')

// 像素 K 字形（与 src/components/PixelK.tsx 一致，4x6）
const CELLS = [
  [0, 0], [3, 0],
  [0, 1], [2, 1],
  [0, 2], [1, 2],
  [0, 3], [1, 3],
  [0, 4], [2, 4],
  [0, 5], [3, 5],
]

// ---------- 最小 PNG 编码器（真彩色 + alpha，filter 0） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  // 黑底（不透明）
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 0
    rgba[i + 1] = 0
    rgba[i + 2] = 0
    rgba[i + 3] = 255
  }
  // 白色像素 K，居中放大
  const cell = Math.floor(size / 8)
  const offsetX = Math.floor((size - 4 * cell) / 2)
  const offsetY = Math.floor((size - 6 * cell) / 2)
  for (const [gx, gy] of CELLS) {
    for (let dy = 0; dy < cell; dy++) {
      for (let dx = 0; dx < cell; dx++) {
        const x = offsetX + gx * cell + dx
        const y = offsetY + gy * cell + dy
        const i = (y * size + x) * 4
        rgba[i] = 255
        rgba[i + 1] = 255
        rgba[i + 2] = 255
        rgba[i + 3] = 255
      }
    }
  }
  return encodePng(size, rgba)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'icon-192.png'), makeIcon(192))
writeFileSync(join(OUT, 'icon-512.png'), makeIcon(512))
console.log('已生成 public/icon-192.png、public/icon-512.png')