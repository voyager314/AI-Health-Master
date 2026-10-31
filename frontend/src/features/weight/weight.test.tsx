// @vitest-environment jsdom
/**
 * 体重模块的界面行为。
 *
 * 断言打在可见文本与可交互性上。时间相关的期望值一律相对「今天」构造：自然周的
 * 边界随当天变化，写死日期会让用例在跨过那一周之后集体失效。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { kgToJin } from '@/domain'
import { clockTimeOf, recentWeekKeys } from '@/stats'
import { createNow } from '@/storage'
import { aBodyMetric } from '@/test/fixtures.ts'
import { makeRecord, momentAt } from '@/test/records.ts'
import {
  defaultRepositories,
  readDefaultEvents,
  resetDefaultDatabase,
} from '@/test/seed.ts'

import { WeightEditorPage } from './WeightEditorPage.tsx'
import { WeightPage } from './WeightPage.tsx'

// 写入失败的用例要能指定每一条 command 的失败原因；其余用例走真实实现
const failure = vi.hoisted(() => ({ reason: null as null | 'quota_exceeded' | 'constraint' | 'unknown' }))

vi.mock('@/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/commands')>()
  return {
    ...actual,
    applyCommand: (type: string, payload?: unknown) =>
      failure.reason === null
        ? actual.applyCommand(type, payload)
        : Promise.reject(new actual.StorageWriteError(type, failure.reason)),
  }
})

beforeEach(async () => {
  await resetDefaultDatabase()
})

afterEach(async () => {
  cleanup()
  await resetDefaultDatabase()
})

/** 从今天往回数 `days` 天的本地某一时刻 */
function daysAgo(days: number, hour = 8, minute = 0): Date {
  const at = new Date()
  at.setHours(hour, minute, 0, 0)
  at.setDate(at.getDate() - days)
  return at
}

/** 某天之后的第 `days` 天，同一钟点（只用于造数据） */
function plusDays(at: Date, days: number): Date {
  const next = new Date(at)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * 本周周一的本地上午。
 *
 * 周的起点用生产代码里同一个换算取，测试不自己推日历：自己推的那份一旦与生产
 * 实现的口径不同，用例就会在周界附近悄悄错位。
 */
function mondayOfThisWeek(): Date {
  const now = createNow()
  const monday = recentWeekKeys(now.iso, now.tzOffsetMinutes, 1)[0]!
  return new Date(`${monday}T08:00:00`)
}

/** 写入一条体重记录，返回它的主键与幂等键 */
async function seedWeight(at: Date, kg: number, minute = 0): Promise<{ id: string; clientId: string }> {
  const when = new Date(at.getTime() + minute * 60_000)
  const record = makeRecord(
    'body_metric',
    aBodyMetric({ weight_kg: kg, measured_at: when.toISOString() }),
    momentAt(when.toISOString(), -when.getTimezoneOffset()),
  )
  await defaultRepositories().body_metric.put(record)
  return { id: record.id, clientId: record.client_id }
}

async function storedWeights(): Promise<number[]> {
  const rows = await defaultRepositories().body_metric.list({ includeDeleted: false })
  return rows.map((row) => row.weight_kg)
}

function renderPage(path = '/weight') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/weight" element={<WeightPage />} />
        <Route path="/weight/:id" element={<WeightEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 页面上可见的本周状态。图表的文字替代也含同一句话，因此按类名定位，不按全文匹配 */
function weekStatus(): HTMLElement {
  const node = document.querySelector('.week-status')
  if (!node) throw new Error('页面上没有本周状态')
  return node as HTMLElement
}

function weightInput(): HTMLInputElement {
  return screen.getByLabelText('体重') as HTMLInputElement
}

async function recordButton(): Promise<HTMLButtonElement> {
  return screen.findByRole('button', { name: '记录' }) as Promise<HTMLButtonElement>
}

describe('空状态', () => {
  it('没有记录时不画图，只给一句话', async () => {
    renderPage()

    expect(await screen.findByText(/还没有体重记录/)).toBeTruthy()
    expect(document.querySelector('svg.chart__svg')).toBeNull()
  })

  it('没有记录时数值为空，加减与记录都不可用', async () => {
    renderPage()
    await screen.findByText(/还没有体重记录/)

    expect(weightInput().value).toBe('')
    expect((screen.getByRole('button', { name: '加' }) as HTMLButtonElement).disabled).toBe(true)
    expect((await recordButton()).disabled).toBe(true)
  })
})

describe('本周状态与趋势', () => {
  it('三个有效日显示周均', async () => {
    const monday = mondayOfThisWeek()
    await seedWeight(monday, 72.0)
    await seedWeight(plusDays(monday, 1), 72.4)
    await seedWeight(plusDays(monday, 2), 72.6)

    renderPage()

    await waitFor(() => expect(weekStatus().textContent).toContain('本周周均 72.3 kg'))
    expect(weekStatus().textContent).toContain('3 天')
  })

  it('两个有效日提示数据太少，并给出已记录的天数', async () => {
    const monday = mondayOfThisWeek()
    await seedWeight(monday, 72.0)
    await seedWeight(plusDays(monday, 1), 72.4)

    renderPage()

    await waitFor(() => expect(weekStatus().textContent).toContain('本周数据太少，已记录 2 天'))
  })

  it('同一天的多条只算一个有效日', async () => {
    const monday = mondayOfThisWeek()
    await seedWeight(monday, 72.0, 0)
    await seedWeight(monday, 72.2, 60)
    await seedWeight(monday, 72.4, 120)

    renderPage()

    await waitFor(() => expect(weekStatus().textContent).toContain('本周数据太少，已记录 1 天'))
  })

  it('趋势图带文字替代', async () => {
    const monday = mondayOfThisWeek()
    await seedWeight(monday, 72.0)
    await seedWeight(plusDays(monday, 1), 72.4)
    await seedWeight(plusDays(monday, 2), 72.6)

    renderPage()

    const chart = await screen.findByRole('img')
    expect(chart.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.body.textContent).toContain('近 12 周体重趋势')
    expect(document.body.textContent).toContain('本周周均 72.3 kg')
  })
})

describe('同一天多次记录与明细', () => {
  it('同日两条时标出当日取值，明细列出两条', async () => {
    const today = new Date()
    await seedWeight(today, 72.0, -120)
    await seedWeight(today, 72.5, -60)

    renderPage()

    await waitFor(() => expect(weekStatus().textContent).toContain('本周数据太少'))
    expect(document.body.textContent).toContain('72.5 kg · 当日值')
    expect(screen.getByText('72.0 kg')).toBeTruthy()
  })

  it('只有一条的日子不带当日取值的标记', async () => {
    await seedWeight(daysAgo(1), 72.0)

    renderPage()

    expect(await screen.findByText('72.0 kg')).toBeTruthy()
    expect(screen.queryByText(/当日值/)).toBeNull()
  })

  it('13 周前的记录既不在明细里，也仍在库中', async () => {
    await seedWeight(daysAgo(91), 90.0)
    await seedWeight(daysAgo(0), 72.4)

    renderPage()

    expect(await screen.findByText('72.4 kg')).toBeTruthy()
    expect(screen.queryByText('90.0 kg')).toBeNull()
    expect(await storedWeights()).toContain(90.0)
  })
})

describe('单位切换', () => {
  it('切换到斤后数值、明细与周均一起换算', async () => {
    const monday = mondayOfThisWeek()
    await seedWeight(monday, 72.0)
    await seedWeight(plusDays(monday, 1), 72.4)
    await seedWeight(plusDays(monday, 2), 72.6)

    renderPage()
    await waitFor(() => expect(weekStatus().textContent).toContain('本周周均'))

    fireEvent.click(screen.getByRole('button', { name: '斤' }))

    await waitFor(() => expect(weekStatus().textContent).toContain('本周周均 144.6 斤'))
    expect(weightInput().value).toBe(String(kgToJin(72.6).toFixed(1)))
  })
})

describe('快速记录', () => {
  it('预填上一条，加两次后记录为 72.6', async () => {
    await seedWeight(daysAgo(1), 72.4)

    renderPage()
    await screen.findByText(/上一条记录/)

    expect(weightInput().value).toBe('72.4')
    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(await recordButton())

    await waitFor(async () => expect(await storedWeights()).toContain(72.6))
  })

  it('连续点两次记录只产生一条', async () => {
    await seedWeight(daysAgo(1), 72.4)
    const before = (await storedWeights()).length

    renderPage()
    await screen.findByText(/上一条记录/)

    const button = await recordButton()
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(async () => expect((await storedWeights()).length).toBe(before + 1))
  })

  it('同一页再记一次是新的一条', async () => {
    await seedWeight(daysAgo(1), 72.4)
    const before = (await storedWeights()).length

    renderPage()
    await screen.findByText(/上一条记录/)

    fireEvent.click(await recordButton())
    await waitFor(async () => expect((await storedWeights()).length).toBe(before + 1))

    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(await recordButton())
    await waitFor(async () => expect((await storedWeights()).length).toBe(before + 2))
  })

  it('记录后「上一条」随之更新为刚记下的值', async () => {
    await seedWeight(daysAgo(1), 72.4)

    renderPage()
    const note = await screen.findByText(/上一条记录/)
    expect(note.textContent).toContain('72.4 kg')

    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(await recordButton())

    await waitFor(() =>
      expect(screen.getByText(/上一条记录/).textContent).toContain('72.6 kg'),
    )
  })

  it('断网时照常记录', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await seedWeight(daysAgo(1), 72.4)
    const before = (await storedWeights()).length

    renderPage()
    await screen.findByText(/上一条记录/)
    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(await recordButton())

    await waitFor(async () => expect((await storedWeights()).length).toBe(before + 1))
    online.mockRestore()
  })
})

describe('埋点', () => {
  it('未改预填值记为 kept', async () => {
    await seedWeight(daysAgo(1), 72.4)

    renderPage()
    await screen.findByText(/上一条记录/)
    fireEvent.click(await recordButton())

    await waitFor(async () => {
      const events = (await readDefaultEvents()).filter((e) => e.name === 'weight_add')
      expect(events).toHaveLength(1)
      expect(events[0]?.props).toEqual({ prefill: 'kept', unit: 'kg' })
    })
  })

  it('改了预填值记为 changed，斤显示下单位记为 jin', async () => {
    await seedWeight(daysAgo(1), 72.4)

    renderPage()
    await screen.findByText(/上一条记录/)
    fireEvent.click(screen.getByRole('button', { name: '斤' }))
    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(await recordButton())

    await waitFor(async () => {
      const events = (await readDefaultEvents()).filter((e) => e.name === 'weight_add')
      expect(events[0]?.props).toEqual({ prefill: 'changed', unit: 'jin' })
    })
  })

  it('首次记录记为 none', async () => {
    renderPage()
    await screen.findByText(/还没有体重记录/)

    fireEvent.change(weightInput(), { target: { value: '70' } })
    fireEvent.blur(weightInput())
    fireEvent.click(await recordButton())

    await waitFor(async () => {
      const events = (await readDefaultEvents()).filter((e) => e.name === 'weight_add')
      expect(events[0]?.props).toEqual({ prefill: 'none', unit: 'kg' })
    })
  })

  it('修改与删除不产生事件', async () => {
    const { id } = await seedWeight(daysAgo(1), 72.4)

    renderPage(`/weight/${id}`)
    await screen.findByText('测量时间')

    const input = weightInput()
    fireEvent.change(input, { target: { value: '72.6' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(async () => expect(await storedWeights()).toEqual([72.6]))
    const events = (await readDefaultEvents()).filter((e) => e.name === 'weight_add')
    expect(events).toEqual([])
  })
})

describe('编辑页', () => {
  it('测量时间按记录自带的偏移只读显示', async () => {
    await seedWeight(daysAgo(0, 0, 30), 72.4)
    const [record] = await defaultRepositories().body_metric.list()

    renderPage(`/weight/${record!.id}`)

    expect(await screen.findByText('测量时间')).toBeTruthy()
    expect(screen.getByText(new RegExp(clockTimeOf(record!.measured_at, record!.tz_offset_minutes)))).toBeTruthy()
    // 没有可编辑时刻的输入项
    expect(screen.queryByLabelText(/时间/)).toBeNull()
  })

  it('从斤显示的明细进入后编辑页以斤显示', async () => {
    const { id } = await seedWeight(daysAgo(1), 72.4)

    renderPage(`/weight/${id}?unit=jin`)

    await screen.findByText('测量时间')
    expect(weightInput().value).toBe('144.8')
  })

  it('改值保存后明细同步，测量时刻不变', async () => {
    const { id } = await seedWeight(daysAgo(1), 72.4)
    const before = await defaultRepositories().body_metric.get(id)

    renderPage(`/weight/${id}`)
    await screen.findByText('测量时间')

    const input = weightInput()
    fireEvent.change(input, { target: { value: '72.6' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(async () => expect(await storedWeights()).toEqual([72.6]))
    const after = await defaultRepositories().body_metric.get(id)
    expect(after?.measured_at).toBe(before?.measured_at)
    expect(after?.created_at).toBe(before?.created_at)
    expect(await screen.findByText('72.6 kg')).toBeTruthy()
  })

  it('确认后记录从明细消失，库中保留墓碑', async () => {
    const { id } = await seedWeight(daysAgo(1), 72.4)

    renderPage(`/weight/${id}`)
    await screen.findByText('测量时间')

    fireEvent.click(screen.getByRole('button', { name: '删除这条记录' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(async () => expect(await storedWeights()).toEqual([]))
    const tombstone = await defaultRepositories().body_metric.get(id)
    expect(tombstone?.deleted_at).not.toBeNull()
    expect(await screen.findByText(/还没有体重记录/)).toBeTruthy()
  })

  it('取消删除不产生改动', async () => {
    const { id } = await seedWeight(daysAgo(1), 72.4)

    renderPage(`/weight/${id}`)
    await screen.findByText('测量时间')

    fireEvent.click(screen.getByRole('button', { name: '删除这条记录' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(await storedWeights()).toEqual([72.4])
  })

  it('已删除的记录不可编辑', async () => {
    const { id } = await seedWeight(daysAgo(1), 72.4)
    await defaultRepositories().body_metric.remove(id, momentAt(new Date().toISOString(), 480))

    renderPage(`/weight/${id}`)

    expect(await screen.findByText(/这条记录不存在/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除这条记录' })).toBeNull()
  })

  it('断网时可以修改与删除', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { id } = await seedWeight(daysAgo(1), 72.4)

    renderPage(`/weight/${id}`)
    await screen.findByText('测量时间')

    const input = weightInput()
    fireEvent.change(input, { target: { value: '73' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(async () => expect(await storedWeights()).toEqual([73]))
    online.mockRestore()
  })
})

describe('写入失败', () => {
  it('记录失败时提示原因、给出两个出口，并保留调好的数值', async () => {
    await seedWeight(daysAgo(1), 72.4)
    const before = (await storedWeights()).length
    failure.reason = 'quota_exceeded'

    renderPage()
    await screen.findByText(/上一条记录/)
    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(await recordButton())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('本地存储空间不足')
    expect(screen.getByRole('link', { name: '导出数据' }).getAttribute('href')).toBe(
      '/settings/data',
    )
    // 数值留着，用户不必重新调
    expect(weightInput().value).toBe('72.5')
    expect((await storedWeights()).length).toBe(before)

    failure.reason = null
  })

  it('修改失败时停留在编辑页，并保留调好的数值', async () => {
    const { id } = await seedWeight(daysAgo(1), 72.4)
    failure.reason = 'unknown'

    renderPage(`/weight/${id}`)
    await screen.findByText('测量时间')

    const input = weightInput()
    fireEvent.change(input, { target: { value: '72.6' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    expect((await screen.findByRole('alert')).textContent).toContain('写入本地数据库失败')
    expect(screen.getByRole('button', { name: '保存修改' })).toBeTruthy()
    expect(weightInput().value).toBe('72.6')
    expect(await storedWeights()).toEqual([72.4])

    failure.reason = null
  })
})
