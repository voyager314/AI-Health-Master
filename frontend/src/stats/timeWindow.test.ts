/**
 * 自然日与自然周边界的穷举验证。
 *
 * 重点在边缘样本：跨零点、跨周界、跨月界、东西半球偏移。日常样本即使算错也
 * 看不出来，出问题的永远是这些边界。
 *
 * 本文件不初始化数据库——时间窗口计算是纯函数，脱离存储即可验证。
 */
import { dayKeyOf, isSameWeek, weekInterval, weekKeyOf } from '@/stats'
import { describe, expect, it } from 'vitest'

/** 北京时间 UTC+8 */
const CST = 480
/** 美东夏令时 UTC-4 */
const EDT = -240
/** 美中标准时 UTC-6 */
const CDT = -300

describe('自然日归属', () => {
  it('按记录自身的偏移判定，而不是 UTC 日界', () => {
    // UTC 时间仍是 27 号晚上，但 UTC+8 的本地挂钟已经是 28 号凌晨
    const instant = '2026-10-27T16:30:00.000Z'
    expect(dayKeyOf(instant, CST)).toBe('2026-10-28')
    expect(dayKeyOf(instant, 0)).toBe('2026-10-27')
  })

  it('同一时刻在东西半球分属不同的自然日', () => {
    const instant = '2026-10-28T03:00:00.000Z'
    expect(dayKeyOf(instant, CST)).toBe('2026-10-28')
    expect(dayKeyOf(instant, CDT)).toBe('2026-10-27')
  })

  it('本地零点整归入当天，而不是前一天', () => {
    // UTC+8 的 10-28 00:00:00 对应 UTC 的 10-27 16:00:00
    expect(dayKeyOf('2026-10-27T16:00:00.000Z', CST)).toBe('2026-10-28')
  })

  it('本地当天的最后一毫秒仍归入当天', () => {
    expect(dayKeyOf('2026-10-28T15:59:59.999Z', CST)).toBe('2026-10-28')
    expect(dayKeyOf('2026-10-28T16:00:00.000Z', CST)).toBe('2026-10-29')
  })

  it('跨月界与跨年界', () => {
    expect(dayKeyOf('2026-10-31T16:00:00.000Z', CST)).toBe('2026-11-01')
    expect(dayKeyOf('2026-12-31T16:00:00.000Z', CST)).toBe('2027-01-01')
  })

  it('月与日补零到两位', () => {
    expect(dayKeyOf('2026-01-05T00:00:00.000Z', 0)).toBe('2026-01-05')
  })

  it('时刻不可解析时抛错，不返回兜底值', () => {
    expect(() => dayKeyOf('not-a-time', CST)).toThrow(RangeError)
  })
})

describe('自然周区间', () => {
  // 2026-10-28 是星期三
  const wednesday = '2026-10-28T03:00:00.000Z'

  it('起点是本地时间上一个周一的零点', () => {
    const week = weekInterval(wednesday, CST)
    // UTC+8 的 10-26（周一）00:00 对应 UTC 的 10-25 16:00
    expect(week.from).toBe('2026-10-25T16:00:00.000Z')
    expect(dayKeyOf(week.from, CST)).toBe('2026-10-26')
  })

  it('终点是下一个周一的本地零点，不含', () => {
    const week = weekInterval(wednesday, CST)
    expect(week.to).toBe('2026-11-01T16:00:00.000Z')
    expect(dayKeyOf(week.to, CST)).toBe('2026-11-02')
  })

  it('覆盖整个周日，直到它的最后一毫秒', () => {
    const week = weekInterval(wednesday, CST)
    const sundayLastMs = '2026-11-01T15:59:59.999Z'

    expect(dayKeyOf(sundayLastMs, CST)).toBe('2026-11-01')
    expect(sundayLastMs >= week.from && sundayLastMs < week.to).toBe(true)
  })

  it('周一零点整归入该周，而不是上一周', () => {
    const mondayMidnight = '2026-10-25T16:00:00.000Z'
    expect(weekInterval(mondayMidnight, CST).from).toBe(mondayMidnight)
  })

  it('周日与紧随其后的周一分属相邻两周', () => {
    const sunday = '2026-11-01T10:00:00.000Z'
    const monday = '2026-11-02T10:00:00.000Z'

    expect(weekInterval(sunday, CST).to).toBe(weekInterval(monday, CST).from)
  })

  it('一周恰好七天', () => {
    const week = weekInterval(wednesday, CST)
    const span = Date.parse(week.to) - Date.parse(week.from)
    expect(span).toBe(7 * 86_400_000)
  })

  it('同一时刻在不同偏移下可能分属不同的周', () => {
    // UTC+8 已是周一凌晨，UTC-5 还停在上周日傍晚
    const instant = '2026-11-01T17:00:00.000Z'
    expect(dayKeyOf(instant, CST)).toBe('2026-11-02')
    expect(dayKeyOf(instant, CDT)).toBe('2026-11-01')
    expect(weekInterval(instant, CST).from).not.toBe(weekInterval(instant, CDT).from)
  })

  it('跨月的周不被月界切断', () => {
    const week = weekInterval('2026-10-30T03:00:00.000Z', CST)
    expect(dayKeyOf(week.from, CST)).toBe('2026-10-26')
    expect(dayKeyOf(week.to, CST)).toBe('2026-11-02')
  })
})

describe('同周判定', () => {
  it('周三与同周周日属于同一周', () => {
    expect(isSameWeek('2026-10-28T03:00:00.000Z', CST, '2026-11-01T03:00:00.000Z', CST)).toBe(
      true,
    )
  })

  it('周日与次日周一不属于同一周', () => {
    expect(isSameWeek('2026-11-01T03:00:00.000Z', CST, '2026-11-02T03:00:00.000Z', CST)).toBe(
      false,
    )
  })

  it('周标识取该周周一的自然日', () => {
    expect(weekKeyOf('2026-10-28T03:00:00.000Z', CST)).toBe('2026-10-26')
    expect(weekKeyOf('2026-11-01T03:00:00.000Z', CST)).toBe('2026-10-26')
  })

  it('按本地周标签判定，不按绝对时刻区间', () => {
    // 用户周五在北京记一条，当天飞到纽约又记一条。对他这是同一周，
    // 但两地的「本周一零点」相差 12 小时，比较周区间起点会判成两周。
    const inBeijing = '2026-10-30T02:00:00.000Z'
    const inNewYork = '2026-10-30T20:00:00.000Z'

    expect(weekKeyOf(inBeijing, CST)).toBe('2026-10-26')
    expect(weekKeyOf(inNewYork, EDT)).toBe('2026-10-26')
    expect(isSameWeek(inBeijing, CST, inNewYork, EDT)).toBe(true)

    expect(weekInterval(inBeijing, CST).from).not.toBe(weekInterval(inNewYork, EDT).from)
  })
})
