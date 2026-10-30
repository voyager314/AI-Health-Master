// @vitest-environment jsdom
/**
 * 埋点失败时的业务行为。
 *
 * 用户来记录训练，不是来贡献数据的：统计写不进去只影响统计，保存照常成功、
 * 界面不出现任何错误提示。这条规则在 `telemetry/` 里已经靠吞掉错误实现，这里
 * 验证的是界面在连埋点函数整个坏掉时也不会被拖住。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultRepositories, resetDefaultDatabase } from '@/test/seed.ts'

import { WorkoutEditorPage } from './WorkoutEditorPage.tsx'

// 埋点整体失败：三个事件都直接拒绝，模拟数据库写不进去
vi.mock('@/telemetry', () => ({
  trackItemChange: () => Promise.reject(new Error('埋点写入失败')),
  trackRecordSave: () => Promise.reject(new Error('埋点写入失败')),
  trackHistoryExpand: () => Promise.reject(new Error('埋点写入失败')),
}))

beforeEach(async () => {
  await resetDefaultDatabase()
})

afterEach(async () => {
  cleanup()
  await resetDefaultDatabase()
})

describe('埋点失败', () => {
  it('保存照常成功，且不出现错误提示', async () => {
    render(
      <MemoryRouter initialEntries={['/workout/new']}>
        <Routes>
          <Route path="/workout" element={<p>列表页</p>} />
          <Route path="/workout/new" element={<WorkoutEditorPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const form = screen.getByRole('form')
    fireEvent.change(within(form).getByLabelText('项目名'), { target: { value: '卧推' } })
    fireEvent.change(within(form).getByLabelText('组数'), { target: { value: '4' } })

    // 添加卡片本身也发埋点，同样不能拦住操作
    fireEvent.click(screen.getByRole('button', { name: '添加一项' }))
    fireEvent.click(screen.getAllByRole('button', { name: '删除这一项' })[1]!)
    fireEvent.click(within(screen.getByRole('form')).getByRole('button', { name: '保存' }))

    expect(await screen.findByText('列表页')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    await waitFor(async () => {
      const saved = await defaultRepositories().workout_log.list()
      expect(saved).toHaveLength(1)
    })
  })
})
