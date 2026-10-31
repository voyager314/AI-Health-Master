// @vitest-environment jsdom
/**
 * 埋点失败时的体重记录。
 *
 * 用户来记录体重，不是来贡献数据的：统计写不进去只影响统计。界面在连埋点函数
 * 整个坏掉时也不能被拖住——记录照常保存，界面不出现任何错误。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { aBodyMetric } from '@/test/fixtures.ts'
import { makeRecord, momentAt } from '@/test/records.ts'
import { defaultRepositories, resetDefaultDatabase } from '@/test/seed.ts'

import { WeightPage } from './WeightPage.tsx'

vi.mock('@/telemetry', () => ({
  trackWeightAdd: () => Promise.reject(new Error('埋点写入失败')),
}))

beforeEach(async () => {
  await resetDefaultDatabase()
  const at = new Date()
  at.setDate(at.getDate() - 1)
  at.setHours(8, 0, 0, 0)
  await defaultRepositories().body_metric.put(
    makeRecord(
      'body_metric',
      aBodyMetric({ weight_kg: 72.4, measured_at: at.toISOString() }),
      momentAt(at.toISOString(), -at.getTimezoneOffset()),
    ),
  )
})

afterEach(async () => {
  cleanup()
  await resetDefaultDatabase()
})

describe('埋点失败', () => {
  it('记录照常保存，且不出现错误提示', async () => {
    render(
      <MemoryRouter initialEntries={['/weight']}>
        <Routes>
          <Route path="/weight" element={<WeightPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText(/上一条记录/)
    fireEvent.click(screen.getByRole('button', { name: '记录' }))

    await waitFor(async () => {
      const rows = await defaultRepositories().body_metric.list()
      expect(rows).toHaveLength(2)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
