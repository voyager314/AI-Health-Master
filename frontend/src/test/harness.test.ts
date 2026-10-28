/**
 * 测试基础设施自检。
 *
 * 这个文件不验证业务逻辑，只确认测试环境本身可用：vitest 能跑、路径别名能解析、
 * fake-indexeddb 已按 setup 装好。数据层的全部测试都依赖这三件事，
 * 它们坏掉时的报错往往很难懂，所以单独立几条断言把问题挡在这里。
 */
import { closeDatabase, openDatabase } from '@/storage/indexeddb/db.ts'
import { uniqueDbName } from '@/test/fixtures.ts'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => closeDatabase())

describe('测试环境', () => {
  it('vitest 可运行', () => {
    expect(1 + 1).toBe(2)
  })

  // 不直接探测 globalThis.indexedDB：那样写会绕过约束 1 的边界检查（ESLint 挡的就是
  // globalThis.indexedDB 这种成员表达式）。改为走存储层自己的 API——fake-indexeddb
  // 没装上时这里一样会失败，而且失败路径与真实代码路径一致。
  it('fake-indexeddb 已装好：能经存储层打开数据库', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('harness') })
    expect(db.version).toBeGreaterThan(0)
    expect(db.objectStoreNames.length).toBeGreaterThan(0)
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
