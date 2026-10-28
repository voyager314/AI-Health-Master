/**
 * 12 个 store 的记录类型与枚举取值。
 *
 * 9 张业务表（带 AuditFields）+ 3 个非业务 store（pending_ops / blob / analytics_event）。
 * 字段来自 PRD §10.1，审计字段契约见 common.ts。
 */
import type { AuditFields, IsoUtc, StorageRef, UserId, Uuid } from './common.ts'

// ── 枚举取值 ────────────────────────────────────────────────────────────────

/**
 * 动作模式，共 9 类。
 *
 * PRD §三 原写「只保留前 8 类」（即砍掉负重行走与孤立），但 FR-T04 的验收例子
 * 「飞鸟20公斤12个3组」用的正是孤立动作，与之自相矛盾；且增肌主用户群离不开
 * 弯举/侧平举/飞鸟/臂屈伸。评审拍板：保留孤立，只砍负重行走。
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

/** 计量方式：负重类按重量×次数，计时类按秒（PRD §12-13 禁止复用重量字段） */
export const METRIC_TYPES = ['weight', 'timed'] as const
export type MetricType = (typeof METRIC_TYPES)[number]

/** 组记录的录入来源，用于统计语音记录占比（PRD §2.3） */
export const INPUT_SOURCES = ['manual', 'voice'] as const
export type InputSource = (typeof INPUT_SOURCES)[number]

/**
 * 训练单的持久化状态。
 *
 * PRD §9.1 的状态机有 4 态，但只有 2 态需要落库：「未开始」时还没有记录，
 * 「已删除」由 `deleted_at` 表达（约束 5 的软删除）。
 */
export const WORKOUT_STATUSES = ['in_progress', 'saved'] as const
export type WorkoutStatus = (typeof WORKOUT_STATUSES)[number]

/** 估算值的置信度。营养数值本质是估算，界面必须据此标注（PRD §7.3 FR-D02） */
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
  /** 用户自建动作。自建占比超过 20% 时优先扩充内置动作库（PRD OP-03） */
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
  /** 负重类必填、计时类为 `null`。支持 0.5 步进（FR-T03） */
  weight_kg: number | null
  /** 负重类必填、计时类为 `null` */
  reps: number | null
  /** 计时类必填、负重类为 `null`（PRD §12-13） */
  duration_sec: number | null
  /** 主观用力程度 1-10，可选（FR-T03） */
  rpe: number | null
  /** 热身组不计入训练容量（术语表：tonnage 仅统计非热身组） */
  is_warmup: boolean
  input_source: InputSource
  /** 语音录入时模型对本组的置信度，手动录入为 `null` */
  confidence: ConfidenceLevel | null
}

export interface BodyMetric extends AuditFields {
  measured_at: IsoUtc
  /** 统一以 kg 存储。界面可切换为斤，只影响显示（FR-W01） */
  weight_kg: number
  note: string | null
}

export interface Meal extends AuditFields {
  eaten_at: IsoUtc
  note: string | null
  /** `local://<uuid>`，二进制在 blob store（约束 7） */
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
  /** 实际摄入占净含量的比例，0-1。界面以 10% 步进的滑杆呈现（FR-D04） */
  ratio: number
  kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
  source: MealItemSource
}

export interface Target extends AuditFields {
  /** 蛋白目标系数，g/kg 体重。PRD §15.5 的经验区间为 1.6-2.2 */
  protein_per_kg: number
  /** 相对维持热量的日盈余，kcal。增肌期经验区间 +200~+300 */
  kcal_delta: number
  /** 月度目标增速，kg。默认 +0.3，可选 +0.2~+0.5（FR-W03） */
  weight_gain_per_month: number
  weekly_workout_target: number
  effective_from: IsoUtc
}

export interface AppMeta extends AuditFields {
  /**
   * 本地库的 schema 版本。
   *
   * 权威来源是 IndexedDB 数据库自身的 version，本字段是它的镜像：
   * 导出文件需要带 schema_version（约束 11），而迁移运行器是本字段的唯一写入者。
   * 启动时会校验两者一致，不一致则以数据库 version 为准自愈。
   */
  schema_version: number
  /** 告知同意的时刻（FR-S05.1）。未同意为 `null`，此时不得进入任何业务功能 */
  consent_at: IsoUtc | null
  /** 最近一次导出时刻，用于「建议每周导出」的提示（PRD §12-9） */
  last_export_at: IsoUtc | null
}

// ── 3 个非业务 store（不适用 AuditFields 契约）────────────────────────────

/**
 * 写入日志（约束 9）。
 *
 * 本期用于调试与校验：每次 applyCommand 在同一事务内追加一条。
 * 上云后直接作为离线队列的载体，因此**不参与导出**——它是操作历史而非
 * 数据状态，重放会产生重复写入（见 design.md「偏离留痕」第 2 条）。
 */
export interface PendingOp {
  id: Uuid
  command_type: string
  payload: unknown
  applied_at: IsoUtc
  tz_offset_minutes: number
}

/**
 * 图片二进制（约束 7）。
 *
 * 这是全项目唯一允许物理删除的 store（见 design.md「偏离留痕」第 1 条）：
 * 图片是大二进制，软删除不释放配额，反而会导致约束 5 要防的问题。
 */
export interface BlobRecord {
  id: Uuid
  mime: string
  bytes: Blob
  byte_size: number
  created_at: IsoUtc
}

/** 埋点属性只允许结构化值与区间值，禁止自由文本、图片与身份信息（PRD §10.3） */
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
 * 约束 3「每条记录带 user_id」与约束 4「每条记录带 version」的口径就是这 9 张；
 * PRD §10.5 自检项里的「9 张表」指的也是它们，不含下面 3 个非业务 store。
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

export type StoreName = BusinessStoreName | InternalStoreName

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
