/**
 * 按自然日分组。运动记录与体重记录共用同一条规则。
 *
 * 入参是任意带主键的记录数组与一个取时刻的函数，不读存储、不取当前时间，
 * 因此不初始化数据库也能单测。自然日归属一律委托给 `stats/timeWindow`，
 * 本层不自行推算日界。
 *
 * 分组规则只在这里写一遍：日序倒序；组内按时刻倒序，同一时刻再按主键倒序。
 * 两份实现迟早会在主键兜底这类细节上分叉，而分叉只出现在同一秒两条记录的
 * 边缘样本上，日常使用中看不出来。
 */
import type { Uuid } from '@/entities'
import { dayKeyOf, type DayKey } from '@/stats'

/**
 * 归日所需的两个值，取自记录本身。
 *
 * 偏移按记录自带的取，不按设备当前时区：用户飞到另一个时区之后，旧记录仍然
 * 属于它写入时所在的那一天。
 */
export interface DayInstant {
  /** 记录时刻，UTC ISO 8601 */
  readonly instant: string
  /** 记录写入时设备时区相对 UTC 的偏移，单位分钟，东为正 */
  readonly tzOffsetMinutes: number
}

/** 参与分组的最小记录形状：一个主键，加上取时刻的能力 */
export interface DatedRecord {
  readonly id: Uuid
}

/** 按自然日归并后的一段，`logs` 已按时间倒序排好 */
export interface DayGroup<T extends DatedRecord> {
  /** 自然日标识，按记录自带的时区偏移划分 */
  readonly day: DayKey
  /** 该日的记录，时刻倒序；同一时刻的按主键倒序 */
  readonly logs: readonly T[]
}

/**
 * 组内排序：时刻倒序，同一时刻按主键倒序。
 *
 * 两个字段都用字符串比较：时刻是固定宽度的 UTC ISO 8601，主键是 UUID v7，
 * 两者的字典序与各自的时间序一致，不必解析成时间戳。
 *
 * 主键兜底不是可有可无的：同一秒内提交的两条记录时刻相同，没有第二个键时
 * 排序结果取决于数组原始顺序，列表就会在一次无关的重新读取后换位置。
 */
function compareWithinDay<T extends DatedRecord>(
  a: T,
  b: T,
  instantOf: (record: T) => DayInstant,
): number {
  const aInstant = instantOf(a).instant
  const bInstant = instantOf(b).instant
  if (aInstant !== bInstant) return aInstant < bInstant ? 1 : -1
  if (a.id === b.id) return 0
  return a.id < b.id ? 1 : -1
}

/**
 * 把记录归到各自写入时的自然日。日序为时间倒序，输入数组不被修改。
 *
 * `instantOf` 给出每条记录的时刻与它自带的时区偏移；同一数组里不同记录可以
 * 带不同的偏移，各按各的判定。
 */
export function groupByDayBy<T extends DatedRecord>(
  records: readonly T[],
  instantOf: (record: T) => DayInstant,
): DayGroup<T>[] {
  const buckets = new Map<DayKey, T[]>()

  for (const record of records) {
    const at = instantOf(record)
    const day = dayKeyOf(at.instant, at.tzOffsetMinutes)
    const bucket = buckets.get(day)
    if (bucket) bucket.push(record)
    else buckets.set(day, [record])
  }

  return [...buckets.entries()]
    // DayKey 是定宽日期串，字典序即时间序
    .sort(([a], [b]) => (a === b ? 0 : a < b ? 1 : -1))
    .map(([day, bucket]) => ({
      day,
      logs: bucket.sort((a, b) => compareWithinDay(a, b, instantOf)),
    }))
}
