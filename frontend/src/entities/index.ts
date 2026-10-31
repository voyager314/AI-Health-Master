/**
 * entities —— 数据契约层
 *
 * 类型、枚举取值、字段规格与校验纯函数。零运行时依赖，不导入任何其他层。
 *
 * 为什么独立成层：domain/ 与 stats/ 的纯函数需要实体类型作为入参，但它们禁止
 * 导入 storage/**。契约若定义在 storage 里，这两个目录要么违规导入存储层，
 * 要么只能自己复制一份类型，两种结果都会让契约与实现脱节。
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
  EXPORTED_STORE_NAMES,
  INPUT_SOURCES,
  INTERNAL_STORE_NAMES,
  MEAL_ITEM_SOURCES,
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
  ExportedStoreName,
  InputSource,
  InternalStoreName,
  Meal,
  MealItem,
  MealItemSource,
  PendingOp,
  StoreName,
  Target,
  WorkoutItem,
  WorkoutLog,
} from './records.ts'

export {
  AUDIT_SPEC,
  BODY_WEIGHT_MAX_KG,
  BODY_WEIGHT_MIN_KG,
  ITEM_NAME_MAX_LENGTH,
  ITEM_NOTE_MAX_LENGTH,
  RECORD_SPECS,
  isBodyWeightOnGrid,
  validateRecord,
  validateWorkoutItems,
} from './validation.ts'
export type { FieldRule, FieldSpec, RecordSpec, ValidationIssue } from './validation.ts'
