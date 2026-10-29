// @vitest-environment jsdom
/**
 * 告知同意门禁的验证。
 *
 * 核心不是「有没有这个页面」，而是三件不能让的事：未确认时不得进入业务功能、
 * 默认不得勾选、说明不得漏项。健康数据的告知一旦流于形式，等于没有告知。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyCommand } from '@/commands'
import { fixedDate } from '@/test/fixtures.ts'
import { makeRecord, momentAt } from '@/test/records.ts'
import { resetDefaultDatabase } from '@/test/seed.ts'

import { ConsentGate } from './ConsentGate.tsx'
import { ConsentPage } from './ConsentPage.tsx'
import { PrivacyPage } from './PrivacyPage.tsx'

beforeEach(async () => {
  await resetDefaultDatabase()
})

afterEach(async () => {
  cleanup()
  await resetDefaultDatabase()
})

function renderGate() {
  return render(
    <ConsentGate>
      <p>主功能已解锁</p>
    </ConsentGate>,
  )
}

describe('未同意时', () => {
  it('不展示业务内容，先给说明', async () => {
    renderGate()

    expect(await screen.findByRole('heading', { name: '使用前请先了解' })).toBeTruthy()
    expect(screen.queryByText('主功能已解锁')).toBeNull()
  })

  it('说明覆盖三项承诺与适用人群', async () => {
    renderGate()
    await screen.findByRole('heading', { name: '使用前请先了解' })

    expect(screen.getByText(/只存在这台设备的浏览器里/)).toBeTruthy()
    expect(screen.getByText(/不会上传到服务器/)).toBeTruthy()
    expect(screen.getByText(/语音识别与饮食拍照识别/)).toBeTruthy()
    expect(screen.getByText(/建议每周导出一次/)).toBeTruthy()
    expect(screen.getByText(/导出全部数据/)).toBeTruthy()
    expect(screen.getByText(/不面向 18 岁以下人群/)).toBeTruthy()
  })

  it('不收集年龄信息', async () => {
    renderGate()
    await screen.findByRole('heading', { name: '使用前请先了解' })

    expect(document.querySelector('input[type="date"]')).toBeNull()
    expect(screen.queryByLabelText(/出生|年龄/)).toBeNull()
  })
})

describe('同意的动作', () => {
  it('勾选框默认不选中', async () => {
    renderGate()
    await screen.findByRole('heading', { name: '使用前请先了解' })

    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('未勾选时确认按钮不可用', async () => {
    renderGate()
    await screen.findByRole('heading', { name: '使用前请先了解' })

    expect(
      (screen.getByRole('button', { name: /同意并开始使用/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('勾选后可以确认，确认后放行', async () => {
    renderGate()
    await screen.findByRole('heading', { name: '使用前请先了解' })

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /同意并开始使用/ }))

    expect(await screen.findByText('主功能已解锁')).toBeTruthy()
  })

  it('确认后同意时刻落库', async () => {
    renderGate()
    await screen.findByRole('heading', { name: '使用前请先了解' })

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /同意并开始使用/ }))
    await screen.findByText('主功能已解锁')

    const { appMetaRepo } = await import('@/storage')
    const [meta] = await appMetaRepo.list()
    expect(meta?.consent_at).toMatch(/Z$/)
  })

  it('已同意时直接放行，不再弹说明', async () => {
    await applyCommand('app_meta/grant_consent')

    renderGate()

    expect(await screen.findByText('主功能已解锁')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '使用前请先了解' })).toBeNull()
  })

  it('清空数据后重新要求同意', async () => {
    await applyCommand('app_meta/grant_consent')
    await applyCommand('data/clear_all')

    renderGate()

    expect(await screen.findByRole('heading', { name: '使用前请先了解' })).toBeTruthy()
  })
})

describe('同意时刻', () => {
  it('重复同意不改变首次的时刻', async () => {
    const { createCommandBus } = await import('@/commands')
    const { COMMANDS } = await import('@/commands/index.ts')
    const { defaultRepositories } = await import('@/test/seed.ts')

    const first = createCommandBus({
      definitions: COMMANDS,
      repos: defaultRepositories(),
      clock: () => fixedDate('2026-10-01T00:00:00.000Z', 480),
    })
    await first.apply('app_meta/grant_consent')

    const second = createCommandBus({
      definitions: COMMANDS,
      repos: defaultRepositories(),
      clock: () => fixedDate('2026-10-20T00:00:00.000Z', 480),
    })
    await second.apply('app_meta/grant_consent')

    const { appMetaRepo } = await import('@/storage')
    const [meta] = await appMetaRepo.list()
    expect(meta?.consent_at).toBe('2026-10-01T00:00:00.000Z')
  })

  it('同意不覆盖已有的导出时刻', async () => {
    // 前置状态经测试层写入：界面层拿到的 appMetaRepo 是只读视图，没有 put
    const { defaultRepositories } = await import('@/test/seed.ts')
    await defaultRepositories().app_meta.put(
      makeRecord(
        'app_meta',
        { consent_at: null, last_export_at: '2026-10-05T00:00:00.000Z' },
        momentAt('2026-10-05T00:00:00.000Z', 480),
      ),
    )

    await applyCommand('app_meta/grant_consent')
    const { appMetaRepo } = await import('@/storage')

    const [meta] = await appMetaRepo.list()
    expect(meta?.last_export_at).toBe('2026-10-05T00:00:00.000Z')
    expect(meta?.consent_at).not.toBeNull()
  })
})

describe('设置里的查阅入口', () => {
  it('说明内容与同意页一致', () => {
    render(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )

    expect(screen.getByText(/只存在这台设备的浏览器里/)).toBeTruthy()
    expect(screen.getByText(/语音识别与饮食拍照识别/)).toBeTruthy()
    expect(screen.getByText(/导出全部数据/)).toBeTruthy()
  })
})

describe('文案边界', () => {
  it('说明与免责文案不含诊断、疗效与效果承诺', async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <PrivacyPage />
          <ConsentPage onAgreed={() => {}} />
        </MemoryRouter>,
      )
    })

    const text = document.body.textContent ?? ''
    for (const banned of ['诊断', '治疗', '处方', '保证增肌', '疗效', '最好', '第一']) {
      expect(text, banned).not.toContain(banned)
    }
  })

  it('免责声明由外壳常驻展示，不依赖具体页面记得写', async () => {
    const { Disclaimer } = await import('./Disclaimer.tsx')

    render(<Disclaimer />)

    expect(screen.getByText(/不替代专业医疗或营养建议/)).toBeTruthy()
  })
})

describe('等待与失败', () => {
  it('读取期间给占位，而不是先放行', async () => {
    renderGate()

    expect(screen.getByRole('status', { name: '正在检查使用须知' })).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: '正在检查使用须知' })).toBeNull()
    })
  })
})
