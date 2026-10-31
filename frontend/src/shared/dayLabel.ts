/**
 * 自然日标识转成可读的日期。
 *
 * `DayKey` 是定宽的 `YYYY-MM-DD`，按位置切片即可，不必解析成日期——本函数只做
 * 展示。任何日期算术都属于 `stats/timeWindow`，这里不做加减。
 */
export function dayLabel(day: string): string {
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`
}
