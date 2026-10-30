/**
 * 项目卡片的一行文字。
 *
 * 只列出已填写的指标：组数、次数、重量各自为 `null` 时不占位、不显示默认值。
 * 「0 组 0 次 0kg」这类占位会把「没记」读成「记了零」，而三项同时为空本身是合法状态。
 */
import type { WorkoutItem } from '@/entities'

/**
 * 卡片的展示文本：项目名在前，已填指标按 组数 → 次数 → 重量 的固定顺序跟在后面，
 * 以 ` × ` 连接。三种指标全空时只有项目名。
 */
export function itemTextOf(item: WorkoutItem): string {
  const metrics: string[] = []
  if (item.sets !== null) metrics.push(`${item.sets} 组`)
  if (item.reps !== null) metrics.push(`${item.reps} 次`)
  if (item.weight_kg !== null) metrics.push(`${item.weight_kg}kg`)

  return metrics.length > 0 ? `${item.name} ${metrics.join(' × ')}` : item.name
}
