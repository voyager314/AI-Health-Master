/**
 * 数据库建表结果：9 个 store 与各自的索引。
 *
 * 断言打在**实际打开的数据库**上而不是 STORES 常量上——STORES 驱动建表、
 * AppDb 类型驱动类型推导，两份声明的漂移只有在真实建表后才看得出来。
 */
import {
  BUSINESS_STORE_NAMES,
  INTERNAL_STORE_NAMES,
  RECORD_SPECS,
  validateRecord,
} from '@/entities'
import { closeDatabase, openDatabase } from '@/storage/indexeddb/db.ts'
import { BUSINESS_STORES, STORES } from '@/storage/indexeddb/schema.ts'
import { aWorkoutLog, uniqueDbName } from '@/test/fixtures.ts'
import { createNow, withAuditForCreate } from '@/storage/indexeddb/write.ts'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => closeDatabase())

describe('store 结构', () => {
  it('建出 9 个 store：6 张业务表 + 3 个非业务 store', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('schema') })
    const actual = [...db.objectStoreNames].sort()

    expect(actual).toEqual([...BUSINESS_STORE_NAMES, ...INTERNAL_STORE_NAMES].sort())
    expect(actual).toHaveLength(9)
    db.close()
  })

  it('不存在旧模型的四张运动表', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('legacy-tables') })

    for (const name of ['exercise', 'workout', 'workout_exercise', 'set_entry']) {
      expect([...db.objectStoreNames], `${name} 不该存在`).not.toContain(name)
    }
    db.close()
  })

  it('6 张业务表每张都有 user_id 索引，user_id 由存储层统一注入', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('userid-index') })
    const tx = db.transaction([...BUSINESS_STORE_NAMES], 'readonly')

    for (const name of BUSINESS_STORE_NAMES) {
      const indexNames = [...tx.objectStore(name).indexNames]
      expect(indexNames, `${name} 缺少 user_id 索引`).toContain('user_id')
    }

    expect(BUSINESS_STORES).toHaveLength(6)
    db.close()
  })

  it('每个声明的索引都真的建出来了，主键一律是 id', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('all-index') })

    for (const store of STORES) {
      const os = db.transaction(store.name, 'readonly').objectStore(store.name)
      expect(os.keyPath, `${store.name} 的主键应为 id`).toBe('id')
      for (const index of store.indexes) {
        expect([...os.indexNames], `${store.name} 缺少索引 ${index}`).toContain(index)
      }
    }
    db.close()
  })

  it('运动记录只有 logged_at 与 user_id 两个索引', () => {
    const workoutLog = STORES.find((s) => s.name === 'workout_log')
    expect([...workoutLog!.indexes].sort()).toEqual(['logged_at', 'user_id'])
  })
})

describe('运动记录的项目卡片', () => {
  it('只填项目名的卡片通过校验', () => {
    const record = withAuditForCreate(
      'workout_log',
      aWorkoutLog({
        items: [{ name: '卧推', sets: null, reps: null, weight_kg: null, note: null }],
      }),
      createNow(),
    )

    expect(validateRecord(RECORD_SPECS.workout_log, record)).toEqual([])
  })

  it('体重不在 0.5 网格上被拒绝', () => {
    const record = withAuditForCreate(
      'workout_log',
      aWorkoutLog({
        items: [{ name: '卧推', sets: 4, reps: 8, weight_kg: 80.3, note: null }],
      }),
      createNow(),
    )

    const issues = validateRecord(RECORD_SPECS.workout_log, record)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.field).toBe('items[0].weight_kg')
    expect(issues[0]?.message).toContain('0.5')
  })

  it('空卡片列表被拒绝', () => {
    const record = withAuditForCreate('workout_log', aWorkoutLog({ items: [] }), createNow())
    const issues = validateRecord(RECORD_SPECS.workout_log, record)

    expect(issues).toEqual([{ field: 'items', message: '至少需要一张项目卡片' }])
  })

  it('卡片上的未知字段被拒绝', () => {
    const record = withAuditForCreate(
      'workout_log',
      aWorkoutLog({
        items: [
          { name: '卧推', sets: 4, reps: 8, weight_kg: 80, note: null, rpe: 8 } as never,
        ],
      }),
      createNow(),
    )

    const issues = validateRecord(RECORD_SPECS.workout_log, record)
    expect(issues).toEqual([{ field: 'items[0].rpe', message: '未知字段' }])
  })

  it('项目名超过 40 字被拒绝', () => {
    const record = withAuditForCreate(
      'workout_log',
      aWorkoutLog({
        items: [{ name: '推'.repeat(41), sets: null, reps: null, weight_kg: null, note: null }],
      }),
      createNow(),
    )

    const issues = validateRecord(RECORD_SPECS.workout_log, record)
    expect(issues[0]?.field).toBe('items[0].name')
  })

  it('同一记录内项目名可重复', () => {
    const card = { name: '卧推', sets: 4, reps: 8, weight_kg: 80, note: null }
    const record = withAuditForCreate(
      'workout_log',
      aWorkoutLog({ items: [card, { ...card }] }),
      createNow(),
    )

    expect(validateRecord(RECORD_SPECS.workout_log, record)).toEqual([])
  })

  it('写进真实数据库的记录能按 logged_at 索引取回', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('logged-at-query') })
    const record = withAuditForCreate(
      'workout_log',
      aWorkoutLog({ logged_at: '2026-10-30T12:34:56.000Z' }),
      createNow(),
    )
    await db.put('workout_log', record)

    const found = await db.getAllFromIndex('workout_log', 'logged_at', '2026-10-30T12:34:56.000Z')
    expect(found).toHaveLength(1)
    expect(found[0]?.items[0]?.name).toBe('杠铃卧推')
    db.close()
  })
})
