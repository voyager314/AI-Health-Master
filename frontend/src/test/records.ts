/**
 * 已经带齐审计字段的示例记录。
 *
 * 供需要「一条完整记录」的测试使用，例如导入校验——那里要断言字段级拒绝，
 * 输入必须是真实形状而不是随手拼的对象。放在 test 层而不是各业务层里，
 * 是为了让领域层与统计层的测试保持零存储依赖。
 */
import type { BodyMetric, Exercise } from '@/entities'
import { createNow, withAuditForCreate } from '@/storage/indexeddb/write.ts'
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
