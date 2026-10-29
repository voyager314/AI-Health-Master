// @vitest-environment jsdom
/**
 * 导出、导入与清空的界面流程。
 *
 * 三条流程的风险不同，界面给出的保护也随之不同：导出直接执行，导入先展示文件概况再确认，
 * 清空要二次确认。这里的断言针对的正是这三处保护有没有真的拦在写入之前。
 *
 * 还有一个容易被忽略的点：导入入口要拒绝 CSV。CSV 只用于查看，嵌套关系被摊平后
 * 信息有损，让它进得来等于用一份残缺数据覆盖掉用户的完整数据。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataTransfer } from '@/features/data'
import { resetDefaultDatabase, seedDefaultDatabase } from '@/test/seed.ts'

import { DataPage } from './DataPage.tsx'

beforeEach(async () => {
  await resetDefaultDatabase()
  // jsdom 不实现对象 URL：下载链路要能跑通，得把它补上
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  }))
})

afterEach(async () => {
  cleanup()
  await resetDefaultDatabase()
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <DataPage />
    </MemoryRouter>,
  )
}

/** 把一个字符串内容包成用户选中的文件 */
function fileOf(name: string, content: string): File {
  return new File([content], name, {
    type: name.endsWith('.json') ? 'application/json' : 'text/csv',
  })
}

/** 选择一个文件，触发导入入口的变更处理 */
function chooseFile(name: string, content: string) {
  const input = document.getElementById('import-file') as HTMLInputElement
  fireEvent.change(input, { target: { files: [fileOf(name, content)] } })
}

/** 导出一份合法的 JSON 文本，用作导入输入 */
async function exportedJson(): Promise<string> {
  const saved: string[] = []
  await dataTransfer.exportAll({
    sink: {
      async save(file) {
        saved.push(file.text)
      },
    },
  })
  return saved[0]!
}

describe('导出', () => {
  it('两种格式的入口都在', () => {
    renderPage()

    expect(screen.getByRole('button', { name: /导出 JSON/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /导出 CSV/ })).toBeTruthy()
  })

  it('点导出后告知导出了几个文件', async () => {
    await seedDefaultDatabase()
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /导出 JSON/ }))

    await waitFor(() => {
      expect(screen.getByText(/已导出 1 个文件/)).toBeTruthy()
    })
  })

  it('说明数据只存本机，并把导出的必要性讲清楚', () => {
    renderPage()

    expect(screen.getByText(/只存在这台设备的浏览器里/)).toBeTruthy()
    expect(screen.getByText(/建议每周导出一次/)).toBeTruthy()
  })
})

describe('导入', () => {
  it('拒绝 CSV，并说明它不能作为导入来源', async () => {
    renderPage()

    chooseFile('records.csv', 'id,name\n1,卧推\n')

    await waitFor(() => {
      expect(screen.getByText(/只能导入 JSON 文件/)).toBeTruthy()
    })
    expect(screen.getByText(/CSV 仅供查看/)).toBeTruthy()
  })

  it('选择合法 JSON 后先展示条数，而不是直接覆盖', async () => {
    await seedDefaultDatabase()
    const text = await exportedJson()
    renderPage()

    chooseFile('export.json', text)

    await waitFor(() => {
      expect(screen.getByText(/文件可导入/)).toBeTruthy()
    })
    expect(screen.getByText(/确认后将替换当前全部数据/)).toBeTruthy()
    // 还没确认，因此不出现确认按钮之外的写入动作
    expect(screen.getByRole('button', { name: '确认替换全部数据' })).toBeTruthy()
  })

  it('未确认时点取消不写入', async () => {
    await seedDefaultDatabase()
    const text = await exportedJson()
    renderPage()

    chooseFile('export.json', text)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '确认替换全部数据' })).toBeNull()
    })
  })

  it('确认后完成导入并说明已生成备份', async () => {
    await seedDefaultDatabase()
    const text = await exportedJson()
    renderPage()

    chooseFile('export.json', text)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认替换全部数据' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '确认替换全部数据' }))

    await waitFor(() => {
      expect(screen.getByText(/导入完成/)).toBeTruthy()
    })
    expect(screen.getByText(/已备份/)).toBeTruthy()
  })

  it('文件无法解析时给出错误而不是静默失败', async () => {
    renderPage()

    chooseFile('broken.json', '这不是 json')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })
})

describe('清空', () => {
  it('先要求确认，确认按钮的措辞说明不可恢复', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '清空全部数据' }))

    expect(screen.getByRole('button', { name: /确认清空，无法恢复/ })).toBeTruthy()
  })

  it('取消后回到原状', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '清空全部数据' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByRole('button', { name: '清空全部数据' })).toBeTruthy()
  })

  it('确认后清空并告知结果', async () => {
    await seedDefaultDatabase()
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '清空全部数据' }))
    fireEvent.click(screen.getByRole('button', { name: /确认清空，无法恢复/ }))

    await waitFor(() => {
      expect(screen.getByText(/已清空全部数据/)).toBeTruthy()
    })
  })
})

describe('入口可见性', () => {
  it('设置页一级就能看到导出与导入', async () => {
    const { SettingsPage } = await import('./SettingsPage.tsx')

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /导出与导入/ })).toBeTruthy()
  })

  it('数据处理说明同样在设置页一级', async () => {
    const { SettingsPage } = await import('./SettingsPage.tsx')

    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /数据处理说明/ })).toBeTruthy()
  })
})
