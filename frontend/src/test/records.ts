/**
 * 已经带齐审计字段的示例记录。
 *
 * 供需要「一条完整记录」的测试使用，例如导入校验——那里要断言字段级拒绝，
 * 输入必须是真实形状而不是随手拼的对象。放在 test 层而不是各业务层里，
 * 是为了让领域层与统计层的测试保持零存储依赖。
 */
import type {
  BodyMetric,
  BusinessRecordMap,
  BusinessStoreName,
  Exercise,
} from '@/entities'
import {
  createNow,
  withAuditForCreate,
  type CreateInput,
  type Now,
} from '@/storage/indexeddb/write.ts'
import { aBodyMetric, anExercise, fixedDate } from './fixtures.ts'

const AT = '2026-10-29T02:00:00.000Z'

/** 一条合法的动作记录，时刻固定，便于断言 */
export const sampleExercise: Exercise = withAuditForCreate(
  'exercise',
  anExercise(),
  createNow(() => fixedDate(AT, 480)),
)

/** 一条合法的体重记录，时刻固定，便于断言 */
export const sampleWeight: BodyMetric = withAuditForCreate(
  'body_metric',
  aBodyMetric(),
  createNow(() => fixedDate(AT, 480)),
)

/**
 * 按 store 名构造一条带齐审计字段的记录。
 *
 * 测试需要大量自定义字段值的记录，逐个写成常量不现实。本函数只做转出，
 * 让业务层的测试不必直接够到数据库实现——那是分层边界禁止的方向。
 */
export function makeRecord<N extends BusinessStoreName>(
  store: N,
  input: CreateInput<BusinessRecordMap[N]>,
  moment: Now,
): BusinessRecordMap[N] {
  return withAuditForCreate(store, input, moment)
}

/** 构造一个时刻，语义同 `createNow`，但入参显式 */
export function momentAt(iso: string, tzOffsetMinutes: number): Now {
  return createNow(() => fixedDate(iso, tzOffsetMinutes))
}
