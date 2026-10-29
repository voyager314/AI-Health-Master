/**
 * 配色的可读性验证。
 *
 * 正文文本与其背景的对比度不低于 4.5:1，这是「能不能看清」的下限，不是审美偏好。
 * 深浅两套配色都要成立：只在浅色下达标，等于默认深色用户看不清。
 */
import { contrastRatio, readTokenPair } from './contrast.ts'
import { indexCss } from './sources.ts'
import { describe, expect, it } from 'vitest'

const MIN_BODY = 4.5

/** 需要检查的「前景 / 背景」组合，覆盖正文、次要文字、主按钮与错误提示 */
const PAIRS = [
  { fg: '--fg', bg: '--bg', purpose: '正文在页面底色上' },
  { fg: '--fg', bg: '--surface', purpose: '正文在卡片底色上' },
  { fg: '--fg-muted', bg: '--bg', purpose: '次要文字在页面底色上' },
  { fg: '--fg-muted', bg: '--surface', purpose: '次要文字在卡片底色上' },
  { fg: '--accent-fg', bg: '--accent', purpose: '主按钮文字' },
  { fg: '--danger', bg: '--bg', purpose: '错误提示' },
] as const

describe('对比度', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const pair of PAIRS) {
      it(`${mode} 模式：${pair.purpose}不低于 ${MIN_BODY}:1`, () => {
        const fg = readTokenPair(indexCss, pair.fg)
        const bg = readTokenPair(indexCss, pair.bg)

        expect(fg, `配色里找不到 ${pair.fg} 的深浅两档`).not.toBeNull()
        expect(bg, `配色里找不到 ${pair.bg} 的深浅两档`).not.toBeNull()

        const ratio = contrastRatio(fg![mode], bg![mode])
        expect(ratio, `${fg![mode]} 在 ${bg![mode]} 上只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          MIN_BODY,
        )
      })
    }
  }

  it('计算本身可信：黑白是 21:1，同色是 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  it('缩写色值与长写等价', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5)
  })
})
