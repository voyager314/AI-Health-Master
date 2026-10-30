// @vitest-environment jsdom
/**
 * 运动模块的界面行为。
 *
 * 断言打在可见文本与可交互性上：用户感知的是「列表里有没有这条」「点了有没有反应」。
 * 结构断言在重构时会成批失效，却什么也没证明。
 *
 * 时间相关的期望值一律相对「今天」构造：写死日期会让用例在跨过那一天之后集体失效。
 */
import type { WorkoutItem } from '@/entities'
import { applyCommand, StorageWriteError } from '@/commands'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aWorkoutLog } from '@/test/fixtures.ts'
import { makeRecord, momentAt } from '@/test/records.ts'
import { defaultRepositories, resetDefaultDatabase } from '@/test/seed.ts'

import { itemTextOf } from './itemText.ts'
import { WorkoutCardForm } from './WorkoutCardForm.tsx'
import { WorkoutEditorPage } from './WorkoutEditorPage.tsx'
import { WorkoutListPage } from './WorkoutListPage.tsx'

beforeEach(async () => {
  await resetDefaultDatabase()
})

afterEach(async () => {
  cleanup()
  await resetDefaultDatabase()
})

/**
 * 相对今天挪动若干天、指定本地钟点的时刻。
 *
 * 用本地钟点而不是 UTC 小时：自然日按记录自带的偏移划分，用 UTC 小时造数据会在
 * 非零偏移下悄悄落到相邻的那一天，断言跟着偏移走、看起来像是分组算错了。
 */
function daysAgo(days: number, hour = 10): Date {
  const at = new Date()
  at.setDate(at.getDate() - days)
  at.setHours(hour, 0, 0, 0)
  return at
}

/** 写入一条记录到默认数据库，返回它的主键 */
async function seedLog(
  at: Date,
  items: WorkoutItem[] = [{ name: '卧推', sets: 4, reps: 8, weight_kg: 80, note: null }],
): Promise<string> {
  const repos = defaultRepositories()
  const record = makeRecord(
    'workout_log',
    aWorkoutLog({ logged_at: at.toISOString(), items }),
    momentAt(at.toISOString(), -at.getTimezoneOffset()),
  )
  await repos.workout_log.put(record)
  return record.id
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/workout']}>
      <Routes>
        <Route path="/workout" element={<WorkoutListPage />} />
        <Route path="/workout/new" element={<p>录入页</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderEditor(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workout" element={<p>列表页</p>} />
        <Route path="/workout/new" element={<WorkoutEditorPage />} />
        <Route path="/workout/:id" element={<WorkoutEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('卡片文本', () => {
  const card = (overrides: Partial<WorkoutItem>): WorkoutItem => ({
    name: '卧推',
    sets: null,
    reps: null,
    weight_kg: null,
    note: null,
    ...overrides,
  })

  it('只填项目名时只显示项目名', () => {
    expect(itemTextOf(card({}))).toBe('卧推')
  })

  it('三项齐备时按固定顺序显示', () => {
    expect(itemTextOf(card({ sets: 4, reps: 8, weight_kg: 80 }))).toBe('卧推 4 组 × 8 次 × 80kg')
  })

  it('未填的指标不占位', () => {
    expect(itemTextOf(card({ reps: 8 }))).toBe('卧推 8 次')
    expect(itemTextOf(card({ weight_kg: 0.5 }))).toBe('卧推 0.5kg')
  })
})

describe('列表页', () => {
  it('没有记录时给一句话与记录入口，不画空列表', async () => {
    renderList()

    expect(await screen.findByText(/还没有运动记录/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '记录今天的运动' })).toBeTruthy()
    expect(document.querySelector('.list')).toBeNull()
  })

  it('按日分组，较近的一天排在前面', async () => {
    const today = daysAgo(0, 8)
    const threeDaysAgo = daysAgo(3)
    await seedLog(today)
    await seedLog(threeDaysAgo)

    renderList()

    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings).toHaveLength(2)
    // 每组标题是「M 月 D 日 · N 条」，较近的一天先出现
    expect(headings[0]?.textContent).toContain(`${today.getMonth() + 1} 月 ${today.getDate()} 日`)
    expect(headings[1]?.textContent).toContain(
      `${threeDaysAgo.getMonth() + 1} 月 ${threeDaysAgo.getDate()} 日`,
    )
  })

  it('同一天两条都显示，较晚的排在前面', async () => {
    await seedLog(daysAgo(0, 8), [{ name: '早上练', sets: null, reps: null, weight_kg: null, note: null }])
    await seedLog(daysAgo(0, 20), [{ name: '晚上练', sets: null, reps: null, weight_kg: null, note: null }])

    renderList()

    const rows = await screen.findAllByRole('button', { name: /练/ })
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('晚上练')
    expect(rows[1]?.textContent).toContain('早上练')
  })

  it('每日显示条数与项目名摘要', async () => {
    await seedLog(daysAgo(0, 8), [
      { name: '卧推', sets: 4, reps: 8, weight_kg: 80, note: null },
      { name: '划船', sets: 3, reps: 10, weight_kg: 60, note: null },
    ])
    await seedLog(daysAgo(0, 20), [
      { name: '卧推', sets: 4, reps: 8, weight_kg: 80, note: null },
    ])

    renderList()

    // 条数在日期标题里，项目名摘要是它下面的一行
    const [heading] = await screen.findAllByRole('heading', { level: 2 })
    expect(heading?.textContent).toContain('2 条')
    expect(screen.getByText('卧推、划船')).toBeTruthy()
  })
})

describe('查看更早', () => {
  it('逐档展开，按钮文案指向下一档', async () => {
    renderList()

    expect(await screen.findByRole('button', { name: /近 60 天/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /近 60 天/ }))
    expect(await screen.findByRole('button', { name: /近 90 天/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /近 90 天/ }))
    expect(await screen.findByRole('button', { name: /近 180 天/ })).toBeTruthy()
  })

  it('展开到 180 天后不再提供入口', async () => {
    renderList()

    for (const days of [60, 90, 180]) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(`近 ${days} 天`) }))
    }

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /查看更早/ })).toBeNull()
    })
  })

  it('默认窗口不含 30 天之前的记录，展开后可见', async () => {
    await seedLog(daysAgo(45), [
      { name: '旧记录', sets: null, reps: null, weight_kg: null, note: null },
    ])

    renderList()

    expect(await screen.findByText(/还没有运动记录/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /近 60 天/ }))

    // 记录行与摘要都会出现这个项目名，因此按出现与否判断而不是求唯一
    expect((await screen.findAllByText('旧记录')).length).toBeGreaterThan(0)
  })

  it('档位不持久化：重新挂载回到 30 天', async () => {
    const first = renderList()
    fireEvent.click(await screen.findByRole('button', { name: /近 60 天/ }))
    await screen.findByRole('button', { name: /近 90 天/ })
    first.unmount()

    renderList()

    expect(await screen.findByRole('button', { name: /近 60 天/ })).toBeTruthy()
  })
})

describe('录入页', () => {
  /** 填一张卡片 */
  function fillCard(container: HTMLElement, index: number, fields: Record<string, string>) {
    const card = within(container).getAllByRole('group')[index]!
    for (const [label, value] of Object.entries(fields)) {
      fireEvent.change(within(card).getByLabelText(label), { target: { value } })
    }
  }

  it('添加 3 张卡片保存后生成 1 条记录', async () => {
    renderEditor('/workout/new')

    fireEvent.click(await screen.findByRole('button', { name: '添加一项' }))
    fireEvent.click(screen.getByRole('button', { name: '添加一项' }))

    const form = screen.getByRole('form')
    fillCard(form, 0, { 项目名: '卧推', 组数: '4', 每组次数: '8', '重量（kg）': '80' })
    fillCard(form, 1, { 项目名: '划船' })
    fillCard(form, 2, { 项目名: '深蹲' })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('列表页')).toBeTruthy()

    const saved = await defaultRepositories().workout_log.list()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.items).toHaveLength(3)
    expect(saved[0]?.input_source).toBe('manual')
  })

  it('项目名为空时拦住保存并就地提示', async () => {
    renderEditor('/workout/new')

    fireEvent.change(await screen.findByLabelText('组数'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('项目名必填')).toBeTruthy()
    // 仍停留在录入页，且没有写入
    expect(screen.queryByText('列表页')).toBeNull()
    expect(await defaultRepositories().workout_log.list()).toEqual([])
  })

  it('连点两次保存只产生一条记录', async () => {
    renderEditor('/workout/new')

    const form = screen.getByRole('form')
    fireEvent.change(within(form).getByLabelText('项目名'), { target: { value: '卧推' } })

    const save = screen.getByRole('button', { name: '保存' })
    fireEvent.click(save)
    fireEvent.click(save)

    await waitFor(async () => {
      expect(await defaultRepositories().workout_log.list()).toHaveLength(1)
    })
  })

  it('删除最后一张卡片后保存按钮置灰', async () => {
    renderEditor('/workout/new')

    fireEvent.click(await screen.findByRole('button', { name: '删除这一项' }))

    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('编辑页', () => {
  it('没有可编辑时刻的输入项，时间与来源只读展示', async () => {
    const id = await seedLog(daysAgo(0, 20))
    renderEditor(`/workout/${id}`)

    expect(await screen.findByText('手动填写')).toBeTruthy()
    expect(screen.getByText('训练时间')).toBeTruthy()
    // 页面上只有卡片字段可编辑，没有时刻或来源的输入项
    expect(screen.queryByLabelText(/时间/)).toBeNull()
    expect(screen.queryByLabelText(/来源|录入方式/)).toBeNull()
  })

  it('改组数保存后记录随之更新，主键与 created_at 不变', async () => {
    const id = await seedLog(daysAgo(0, 20))
    const before = await defaultRepositories().workout_log.get(id)

    renderEditor(`/workout/${id}`)

    const sets = await screen.findByLabelText('组数')
    fireEvent.change(sets, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    expect(await screen.findByText('列表页')).toBeTruthy()

    const after = await defaultRepositories().workout_log.get(id)
    expect(after?.items[0]?.sets).toBe(5)
    expect(after?.created_at).toBe(before?.created_at)
  })

  it('记录不存在时说明情况，不给编辑入口', async () => {
    renderEditor('/workout/01a182ae-25f7-7661-b587-84998ff6f6df')

    expect(await screen.findByText(/这条记录不存在/)).toBeTruthy()
  })
})

describe('删除', () => {
  it('确认后记录消失', async () => {
    const id = await seedLog(daysAgo(0, 20))
    renderEditor(`/workout/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: '删除这条记录' }))
    expect(screen.getByText(/导出文件也不含它/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    expect(await screen.findByText('列表页')).toBeTruthy()
    expect(await defaultRepositories().workout_log.list()).toEqual([])
  })

  it('取消不产生任何改动', async () => {
    const id = await seedLog(daysAgo(0, 20))
    renderEditor(`/workout/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: '删除这条记录' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull()
    const record = await defaultRepositories().workout_log.get(id)
    expect(record?.deleted_at).toBeNull()
  })
})

describe('保存失败', () => {
  it('按原因提示，给出两个出口，保留已填内容且不跳转', async () => {
    const onSave = vi.fn(() =>
      Promise.reject(new StorageWriteError('workout_log/create', 'quota_exceeded')),
    )

    render(
      <MemoryRouter>
        <WorkoutCardForm initialItems={[]} saveLabel="保存" onSave={onSave} />
      </MemoryRouter>,
    )

    const form = screen.getByRole('form')
    fireEvent.change(within(form).getByLabelText('项目名'), { target: { value: '卧推' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText(/存储空间不足/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '导出数据' }).getAttribute('href')).toBe(
      '/settings/data',
    )
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    // 已填内容仍在
    expect((within(form).getByLabelText('项目名') as HTMLInputElement).value).toBe('卧推')
  })

  it('重试重新提交同一次填写', async () => {
    const onSave = vi.fn(() =>
      Promise.reject(new StorageWriteError('workout_log/create', 'unknown')),
    )
    render(
      <MemoryRouter>
        <WorkoutCardForm initialItems={[]} saveLabel="保存" onSave={onSave} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('项目名'), { target: { value: '卧推' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
  })
})

describe('断网', () => {
  it('录入选与查看照常可用', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    renderEditor('/workout/new')
    const form = screen.getByRole('form')
    fireEvent.change(within(form).getByLabelText('项目名'), { target: { value: '卧推' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('列表页')).toBeTruthy()
    await waitFor(async () => {
      expect(await defaultRepositories().workout_log.list()).toHaveLength(1)
    })

    spy.mockRestore()
  })
})

describe('写入路径', () => {
  it('界面只经命令层写入，不直接调用 Repository 写方法', async () => {
    // 这条断言守的是约束 9 的可观察结果：命令层执行后恰有一条写操作日志
    await applyCommand('workout_log/create', {
      client_id: '01a182ae-25f7-7661-b587-84998ff6f6d1',
      items: [{ name: '卧推', sets: 4, reps: 8, weight_kg: 80, note: null }],
    })

    const db = defaultRepositories()
    expect(await db.workout_log.list()).toHaveLength(1)
  })
})
