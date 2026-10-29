/**
 * 对比度计算。
 *
 * 按 WCAG 2.1 的相对亮度公式计算前景与背景的对比度，用于验证配色是否达到
 * 正文可读的下限。手算不现实也不可靠：两种颜色各自换个色值，结论就变了。
 */

/** 单个通道的 sRGB 值（0-255）转为线性光强（0-1） */
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** 解析 `#rrggbb` 或 `#rgb` 形式的色值 */
export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : value

  if (!/^[0-9a-f]{6}$/i.test(full)) throw new RangeError(`无法解析色值：${hex}`)

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** 相对亮度，取值 0-1 */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b)
  )
}

/** 两个色值的对比度，取值 1-21。正文可读的下限是 4.5 */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseHex(foreground))
  const b = relativeLuminance(parseHex(background))
  const [lighter, darker] = a >= b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * 从样式文本里取出某个自定义属性的深浅两档色值。
 *
 * 配色写成 `light-dark(a, b)` 的形式，取值时按顺序拆出两档。取不到时返回 null，
 * 由调用方决定是报错还是跳过——静默返回一个默认色会让检查永远通过。
 */
export function readTokenPair(css: string, token: string): { light: string; dark: string } | null {
  const pattern = new RegExp(`${token}\\s*:\\s*light-dark\\(\\s*(#[0-9a-f]{3,6})\\s*,\\s*(#[0-9a-f]{3,6})\\s*\\)`, 'i')
  const match = css.match(pattern)
  return match ? { light: match[1]!, dark: match[2]! } : null
}
