/**
 * 自然日与自然周的边界计算。
 *
 * 这是全仓库唯一允许出现日界与周界算术的位置。同一套规则若在两处实现，
 * 分歧只会出现在跨零点、跨周界、跨时区这些边缘样本上，而这类错误在日常
 * 使用中几乎不会被察觉——周统计悄悄少算一天，没人看得出来。
 *
 * 归属一律按记录自身携带的时区偏移判定，不按设备当前时区。用户飞到另一个
 * 时区之后，三个月前那条记录仍然属于它当时所在的那一天。
 *
 * 全部为纯函数：入参即全部输入，不读存储、无副作用、相同输入恒得相同输出。
 */

/** 自然日标识，形如 `2026-10-28`，按本地日界划分而非 UTC 日界 */
export type DayKey = string

/**
 * 半开区间 `[from, to)`，两端都是 UTC 时刻。
 *
 * 终点取下一周期的起点而不是本周期的末刻：用末刻会在「23:59:59.999 之后、
 * 次日零点之前」留下一道无法归属的缝隙，落在其中的记录会从所有统计里消失。
 */
export interface Interval {
  /** 区间起点，含 */
  readonly from: string
  /** 区间终点，不含 */
  readonly to: string
}

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/**
 * 把 UTC 时刻平移到指定偏移下的本地挂钟时间。
 *
 * 平移后的 Date 只应通过 `getUTC*` 系列读取——它的 UTC 字段此时承载的是本地
 * 挂钟值。用 `getFullYear()` 这类本地方法读会再叠加一次运行环境的时区偏移。
 */
function toLocalClock(instant: string, tzOffsetMinutes: number): Date {
  const ms = Date.parse(instant)
  if (Number.isNaN(ms)) throw new RangeError(`不是合法的时刻：${instant}`)
  return new Date(ms + tzOffsetMinutes * MINUTE_MS)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 校验自然日跨度。
 *
 * 零与负数没有意义：跨度 0 会得到一个空区间，负数则会让区间倒转，两者都会让
 * 调用方拿着一个看起来正常、实际什么都取不到的窗口继续往下走。
 */
function assertDayCount(days: number): void {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`自然日跨度应为正整数：${days}`)
  }
}

/**
 * 某时刻所在自然日的本地零点，返回对应的 UTC 毫秒数。
 *
 * 「本地零点」是按传入偏移算出的挂钟零点，不是运行环境的零点：同一时刻在北京
 * 与纽约属于不同的自然日，各自零点相差十几个小时。
 */
function localDayStartMs(instant: string, tzOffsetMinutes: number): number {
  const local = toLocalClock(instant, tzOffsetMinutes)
  const localMidnightMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  )
  return localMidnightMs - tzOffsetMinutes * MINUTE_MS
}

/**
 * 求某个时刻所属的自然日。
 *
 * `instant` 为 UTC ISO 8601 时刻；`tzOffsetMinutes` 为相对 UTC 的分钟偏移，
 * 东为正（UTC+8 即 480）。返回该偏移下的日期标识。
 *
 * 时刻不可解析时抛 `RangeError`，不返回兜底值——一个错误的日期会静默污染
 * 整段统计，比当场失败难查得多。
 */
export function dayKeyOf(instant: string, tzOffsetMinutes: number): DayKey {
  const local = toLocalClock(instant, tzOffsetMinutes)
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
}

/**
 * 以某时刻所在的自然日为终点，往前数若干自然日，返回这段窗口的 UTC 区间。
 *
 * `days` 为窗口包含的自然日数量，正整数：`days = 1` 就是 `now` 所在那一天，
 * `days = 30` 是含今天在内的 30 个自然日。起点是窗口首日的本地零点，终点是
 * `now` 所在日次日零点（不含），因此窗口始终覆盖完整的天，不随 `now` 的时刻
 * 在一天里的位置变化。
 *
 * 偏移在整段窗口内按常量处理，行为与 `weekInterval` 一致：记录携带的是写入
 * 当时的偏移快照，跨夏令时切换的那段窗口因此按 `days × 24` 小时计算。
 */
export function recentDayInterval(
  now: string,
  tzOffsetMinutes: number,
  days: number,
): Interval {
  assertDayCount(days)
  const todayStartMs = localDayStartMs(now, tzOffsetMinutes)
  const fromMs = todayStartMs - (days - 1) * DAY_MS

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(todayStartMs + DAY_MS).toISOString(),
  }
}

/**
 * 保留期的截止时刻：早于它的记录已经超出保留期。
 *
 * 与 `recentDayInterval` 共用同一套日界规则——取的就是同一段窗口的起点，因此
 * 「保留期」与「可查阅的最长窗口」是同一段时间：留在库里的记录一定查得到，
 * 查得到的记录一定还在库里。
 *
 * 返回的是区间起点而不是末刻，与 `Interval` 的半开语义一致：截止时刻当天的
 * 记录仍然保留。
 */
export function retentionCutoff(
  now: string,
  tzOffsetMinutes: number,
  days: number,
): string {
  return recentDayInterval(now, tzOffsetMinutes, days).from
}

/**
 * 求某个时刻所属的自然周，返回该周的 UTC 时刻区间。
 *
 * 自然周为周一至周日：起点是该时刻之前最近一个周一的本地零点，终点是下一个
 * 周一的本地零点（不含）。参数含义同 `dayKeyOf`。
 *
 * 偏移在整周内按常量处理。记录携带的是写入当时的偏移快照，因此跨夏令时切换的
 * 那一周会按 7×24 小时计算，而不是 7×24±1 小时。
 */
export function weekInterval(instant: string, tzOffsetMinutes: number): Interval {
  const local = toLocalClock(instant, tzOffsetMinutes)

  // getUTCDay() 以周日为 0，而自然周以周一开头，故整体右移一位再取模
  const daysSinceMonday = (local.getUTCDay() + 6) % 7

  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  )
  const startLocalMs = localMidnight - daysSinceMonday * DAY_MS
  const startUtcMs = startLocalMs - tzOffsetMinutes * MINUTE_MS

  return {
    from: new Date(startUtcMs).toISOString(),
    to: new Date(startUtcMs + 7 * DAY_MS).toISOString(),
  }
}

/**
 * 求某个时刻所属自然周的标识，取该周周一的自然日标识。
 *
 * 参数含义同 `dayKeyOf`。按周分组、判断两条记录是否同周，都用这个值而不是
 * `weekInterval` 的起点：同一个「本地周一零点」在不同偏移下是不同的 UTC 时刻，
 * 拿时刻比较会把跨时区的同一周判成两周。
 */
export function weekKeyOf(instant: string, tzOffsetMinutes: number): DayKey {
  return dayKeyOf(weekInterval(instant, tzOffsetMinutes).from, tzOffsetMinutes)
}

/**
 * 判断两个时刻是否落在同一个自然周。
 *
 * 两端各自携带自己的偏移，用户跨时区时就是如此。判定依据是本地周标签而非
 * 绝对时刻区间：用户周五从北京飞到纽约，这一周对他仍然是同一周，哪怕两地的
 * 周一零点相差十几个小时。
 */
export function isSameWeek(
  a: string,
  aTzOffsetMinutes: number,
  b: string,
  bTzOffsetMinutes: number,
): boolean {
  return weekKeyOf(a, aTzOffsetMinutes) === weekKeyOf(b, bTzOffsetMinutes)
}
