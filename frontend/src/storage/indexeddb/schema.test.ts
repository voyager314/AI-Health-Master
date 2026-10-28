/**
 * 任务 2.1 的验收：12 个 store 的 schema 与索引。
 *
 * 断言打在**实际打开的数据库**上而不是 STORES 常量上——STORES 驱动建表、
 * AppDb 类型驱动类型推导，两份声明的漂移只有在真实建表后才看得出来。
 */
import { BUSINESS_STORE_NAMES, EXERCISE_PATTERNS, INTERNAL_STORE_NAMES, RECORD_SPECS, validateRecord } from '@/entities'
import { closeDatabase, openDatabase } from '@/storage/indexeddb/db.ts'
import { BUSINESS_STORES, STORES } from '@/storage/indexeddb/schema.ts'
import { anExercise, uniqueDbName } from '@/test/fixtures.ts'
import { withAuditForCreate, createNow } from '@/storage/indexeddb/write.ts'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => closeDatabase())

describe('store 结构', () => {
  it('建出 12 个 store：9 张业务表 + 3 个非业务 store', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('schema') })
    const actual = [...db.objectStoreNames].sort()

    expect(actual).toEqual(
      [...BUSINESS_STORE_NAMES, ...INTERNAL_STORE_NAMES].sort(),
    )
    expect(actual).toHaveLength(12)
    db.close()
  })

  it('9 张业务表每张都有 user_id 索引（约束 3）', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('userid-index') })
    const tx = db.transaction([...BUSINESS_STORE_NAMES], 'readonly')

    for (const name of BUSINESS_STORE_NAMES) {
      const indexNames = [...tx.objectStore(name).indexNames]
      expect(indexNames, `${name} 缺少 user_id 索引`).toContain('user_id')
    }

    expect(BUSINESS_STORES).toHaveLength(9)
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

  it('不给布尔字段建索引——布尔不是合法的 IndexedDB key', () => {
    const booleanFields = ['is_custom', 'is_warmup']
    for (const store of STORES) {
      for (const index of store.indexes) {
        expect(booleanFields).not.toContain(index)
      }
    }
  })
})

describe('动作模式枚举', () => {
  it('恰好 9 类，含「孤立」、不含「负重行走」', () => {
    expect(EXERCISE_PATTERNS).toHaveLength(9)
    expect(EXERCISE_PATTERNS).toContain('isolation')
    expect(EXERCISE_PATTERNS).not.toContain('loaded_carry')
  })

  it('非法的 pattern 取值被校验拒绝', () => {
    const now = createNow()

    const legal = withAuditForCreate('exercise', anExercise({ pattern: 'isolation' }), now)
    expect(validateRecord(RECORD_SPECS.exercise, legal)).toEqual([])

    // 负重行走已从枚举中移除，写进来必须被拒
    const illegal = { ...legal, pattern: 'loaded_carry' }
    const issues = validateRecord(RECORD_SPECS.exercise, illegal)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.field).toBe('pattern')
    expect(issues[0]?.message).toContain('isolation')
  })

  it('写进真实数据库的记录能按 pattern 索引取回', async () => {
    const db = await openDatabase({ dbName: uniqueDbName('pattern-query') })
    const record = withAuditForCreate('exercise', anExercise({ pattern: 'squat' }), createNow())
    await db.put('exercise', record)

    const found = await db.getAllFromIndex('exercise', 'pattern', 'squat')
    expect(found).toHaveLength(1)
    expect(found[0]?.name).toBe('杠铃卧推')
    db.close()
  })
})
