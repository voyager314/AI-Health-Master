/**
 * 导出完成时刻的落库验证。
 *
 * 这个时刻唯一的用途是提醒用户「你多久没导出了」，因此它必须只在导出真正完成
 * 之后写入，且重复导出要覆盖而不是累积记录——`app_meta` 是全局状态，不是事件流。
 */
import { createCommandBus } from '@/commands'
import { COMMANDS } from '@/commands/index.ts'
import { createTestDb, type TestDb } from '@/test/db.ts'
import { fixedDate } from '@/test/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const AT = '2026-10-29T02:15:30.000Z'

let testDb: TestDb

beforeEach(async () => {
  testDb = await createTestDb('mark-exported')
})

afterEach(() => testDb.close())

function bus(clockIso = AT) {
  return createCommandBus({
    definitions: COMMANDS,
    repos: testDb.repos,
    getDb: testDb.getDb,
    clock: () => fixedDate(clockIso, 480),
  })
}

describe('记录导出时刻', () => {
  it('首次导出写入时刻', async () => {
    await bus().apply('app_meta/mark_exported')

    const [meta] = await testDb.repos.app_meta.list()
    expect(meta?.last_export_at).toBe(AT)
  })

  it('首次写入时同意状态为空，不伪造一个同意时刻', async () => {
    await bus().apply('app_meta/mark_exported')

    const [meta] = await testDb.repos.app_meta.list()
    expect(meta?.consent_at).toBeNull()
  })

  it('重复导出覆盖时刻，不产生第二行', async () => {
    await bus('2026-10-29T02:15:30.000Z').apply('app_meta/mark_exported')
    await bus('2026-11-05T02:15:30.000Z').apply('app_meta/mark_exported')

    const all = await testDb.repos.app_meta.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.last_export_at).toBe('2026-11-05T02:15:30.000Z')
  })

  it('重复导出不改动创建时刻', async () => {
    await bus('2026-10-29T02:15:30.000Z').apply('app_meta/mark_exported')
    const [first] = await testDb.repos.app_meta.list()

    await bus('2026-11-05T02:15:30.000Z').apply('app_meta/mark_exported')
    const [second] = await testDb.repos.app_meta.list()

    expect(second?.created_at).toBe(first?.created_at)
    expect(second?.updated_at).toBe('2026-11-05T02:15:30.000Z')
  })

  it('既有记录上的同意时刻不被导出操作抹掉', async () => {
    const consent = await testDb.repos.app_meta.list()
    expect(consent).toEqual([])

    // 先放一条已同意的记录，再记录导出时刻
    const { withAuditForCreate } = await import('@/storage/internal')
    await testDb.repos.app_meta.put(
      withAuditForCreate(
        'app_meta',
        { consent_at: '2026-10-01T00:00:00.000Z', last_export_at: null },
        { iso: '2026-10-01T00:00:00.000Z', tzOffsetMinutes: 480 },
      ),
    )

    await bus().apply('app_meta/mark_exported')

    const [meta] = await testDb.repos.app_meta.list()
    expect(meta?.consent_at).toBe('2026-10-01T00:00:00.000Z')
    expect(meta?.last_export_at).toBe(AT)
  })

  it('每次导出记一条写操作日志', async () => {
    await bus().apply('app_meta/mark_exported')
    await bus().apply('app_meta/mark_exported')

    const ops = await testDb.db.getAll('pending_ops')
    expect(ops).toHaveLength(2)
    expect(ops[0]?.command_type).toBe('app_meta/mark_exported')
  })
})
