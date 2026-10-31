/**
 * 体重数值在界面上的换算与呈现。
 *
 * 与组件分开：组件文件只导出组件，热更新才不会在改一个格式化函数时把整棵组件树
 * 重建一遍。换算的算术来自 `domain/bodyMetric`，这里只负责「用哪种单位、几位小数」。
 */
import { kgToJin } from '@/domain'
import type { WeightUnit } from './unit.ts'

/** kg 换成当前显示单位的数值 */
export function toDisplay(kg: number, unit: WeightUnit): number {
  return unit === 'jin' ? kgToJin(kg) : kg
}

/**
 * kg 换成当前显示单位的文本：一位小数。
 *
 * 网格值是 k/10，乘 2 之后必然落在 0.2 斤的网格上，`toFixed(1)` 因此不会丢精度。
 */
export function formatDisplay(kg: number, unit: WeightUnit): string {
  return toDisplay(kg, unit).toFixed(1)
}
