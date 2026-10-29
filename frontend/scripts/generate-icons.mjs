/**
 * 生成 PWA 图标。
 *
 * 逐像素绘制后用 zlib 打包成 PNG，不引入图像处理依赖：图标只有四张，形状也简单，
 * 装一个图形库只为跑一次，随后它还会占着依赖清单和安全扫描的额度。
 *
 * 用法：node scripts/generate-icons.mjs
 * 输出到 public/icons/，产物入库，构建时不再运行本脚本。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BACKGROUND = [0x12, 0x13, 0x16]
const FOREGROUND = [0xe8, 0xe9, 0xea]

// ── PNG 编码 ────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** 把 RGBA 像素编码为 PNG。宽高相同，8 位深度，RGB + alpha */
function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // 位深
  header[9] = 6 // 颜色类型：真彩 + alpha
  header[10] = 0
  header[11] = 0
  header[12] = 0

  // 每行前置一个过滤器字节，这里统一用 0（不过滤）
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 图形 ────────────────────────────────────────────────────────────────────

/**
 * 判断一个像素是否落在圆角矩形内。
 *
 * 坐标与半径都以边长的小数表示，因此同一套数值适用于任意尺寸。
 */
function inRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

/**
 * 绘制一个图标。
 *
 * `inset` 让图形在画布内缩进：可遮罩图标要求主体落在中央安全区内，系统会按
 * 平台形状裁掉外圈，缩进不够时杠铃两端会被切掉。
 */
function render(size, inset) {
  const SS = 3 // 超采样倍数，边缘因此不会出现锯齿
  const W = size * SS
  const rgba = Buffer.alloc(size * size * 4)

  const scale = 1 - inset * 2
  const off = inset
  const at = (f) => (off + f * scale) * W

  // 杠铃几何：横杆 + 内外各一对配重片，比例取自 32px 版本
  const bar = { top: at(15 / 32), bottom: at(17 / 32), left: at(10 / 32), right: at(22 / 32) }
  const innerTop = at(13 / 32)
  const innerBottom = at(19 / 32)
  const outerTop = at(11 / 32)
  const outerBottom = at(21 / 32)
  const plates = [
    { left: at(8 / 32), right: at(10.5 / 32), top: innerTop, bottom: innerBottom },
    { left: at(21.5 / 32), right: at(24 / 32), top: innerTop, bottom: innerBottom },
    { left: at(4 / 32), right: at(7 / 32), top: outerTop, bottom: outerBottom },
    { left: at(25 / 32), right: at(28 / 32), top: outerTop, bottom: outerBottom },
  ]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgHits = 0
      let fgHits = 0

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x * SS + sx + 0.5
          const py = y * SS + sy + 0.5

          if (!inRoundedRect(px, py, 0, 0, W, W, W * 0.22)) continue
          bgHits += 1

          const onBar =
            px >= bar.left && px <= bar.right && py >= bar.top && py <= bar.bottom
          const onPlate = plates.some(
            (p) => px >= p.left && px <= p.right && py >= p.top && py <= p.bottom,
          )
          if (onBar || onPlate) fgHits += 1
        }
      }

      const total = SS * SS
      const alpha = Math.round((bgHits / total) * 255)
      const mix = bgHits === 0 ? 0 : fgHits / bgHits
      const i = (y * size + x) * 4

      rgba[i] = Math.round(BACKGROUND[0] + (FOREGROUND[0] - BACKGROUND[0]) * mix)
      rgba[i + 1] = Math.round(BACKGROUND[1] + (FOREGROUND[1] - BACKGROUND[1]) * mix)
      rgba[i + 2] = Math.round(BACKGROUND[2] + (FOREGROUND[2] - BACKGROUND[2]) * mix)
      rgba[i + 3] = alpha
    }
  }

  return encodePng(size, rgba)
}

const TARGETS = [
  // 普通图标：图形铺满，系统不做裁切
  { file: 'icon-192.png', size: 192, inset: 0.06 },
  { file: 'icon-512.png', size: 512, inset: 0.06 },
  // 可遮罩图标：主体缩进到安全区，避免被裁成圆形时切到杠铃两端
  { file: 'icon-maskable-512.png', size: 512, inset: 0.14 },
  // iOS 主屏图标：系统自行圆角，这里不缩进
  { file: 'apple-touch-icon.png', size: 180, inset: 0.06 },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const { file, size, inset } of TARGETS) {
  const png = render(size, inset)
  writeFileSync(join(OUT_DIR, file), png)
  console.log(`${file}  ${size}×${size}  ${png.length} bytes`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`written to ${OUT_DIR}`)
}
