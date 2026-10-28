/**
 * 任务 2.3 的验收：写入包装层的审计字段注入与落库校验。
 *
 * 覆盖约束 2（UUID v7 时间有序）、3（user_id 由存储层注入）、
 * 4（version）、5（软删除）、6（UTC + 独立时区偏移）。
 */
import { RECORD_SPECS, validateRecord } from '@/entities'
import {
  INITIAL_VERSION,
  LOCAL_USER_ID,
  RecordValidationError,
  assertValidRecord,
  createNow,
  withAuditForCreate,
  withAuditForRestore,
  withAuditForSoftDelete,
  withAuditForUpdate,
} from '@/storage/indexeddb/write.ts'
import { aBodyMetric, anExercise, fixedDate } from '@/test/fixtures.ts'
import { describe, expect, it } from 'vitest'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('主键（约束 2）', () => {
  it('是 UUID v7：版本位为 7', () => {
    const record = withAuditForCreate('exercise', anExercise(), createNow())
    expect(record.id).toMatch(UUID_V7)
    // 第 15 个字符（索引 14）是版本位
    expect(record.id[14]).toBe('7')
  })

  it('时间有序：先创建的记录字典序更小', () => {
    const ids = Array.from(
      { length: 20 },
      () => withAuditForCreate('exercise', anExercise(), createNow()).id,
    )
    expect([...ids].sort()).toEqual(ids)
  })

  it('client_id 与 id 同值（本期），作为上云后的幂等键', () => {
    const record = withAuditForCreate('exercise', anExercise(), createNow())
    expect(record.client_id).toBe(record.id)
  })

  it('两条记录的主键不重复', () => {
    const a = withAuditForCreate('exercise', anExercise(), createNow())
    const b = withAuditForCreate('exercise', anExercise(), createNow())
    expect(a.id).not.toBe(b.id)
  })
})

describe('审计字段注入（约束 3/4/5）', () => {
  it('未传 user_id 的载荷落库后 user_id 为 local', () => {
    const record = withAuditForCreate('exercise', anExercise(), createNow())
    expect(record.user_id).toBe(LOCAL_USER_ID)
    expect(record.user_id).toBe('local')
  })

  it('version 为 1、deleted_at 为 null、created_at 与 updated_at 相同', () => {
    const record = withAuditForCreate('exercise', anExercise(), createNow())
    expect(record.version).toBe(INITIAL_VERSION)
    expect(record.deleted_at).toBeNull()
    expect(record.created_at).toBe(record.updated_at)
  })

  it('注入结果符合字段规格', () => {
    const record = withAuditForCreate('exercise', anExercise(), createNow())
    expect(validateRecord(RECORD_SPECS.exercise, record)).toEqual([])
  })
})

describe('时间与时区（约束 6）', () => {
  it('时间字段是以 Z 结尾的 UTC ISO 8601', () => {
    const record = withAuditForCreate('exercise', anExercise(), createNow())
    expect(record.created_at).toMatch(/Z$/)
  })

  it('UTC+8 的设备写出 tz_offset_minutes = 480（与 getTimezoneOffset 符号相反）', () => {
    const now = createNow(() => fixedDate('2026-10-28T04:00:00.000Z', 480))
    const record = withAuditForCreate('body_metric', aBodyMetric(), now)

    expect(record.tz_offset_minutes).toBe(480)
    expect(record.created_at).toBe('2026-10-28T04:00:00.000Z')
  })

  it('西半球设备写出负偏移', () => {
    const now = createNow(() => fixedDate('2026-10-28T04:00:00.000Z', -300))
    const record = withAuditForCreate('body_metric', aBodyMetric(), now)
    expect(record.tz_offset_minutes).toBe(-300)
  })
})

describe('更新', () => {
  const base = withAuditForCreate('body_metric', aBodyMetric({ weight_kg: 72.4 }),
    createNow(() => fixedDate('2026-10-28T04:00:00.000Z', 480)),
  )
  const later = createNow(() => fixedDate('2026-10-29T04:00:00.000Z', -300))

  it('只刷新 updated_at，不动 created_at', () => {
    const updated = withAuditForUpdate(base, { weight_kg: 72.6 }, later)

    expect(updated.weight_kg).toBe(72.6)
    expect(updated.updated_at).toBe('2026-10-29T04:00:00.000Z')
    expect(updated.created_at).toBe(base.created_at)
  })

  it('身份字段不可变，patch 里带了也会被覆盖回原值', () => {
    const updated = withAuditForUpdate(
      base,
      {
        // 这些字段不在 UpdateInput 的类型里，模拟运行时被硬塞进来的情况
        id: 'hijacked',
        client_id: 'hijacked',
        user_id: 'someone-else',
        created_at: '2000-01-01T00:00:00.000Z',
        version: 99,
        deleted_at: '2000-01-01T00:00:00.000Z',
      } as never,
      later,
    )

    expect(updated.id).toBe(base.id)
    expect(updated.client_id).toBe(base.client_id)
    expect(updated.user_id).toBe(LOCAL_USER_ID)
    expect(updated.created_at).toBe(base.created_at)
    expect(updated.version).toBe(INITIAL_VERSION)
    expect(updated.deleted_at).toBeNull()
  })

  it('tz_offset_minutes 保留写入当时的值，不随编辑漂移', () => {
    // 用户跨时区旅行后编辑旧记录，这条记录的自然日/周归属不应该跟着变
    const updated = withAuditForUpdate(base, { weight_kg: 73 }, later)
    expect(updated.tz_offset_minutes).toBe(480)
  })
})

describe('软删除（约束 5）', () => {
  const base = withAuditForCreate('body_metric', aBodyMetric(), createNow())
  const at = createNow(() => fixedDate('2026-10-29T04:00:00.000Z', 480))

  it('写 deleted_at 与 updated_at，记录内容保留', () => {
    const removed = withAuditForSoftDelete(base, at)
    expect(removed.deleted_at).toBe('2026-10-29T04:00:00.000Z')
    expect(removed.updated_at).toBe('2026-10-29T04:00:00.000Z')
    expect(removed.weight_kg).toBe(base.weight_kg)
  })

  it('重复删除不改变首次的删除时刻', () => {
    const once = withAuditForSoftDelete(base, at)
    const twice = withAuditForSoftDelete(
      once,
      createNow(() => fixedDate('2026-11-01T04:00:00.000Z', 480)),
    )
    expect(twice.deleted_at).toBe('2026-10-29T04:00:00.000Z')
    expect(twice).toBe(once)
  })

  it('恢复把 deleted_at 清回 null', () => {
    const restored = withAuditForRestore(withAuditForSoftDelete(base, at), at)
    expect(restored.deleted_at).toBeNull()
  })
})

describe('落库校验', () => {
  it('合规记录通过', () => {
    const record = withAuditForCreate('exercise', anExercise(), createNow())
    expect(() => assertValidRecord('exercise', record)).not.toThrow()
  })

  it('UUID v4 主键被拒绝（约束 2 要求 v7）', () => {
    const record = {
      ...withAuditForCreate('exercise', anExercise(), createNow()),
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', // v4
    }
    const error = (() => {
      try {
        assertValidRecord('exercise', record)
      } catch (e) {
        return e
      }
    })()

    expect(error).toBeInstanceOf(RecordValidationError)
    expect((error as RecordValidationError).issues[0]?.field).toBe('id')
    expect((error as RecordValidationError).issues[0]?.message).toContain('v7')
  })

  it('带时区偏移的时间字符串被拒绝（约束 6 要求 UTC + 独立 offset）', () => {
    const record = {
      ...withAuditForCreate('body_metric', aBodyMetric(), createNow()),
      measured_at: '2026-10-28T12:00:00+08:00',
    }
    const issues = validateRecord(RECORD_SPECS.body_metric, record)
    expect(issues.map((i) => i.field)).toContain('measured_at')
  })

  it('未知字段被拒绝，不静默写入', () => {
    const record = {
      ...withAuditForCreate('body_metric', aBodyMetric(), createNow()),
      weightKg: 72.4, // 驼峰拼写，典型的手误
    }
    const issues = validateRecord(RECORD_SPECS.body_metric, record)
    expect(issues).toEqual([{ field: 'weightKg', message: '未知字段' }])
  })

  it('缺少必需字段被拒绝，且一次报出全部问题', () => {
    const issues = validateRecord(RECORD_SPECS.body_metric, { weight_kg: 72.4 })
    expect(issues.length).toBeGreaterThan(1)
    expect(issues.map((i) => i.field)).toContain('id')
    expect(issues.map((i) => i.field)).toContain('measured_at')
  })

  it('不允许为 null 的字段传 null 被拒绝', () => {
    const record = {
      ...withAuditForCreate('body_metric', aBodyMetric(), createNow()),
      weight_kg: null,
    }
    const issues = validateRecord(RECORD_SPECS.body_metric, record)
    expect(issues).toEqual([{ field: 'weight_kg', message: '不允许为 null' }])
  })
})
