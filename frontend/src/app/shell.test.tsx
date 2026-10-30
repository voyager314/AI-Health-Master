// @vitest-environment jsdom
/**
 * 应用外壳的行为验证：路由、导航高亮、首页状态、更新提示与样式基线。
 *
 * 断言打在可见文本与可交互性上，而不是组件结构：用户感知到的是「有没有内容」、
 * 「点了有没有反应」，结构断言在重构时会成批失效却什么也没证明。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { indexCss } from '@/test/sources.ts'
import { resetDefaultDatabase, seedDefaultDatabase } from '@/test/seed.ts'
import {
  resetPwaRegisterStub,
  setNeedRefreshForTest,
  updateCallCount,
} from '@/test/pwaRegisterStub.ts'

import { BottomNav } from './BottomNav.tsx'
import { NotFoundPage } from './NotFoundPage.tsx'
import { isNavActive, navItems, routeElements } from './routes.tsx'
import { UpdatePrompt } from './UpdatePrompt.tsx'

beforeEach(() => resetPwaRegisterStub())
afterEach(async () => {
  cleanup()
  await resetDefaultDatabase()
})

/** 把某个路径渲染进完整路由表，模拟直接打开该地址 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {routeElements.map(({ path: p, element }) => (
          <Route key={p} path={p} element={element} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('路由', () => {
  it('已规划的每个地址都能打开，不会落到「没有这个页面」', () => {
    for (const { path } of routeElements) {
      const { unmount } = renderAt(path)
      expect(screen.queryByText('没有这个页面'), path).toBeNull()
      unmount()
    }
  })

  it('未实现的页面展示占位说明而不是 404', () => {
    renderAt('/workout')

    expect(screen.getByRole('heading', { name: '运动记录' })).toBeTruthy()
    expect(screen.getByText('这个功能还没有上线。')).toBeTruthy()
  })

  it('未定义的地址才落到 404', () => {
    renderAt('/no-such-page')

    expect(screen.getByRole('heading', { name: '没有这个页面' })).toBeTruthy()
  })

  it('设置下的子页可以直达', () => {
    renderAt('/settings/data')

    expect(screen.getByRole('heading', { name: '导出与导入' })).toBeTruthy()
  })

  it('数据处理说明可直达，内容含三项承诺', () => {
    renderAt('/settings/privacy')

    expect(screen.getByText(/只存在这台设备的浏览器里/)).toBeTruthy()
    expect(screen.getByText(/语音识别与饮食拍照识别/)).toBeTruthy()
    expect(screen.getByText(/导出全部数据/)).toBeTruthy()
  })
})

describe('底部导航', () => {
  it('四个入口齐备', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    )

    for (const item of navItems) {
      expect(screen.getByRole('link', { name: item.label })).toBeTruthy()
    }
  })

  it('当前页高亮，其他页不高亮', () => {
    render(
      <MemoryRouter initialEntries={['/weight']}>
        <BottomNav />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '体重' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '今日' }).getAttribute('aria-current')).toBeNull()
  })

  it('进入设置子页后设置仍然高亮', () => {
    render(
      <MemoryRouter initialEntries={['/settings/data']}>
        <BottomNav />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '设置' }).getAttribute('aria-current')).toBe('page')
  })

  it('高亮判定不把前缀相同的其他路径算进去', () => {
    expect(isNavActive('/settings', '/settings/data')).toBe(true)
    expect(isNavActive('/weight', '/weights')).toBe(false)
    expect(isNavActive('/', '/weight')).toBe(false)
  })

  it('点击导航切换页面', async () => {
    function Where() {
      return <p>当前 {useLocation().pathname}</p>
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
        <Where />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('link', { name: '设置' }))

    await waitFor(() => {
      expect(screen.getByText('当前 /settings')).toBeTruthy()
    })
  })
})

describe('首页状态', () => {
  it('读取期间展示加载占位', () => {
    renderAt('/')

    expect(screen.getByRole('status', { name: '正在读取本地记录' })).toBeTruthy()
  })

  it('没有数据时不画空图表，只给一句话与一个主行动', async () => {
    renderAt('/')

    expect(await screen.findByText(/还没有任何记录/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '记录今天的运动' })).toBeTruthy()
    expect(document.querySelector('.stats')).toBeNull()
  })

  it('有数据时展示概况', async () => {
    await seedDefaultDatabase()

    renderAt('/')

    expect(await screen.findByText('运动记录')).toBeTruthy()
    expect(screen.getByText('1 次')).toBeTruthy()
    expect(screen.getByText('1 条')).toBeTruthy()
    expect(screen.queryByText(/还没有任何记录/)).toBeNull()
  })
})

describe('新版本提示', () => {
  it('没有新版本时不显示', () => {
    render(<UpdatePrompt />)

    expect(screen.queryByText(/有新版本/)).toBeNull()
  })

  it('有新版本时提示用户，且不自动刷新', () => {
    setNeedRefreshForTest(true)

    render(<UpdatePrompt />)

    expect(screen.getByText('有新版本了。')).toBeTruthy()
    // 只显示提示，不去刷新：用户此刻可能正在填写内容
    expect(updateCallCount()).toBe(0)
  })

  it('用户点刷新才真正更新', () => {
    setNeedRefreshForTest(true)
    render(<UpdatePrompt />)

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))

    expect(updateCallCount()).toBe(1)
  })

  it('用户选择稍后则收起提示', () => {
    setNeedRefreshForTest(true)
    render(<UpdatePrompt />)

    fireEvent.click(screen.getByRole('button', { name: '稍后' }))

    expect(screen.queryByText('有新版本了。')).toBeNull()
    expect(updateCallCount()).toBe(0)
  })
})

describe('断网提示', () => {
  it('联网时不显示', async () => {
    const { ConnectionNotice } = await import('./ConnectionNotice.tsx')

    render(<ConnectionNotice />)

    expect(screen.queryByText(/当前没有网络/)).toBeNull()
  })

  it('断网时说明哪些功能仍可用', async () => {
    const { ConnectionNotice } = await import('./ConnectionNotice.tsx')
    const offline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    const spy = offline()
    render(<ConnectionNotice />)

    expect(screen.getByText(/训练与体重仍可记录/)).toBeTruthy()
    spy.mockRestore()
  })
})

describe('样式基线', () => {
  it('触达区域下限是 44px', () => {
    expect(indexCss).toContain('--tap-target-min: 44px')
  })

  it('按钮与导航格都按这个下限设定最小高度', () => {
    expect(indexCss).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--tap-target-min\)/)
    expect(indexCss).toMatch(/\.tabs__item\s*\{[^}]*min-height:/)
  })

  it('底部导航固定在视口底部并让出安全区', () => {
    expect(indexCss).toMatch(/\.tabs\s*\{[^}]*position:\s*fixed/)
    expect(indexCss).toContain('env(safe-area-inset-bottom)')
  })

  it('声明跟随系统深浅色，深色启动不闪白', () => {
    expect(indexCss).toContain('color-scheme: light dark')
  })

  it('文字与背景的前景色都有深浅两档，不会出现只有浅色的硬编码', () => {
    expect(indexCss).toContain('--fg: light-dark(')
    expect(indexCss).toContain('--bg: light-dark(')
    expect(indexCss).toContain('--fg-muted: light-dark(')
  })
})
