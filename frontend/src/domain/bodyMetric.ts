/**
 * 体重记录的展示派生：网格规整、步进、斤换算、当日取值、周均。
 *
 * 全部以记录数组或数值为入参，不读存储、不取当前时间、无副作用，因此不初始化
 * 数据库也能单测。自然日与自然周归属一律委托给 `stats/timeWindow`。
 *
 * 网格以「整数个 0.1 kg」为中间表示：规整与步进都先落到十分位上再换回 kg，
 * 避免在浮点结果上反复加减 0.1——那样从 70.0 加两步就得不到 70.2，而是一个
 * 界面上看着是 70.2、乘 10 却不是整数的近似值。
 */
import type { BodyMetric } from '@/entities'
import { weekKeyOf } from '@/stats'
import { groupByDayBy } from './dayGroups.ts'

/**
 * 一周至少要有几个有效日才计算周均。
 *
 * 少于三天时，单日的水分波动足以主导整周的平均，周均就失去了「抵消日波动」的
 * 意义。少于这个数时周均为 `null`，图上也不画这一周的点。
 */
export const MIN_VALID_DAYS_PER_WEEK = 3

/** 派生计算只需要体重记录的这几个字段 */
type MeasuredRecord = Pick<
  BodyMetric,
  'id' | 'measured_at' | 'weight_kg' | 'tz_offset_minutes' | 'deleted_at'
>

/** 把数值换到整数十分位上 */
function toTenths(kg: number): number {
  return Math.round(kg * 10)
}

function fromTenths(tenths: number): number {
  return tenths / 10
}

/**
 * 规整到 0.1 kg 网格：四舍五入到一位小数。
 *
 * 界面在提交前用它把用户输入变成落库值，因此显示的就是存储的。传入值应当已在
 * 合法范围内；本函数只负责取整，不做范围判断。
 */
export function normalizeKg(kg: number): number {
  return fromTenths(toTenths(kg))
}

/**
 * 按一个十分位步进：`direction` 为 1 时加 0.1 kg，为 -1 时减 0.1 kg。
 *
 * 斤显示下同样走这个函数——0.2 斤恰好是 0.1 kg，两种显示共用同一条步进规则，
 * 界面只换标签。当前值先按规整后的十分位参与计算，因此连续步进不会累积误差。
 */
export function stepKg(kg: number, direction: 1 | -1): number {
  return fromTenths(toTenths(kg) + direction)
}

/**
 * kg 换成斤，1 斤 = 0.5 kg。
 *
 * 乘以 2 在浮点里是精确的，网格值换过来必然落在 0.2 斤网格上，显示时取一位小数
 * 即可，不需要再规整。
 */
export function kgToJin(kg: number): number {
  return kg * 2
}

/**
 * 斤换成 kg，结果规整到 0.1 kg 网格。
 *
 * 斤的十分位可以是奇数，除以 2 后会落在两位小数上（145.3 斤 → 72.65 kg），
 * 因此必须规整，否则值会落在存储网格之外。
 */
export function jinToKg(jin: number): number {
  return normalizeKg(jin / 2)
}

/** 某个自然日的当日值 */
export interface DayValue {
  /** 自然日标识，按记录自带的时区偏移划分 */
  readonly day: string
  /** 当日值，即该日测量时刻最晚的那条记录的体重，单位 kg */
  readonly kg: number
  /** 提供当日值的那条记录 */
  readonly source: MeasuredRecord
}

/**
 * 每个有效日一条当日值，按日倒序。
 *
 * 有效日指至少有一条未删除记录的自然日；已删除的记录先被排除，再取当日最晚的
 * 一条，因此删掉当天最后一条之后，当日值会回落到前一条。「当日取最后一条」与
 * 明细里「最上面那条就是当日值」由同一个排序给出。
 *
 * 输入数组不被修改。
 */
export function dayValues(records: readonly MeasuredRecord[]): DayValue[] {
  const alive = records.filter((record) => record.deleted_at === null)

  return groupByDayBy(alive, (record) => ({
    instant: record.measured_at,
    tzOffsetMinutes: record.tz_offset_minutes,
  })).map((group) => {
    const source = group.logs[0]!
    return { day: group.day, kg: source.weight_kg, source }
  })
}

/** 某个自然周的周均 */
export interface WeekAverage {
  /** 该周的周标识，即该周周一的自然日 */
  readonly week: string
  /** 该周有当日值的天数，无论是否达到计算周均所需的天数 */
  readonly validDays: number
  /**
   * 周均，已规整到 0.1 kg；有效日少于 `MIN_VALID_DAYS_PER_WEEK` 时为 `null`。
   * 斤显示由它乘 2 得到，因此两种单位的读数总能互相换算。
   */
  readonly kg: number | null
}

/**
 * 按有效日计算每个有效周的周均，按周正序。
 *
 * 先取当日值再按周平均，而不是把一周内所有记录直接平均：一天称三次不该凑满
 * 三天的量，否则周均会被单日的水分波动主导。当日值所属的周取那条记录自己的
 * 周标识，归日与归周用的是同一个偏移。
 *
 * 有效日不足 3 天的周仍然返回，`kg` 为 `null`，调用方据此在图上断开折线。
 */
export function weeklyAverages(records: readonly MeasuredRecord[]): WeekAverage[] {
  const weeks = new Map<string, number[]>()

  for (const value of dayValues(records)) {
    const week = weekKeyOf(value.source.measured_at, value.source.tz_offset_minutes)
    const bucket = weeks.get(week)
    if (bucket) bucket.push(value.kg)
    else weeks.set(week, [value.kg])
  }

  return [...weeks.entries()]
    // 周标识是定宽日期串，字典序即时间序
    .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
    .map(([week, kgs]) => ({
      week,
      validDays: kgs.length,
      kg: kgs.length < MIN_VALID_DAYS_PER_WEEK ? null : normalizeKg(mean(kgs)),
    }))
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * 未删除记录中测量时刻最晚的一条；没有记录时返回 `null`。
 *
 * 快速记录的预填值取它。时刻是定宽的 UTC ISO 8601，字典序即时间序，不必解析。
 */
export function latestRecord(records: readonly MeasuredRecord[]): MeasuredRecord | null {
  let latest: MeasuredRecord | null = null
  for (const record of records) {
    if (record.deleted_at !== null) continue
    if (!latest || record.measured_at > latest.measured_at) latest = record
  }
  return latest
}
