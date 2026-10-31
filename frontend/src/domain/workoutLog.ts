/**
 * 运动记录的展示派生：按自然日分组、每日摘要、已填指标的种类数。
 *
 * 三个函数都以记录数组为入参，不读存储、不取当前时间、无副作用，因此不初始化
 * 数据库也能单测。自然日归属一律委托给 `stats/timeWindow`，本层不自行推算日界。
 */
import type { WorkoutLog } from '@/entities'
import { groupByDayBy, type DayGroup } from './dayGroups.ts'

export type { DayGroup }

/**
 * 摘要里单个项目名保留的字数。
 *
 * 摘要是「这一天练了什么」的一行提示，不是项目名的完整副本：超过这个长度后
 * 继续保留只会把后面的项目挤出可见范围，读者反而看不到练了几项。
 */
export const SUMMARY_NAME_MAX_LENGTH = 12

/** 按自然日归并后的一段，`logs` 已按时间倒序排好 */
export type WorkoutDayGroup = DayGroup<WorkoutLog>

/**
 * 一天的摘要素材。
 */
export interface DaySummary {
  /** 当日的记录条数 */
  readonly count: number
  /**
   * 当日出现过的项目名，按首次出现的顺序去重，每项截断到
   * `SUMMARY_NAME_MAX_LENGTH` 字。同一条记录里项目名允许重复，因此去重跨记录也跨卡片。
   */
  readonly itemNames: readonly string[]
}

/**
 * 把记录归到各自写入时的自然日。
 *
 * 归属按记录自带的 `tz_offset_minutes` 判定，不按设备当前时区：用户飞到另一个
 * 时区后，旧记录仍然属于它写入时所在的那一天。日序为时间倒序，输入数组不被修改。
 */
export function groupByDay(logs: readonly WorkoutLog[]): WorkoutDayGroup[] {
  return groupByDayBy(logs, (log) => ({
    instant: log.logged_at,
    tzOffsetMinutes: log.tz_offset_minutes,
  }))
}

/**
 * 一天的条数与项目名摘要。
 *
 * 入参应当是同一自然日的记录；顺序不影响结果——条数只看数量，项目名按首次
 * 出现的顺序去重。
 */
export function daySummary(logs: readonly WorkoutLog[]): DaySummary {
  const seen = new Set<string>()
  const itemNames: string[] = []

  for (const log of logs) {
    for (const item of log.items) {
      if (seen.has(item.name)) continue
      seen.add(item.name)
      itemNames.push(
        item.name.length > SUMMARY_NAME_MAX_LENGTH
          ? `${item.name.slice(0, SUMMARY_NAME_MAX_LENGTH)}…`
          : item.name,
      )
    }
  }

  return { count: logs.length, itemNames }
}

/**
 * 一条记录已填了几种指标：组数、次数、重量三项中，任意一张卡片填了值就算已填。
 *
 * 返回 0-3。它数的是指标的种类，不是填写的次数：同一指标在四张卡片上都填了
 * 仍然只算一项，否则记录写得越长这个值越大，跨记录不可比。调用方用 `> 0`
 * 判断这条记录是否含指标。
 */
export function filledMetricKinds(log: Pick<WorkoutLog, 'items'>): number {
  let sets = false
  let reps = false
  let weight = false

  for (const item of log.items) {
    if (item.sets !== null) sets = true
    if (item.reps !== null) reps = true
    if (item.weight_kg !== null) weight = true
  }

  return Number(sets) + Number(reps) + Number(weight)
}
