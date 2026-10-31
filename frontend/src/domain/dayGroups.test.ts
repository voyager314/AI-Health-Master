/**
 * 通用按日分组的验证。
 *
 * 运动记录与体重记录共用这一条规则，因此这里用一种与两者都无关的极简记录来
 * 验证规则本身，再用体重记录验证一次「换成另一个业务」时不需要改规则。
 *
 * 本文件不初始化数据库——分组是纯函数。
 */
import type { DayInstant } from '@/domain'
import { groupByDayBy } from '@/domain'
import { describe, expect, it } from 'vitest'

const CST = 480
const EDT = -240

/** 一条只为主键与时刻而生的记录，业务含义由取时刻的函数给出 */
interface Probe extends DayInstant {
  readonly id: string
}

function aProbe(id: string, instant: string, tzOffsetMinutes = CST): Probe {
  return { id, instant, tzOffsetMinutes }
}

describe('通用按日分组', () => {
  it('按取到的时刻归日，日序倒序', () => {
    const groups = groupByDayBy(
      [
        aProbe('a', '2026-10-28T23:30:00.000Z'),
        aProbe('b', '2026-10-30T12:14:00.000Z'),
      ],
      (probe) => probe,
    )

    expect(groups.map((g) => g.day)).toEqual(['2026-10-30', '2026-10-29'])
  })

  it('组内按时刻倒序，同一时刻按主键倒序', () => {
    const at = '2026-10-30T12:00:00.000Z'
    const groups = groupByDayBy(
      [
        aProbe('01a182ae-25f7-7661-b587-84998ff6f6d1', at),
        aProbe('01a182ae-25f7-7661-b587-84998ff6f6d2', at),
        aProbe('01a182ae-25f7-7661-b587-84998ff6f6d3', '2026-10-30T13:00:00.000Z'),
      ],
      (probe) => probe,
    )

    expect(groups[0]?.logs.map((p) => p.id)).toEqual([
      '01a182ae-25f7-7661-b587-84998ff6f6d3',
      '01a182ae-25f7-7661-b587-84998ff6f6d2',
      '01a182ae-25f7-7661-b587-84998ff6f6d1',
    ])
  })

  it('不同记录可以带不同偏移，各按各的判定', () => {
    const at = '2026-10-30T03:00:00.000Z'
    const groups = groupByDayBy(
      [aProbe('east', at, CST), aProbe('west', at, EDT)],
      (probe) => probe,
    )

    expect(groups.map((g) => g.day)).toEqual(['2026-10-30', '2026-10-29'])
  })

  it('取时刻的函数可以换，规则不变', () => {
    const rows = [
      { id: 'a', at: '2026-10-30T12:00:00.000Z', tz: CST },
      { id: 'b', at: '2026-10-30T13:00:00.000Z', tz: CST },
    ]
    const groups = groupByDayBy(rows, (row) => ({
      instant: row.at,
      tzOffsetMinutes: row.tz,
    }))

    expect(groups).toHaveLength(1)
    expect(groups[0]?.logs.map((row) => row.id)).toEqual(['b', 'a'])
  })

  it('空数组返回空结果，输入数组不被修改', () => {
    expect(groupByDayBy([], (probe) => probe)).toEqual([])

    const input = [
      aProbe('a', '2026-10-29T23:30:00.000Z'),
      aProbe('b', '2026-10-30T12:14:00.000Z'),
    ]
    groupByDayBy(input, (probe) => probe)
    expect(input.map((p) => p.id)).toEqual(['a', 'b'])
  })
})
