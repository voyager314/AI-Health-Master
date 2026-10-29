/**
 * 12 个 store 的记录类型与枚举取值。
 *
 * 9 张业务表（带 AuditFields）+ 3 个非业务 store（pending_ops / blob / analytics_event）。
 * 审计字段的契约定义在 common.ts 的 `AuditFields`。
 */
import type { AuditFields, IsoUtc, StorageRef, UserId, Uuid } from './common.ts'

// ── 枚举取值 ────────────────────────────────────────────────────────────────

/**
 * 动作模式，共 9 类。
 *
 * 只砍掉负重行走，保留孤立动作：增肌主用户群离不开弯举/侧平举/飞鸟/臂屈伸，
 * 语音录入「飞鸟20公斤12个3组」这类句子正是要靠孤立类别才能归类。
 */
export const EXERCISE_PATTERNS = [
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'squat',
  'hip_hinge',
  'single_leg',
  'core',
  'isolation',
] as const
export type ExercisePattern = (typeof EXERCISE_PATTERNS)[number]

/** 计量方式：负重类按重量×次数，计时类按秒。两种计量各有自己的字段，不复用重量字段表达时长 */
export const METRIC_TYPES = ['weight', 'timed'] as const
export type MetricType = (typeof METRIC_TYPES)[number]

/** 组记录的录入来源，用于统计语音记录占比 */
export const INPUT_SOURCES = ['manual', 'voice'] as const
export type InputSource = (typeof INPUT_SOURCES)[number]

/**
 * 训练单的持久化状态。
 *
 * 训练单在界面上有「未开始、进行中、已保存、已删除」四态，但只有 2 态需要落库：
 * 「未开始」时还没有记录，「已删除」由 `deleted_at` 表达，记录本身仍保留。
 */
export const WORKOUT_STATUSES = ['in_progress', 'saved'] as const
export type WorkoutStatus = (typeof WORKOUT_STATUSES)[number]

/** 估算值的置信度。营养数值本质是估算，界面必须据此标注，不能当作精确值展示 */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/** 饮食条目的数据来源：AI 识别 / 手动录入 / AI 识别后被用户编辑 */
export const MEAL_ITEM_SOURCES = ['ai', 'manual', 'edit'] as const
export type MealItemSource = (typeof MEAL_ITEM_SOURCES)[number]

// ── 9 张业务表 ──────────────────────────────────────────────────────────────

export interface Exercise extends AuditFields {
  name: string
  pattern: ExercisePattern
  primary_muscle: string
  metric_type: MetricType
  /** 用户自建动作。自建占比超过 20% 说明内置动作库未覆盖常用动作，应优先扩充内置库 */
  is_custom: boolean
}

export interface Workout extends AuditFields {
  started_at: IsoUtc
  /** 训练结束时刻，进行中为 `null` */
  ended_at: IsoUtc | null
  template_id: Uuid | null
  note: string | null
  status: WorkoutStatus
}

export interface WorkoutExercise extends AuditFields {
  workout_id: Uuid
  exercise_id: Uuid
  /** 动作在训练单中的顺序，从 0 起 */
  order_index: number
}

export interface SetEntry extends AuditFields {
  workout_exercise_id: Uuid
  /** 负重类必填、计时类为 `null`。支持 0.5 步进 */
  weight_kg: number | null
  /** 负重类必填、计时类为 `null` */
  reps: number | null
  /** 计时类必填、负重类为 `null`。时长不复用重量字段表达 */
  duration_sec: number | null
  /** 主观用力程度 1-10，可选 */
  rpe: number | null
  /** 热身组不计入训练容量（术语表：tonnage 仅统计非热身组） */
  is_warmup: boolean
  input_source: InputSource
  /** 语音录入时模型对本组的置信度，手动录入为 `null` */
  confidence: ConfidenceLevel | null
}

export interface BodyMetric extends AuditFields {
  measured_at: IsoUtc
  /** 统一以 kg 存储。界面可切换为斤，只影响显示，不改存储值 */
  weight_kg: number
  note: string | null
}

export interface Meal extends AuditFields {
  eaten_at: IsoUtc
  note: string | null
  /** `local://<uuid>`，二进制在 blob store，本字段只存引用 */
  photo_ref: StorageRef | null
  total_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
  ai_confidence: ConfidenceLevel | null
}

export interface MealItem extends AuditFields {
  meal_id: Uuid
  name: string
  net_weight_g: number | null
  /** 实际摄入占净含量的比例，0-1。界面以 10% 步进的滑杆呈现 */
  ratio: number
  kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
  source: MealItemSource
}

export interface Target extends AuditFields {
  /** 蛋白目标系数，g/kg 体重。增肌期的经验区间为 1.6-2.2 */
  protein_per_kg: number
  /** 相对维持热量的日盈余，kcal。增肌期经验区间 +200~+300 */
  kcal_delta: number
  /** 月度目标增速，kg。默认 +0.3，可选 +0.2~+0.5 */
  weight_gain_per_month: number
  weekly_workout_target: number
  effective_from: IsoUtc
}

/**
 * 单行记录，承载与具体业务无关的应用状态。
 *
 * 不持有 schema 版本：数据库自身的 version 是唯一权威，导出文件在信封顶层另行
 * 携带它。两处各存一份的话，导入时按信封决定迁移、又把记录原样写回，两者就能
 * 不一致，而不一致的那一份没人知道该信谁。
 */
export interface AppMeta extends AuditFields {
  /** 告知同意的时刻。为 `null` 表示尚未同意，此时不得进入任何业务功能 */
  consent_at: IsoUtc | null
  /** 最近一次导出完成的时刻。为 `null` 表示从未导出，用于提醒用户定期导出 */
  last_export_at: IsoUtc | null
}

// ── 3 个非业务 store（不适用 AuditFields 契约）────────────────────────────

/**
 * 写入日志。每次 applyCommand 在同一事务内追加一条。
 *
 * 本期用于调试与校验，上云后直接作为离线队列的载体，因此**不参与导出**——
 * 它是操作历史而非数据状态，重放它会把已经发生的写入再做一遍。
 */
export interface PendingOp {
  id: Uuid
  command_type: string
  payload: unknown
  applied_at: IsoUtc
  tz_offset_minutes: number
}

/**
 * 图片二进制。
 *
 * 这是全项目唯一允许物理删除的 store：图片是大二进制，软删除不释放配额，
 * 留下一个指向已删图片的引用反而制造出需要三态解析才能处理的悬空引用。
 */
export interface BlobRecord {
  id: Uuid
  mime: string
  bytes: Blob
  byte_size: number
  created_at: IsoUtc
}

/** 埋点属性只允许结构化值与区间值，禁止自由文本、图片与身份信息 */
export type AnalyticsProps = Readonly<Record<string, string | number | boolean | null>>

export interface AnalyticsEvent {
  id: Uuid
  name: string
  occurred_at: IsoUtc
  tz_offset_minutes: number
  props: AnalyticsProps
  /** 埋点与业务记录同样按用户隔离，便于上云后分用户统计 */
  user_id: UserId
}

// ── store 名称 ──────────────────────────────────────────────────────────────

/**
 * 9 张业务表。
 *
 * 「每条记录都带 user_id 与 version」这条契约的口径就是这 9 张，不含下面
 * 3 个非业务 store——它们不持有审计字段，也就不参与用户隔离与版本控制。
 */
export const BUSINESS_STORE_NAMES = [
  'exercise',
  'workout',
  'workout_exercise',
  'set_entry',
  'body_metric',
  'meal',
  'meal_item',
  'target',
  'app_meta',
] as const
export type BusinessStoreName = (typeof BUSINESS_STORE_NAMES)[number]

export const INTERNAL_STORE_NAMES = ['pending_ops', 'blob', 'analytics_event'] as const
export type InternalStoreName = (typeof INTERNAL_STORE_NAMES)[number]

export const ALL_STORE_NAMES = [...BUSINESS_STORE_NAMES, ...INTERNAL_STORE_NAMES] as const

export type StoreName = BusinessStoreName | InternalStoreName

/**
 * 进入导出文件的表：9 张业务表加埋点事件。
 *
 * 写操作日志与图片二进制不在其中。前者是操作历史，重放它会把已经发生的写入再做
 * 一遍；后者是二进制，混进纯数据文件会让文件大到无法传输。
 *
 * 导入只接受这 10 张表——文件里出现别的表名说明文件被改过或来自不兼容的版本，
 * 与其猜测意图，不如拒绝。
 */
export const EXPORTED_STORE_NAMES = [
  ...BUSINESS_STORE_NAMES,
  'analytics_event',
] as const
export type ExportedStoreName = (typeof EXPORTED_STORE_NAMES)[number]

/** store 名 → 记录类型的映射，供 Repository 做类型推导 */
export interface BusinessRecordMap {
  exercise: Exercise
  workout: Workout
  workout_exercise: WorkoutExercise
  set_entry: SetEntry
  body_metric: BodyMetric
  meal: Meal
  meal_item: MealItem
  target: Target
  app_meta: AppMeta
}

/** 9 张业务表记录的联合类型 */
export type BusinessRecord = BusinessRecordMap[BusinessStoreName]
