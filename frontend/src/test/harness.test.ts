/**
 * 测试基础设施自检。
 *
 * 这条测试不验证业务逻辑，只确认测试环境本身是可用的：vitest 能跑，
 * 且 fake-indexeddb 已按 setup 装好。数据层的测试全部依赖后者，
 * 它没装上时失败信息会很难懂，所以单独立一条断言把问题挡在这里。
 */
import { describe, expect, it } from 'vitest'

describe('测试环境', () => {
  it('vitest 可运行', () => {
    expect(1 + 1).toBe(2)
  })

  it('fake-indexeddb 已装为全局，可打开并关闭数据库', async () => {
    expect(typeof globalThis.indexedDB).toBe('object')
    expect(typeof globalThis.IDBKeyRange).toBe('function')

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = globalThis.indexedDB.open('harness-check', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('probe')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    expect(db.objectStoreNames.contains('probe')).toBe(true)
    db.close()
  })

  // tsconfig 的 paths 与 vite 的 resolve.alias 是两份独立声明，漏改一处就会出现
  // 「类型检查过了但运行时找不到模块」。这条测试同时经过两条链路（tsc 检查这个
  // 动态 import 的字面量，vitest 在运行时真的解析它），任一处失配就会失败。
  it('`@/` 路径别名在类型检查与运行时都可解析', async () => {
    const mod = await import('@/entities')
    expect(mod).toBeDefined()
  })
})
