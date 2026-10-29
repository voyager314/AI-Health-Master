/**
 * entities —— 数据契约层
 *
 * 类型、枚举取值、字段规格与校验纯函数。零运行时依赖，不导入任何其他层。
 *
 * 为什么独立成层：domain/ 与 stats/ 的纯函数需要实体类型作为入参（约束 12），
 * 但它们禁止导入 storage/**。把契约放在 storage 里会让约束 12 无法成立。
 * 契约不是实现——任何层都可以导入本目录，本目录不导入任何层（由 ESLint 强制）。
 *
 * 允许导入：无
 * 可被导入：任何层
 */

export type { AuditFields, IsoUtc, StorageRef, UserId, Uuid } from './common.ts'

export {
  ISO_UTC,
  STORAGE_REF_PREFIX,
  UUID_V7,
  formatStorageRef,
  parseStorageRef,
} from './formats.ts'

export {
  ALL_STORE_NAMES,
  BUSINESS_STORE_NAMES,
  CONFIDENCE_LEVELS,
  EXERCISE_PATTERNS,
  EXPORTED_STORE_NAMES,
  INPUT_SOURCES,
  INTERNAL_STORE_NAMES,
  MEAL_ITEM_SOURCES,
  METRIC_TYPES,
  WORKOUT_STATUSES,
} from './records.ts'

export type {
  AnalyticsEvent,
  AnalyticsProps,
  AppMeta,
  BlobRecord,
  BodyMetric,
  BusinessRecord,
  BusinessRecordMap,
  BusinessStoreName,
  ConfidenceLevel,
  Exercise,
  ExercisePattern,
  ExportedStoreName,
  InputSource,
  InternalStoreName,
  Meal,
  MealItem,
  MealItemSource,
  MetricType,
  PendingOp,
  SetEntry,
  StoreName,
  Target,
  Workout,
  WorkoutExercise,
  WorkoutStatus,
} from './records.ts'

export { AUDIT_SPEC, RECORD_SPECS, validateRecord } from './validation.ts'
export type { FieldRule, FieldSpec, RecordSpec, ValidationIssue } from './validation.ts'
