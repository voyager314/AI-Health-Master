/**
 * 9 个 store 的记录类型与枚举取值。
 *
 * 6 张业务表（带 AuditFields）+ 3 个非业务 store（pending_ops / blob / analytics_event）。
 * 审计字段的契约定义在 common.ts 的 `AuditFields`。
 */
import type { AuditFields, IsoUtc, StorageRef, UserId, Uuid } from './common.ts'

// ── 枚举取值 ────────────────────────────────────────────────────────────────

/** 运动记录的录入来源，用于统计语音记录占比 */
export const INPUT_SOURCES = ['manual', 'voice'] as const
export type InputSource = (typeof INPUT_SOURCES)[number]

/** 估算值的置信度。营养数值本质是估算，界面必须据此标注，不能当作精确值展示 */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/** 饮食条目的数据来源：AI 识别 / 手动录入 / AI 识别后被用户编辑 */
export const MEAL_ITEM_SOURCES = ['ai', 'manual', 'edit'] as const
export type MealItemSource = (typeof MEAL_ITEM_SOURCES)[number]

// ── 6 张业务表 ──────────────────────────────────────────────────────────────

/**
 * 运动记录里的一张项目卡片。
 *
 * 嵌套在记录内的值，不是实体：没有主键、不被其他记录引用、随记录整体读写。
 * 顺序即它在 `WorkoutLog.items` 数组里的下标，因此不存在第二个表达顺序的字段。
 *
 * 三项指标同时为 `null` 是合法状态，表示用户只记得项目名。
 */
export interface WorkoutItem {
  /** 项目名。必填，不超过 40 字，自由文本，无预设动作库，不做别名归并；同一条记录内允许重复 */
  name: string
  /** 组数，正整数。`null` 表示未填 */
  sets: number | null
  /** 每组次数，正整数。`null` 表示未填 */
  reps: number | null
  /** 重量，单位 kg，0.5 步进，不小于 0。`null` 表示未填 */
  weight_kg: number | null
  /** 该项目自己的描述，不超过 200 字。`null` 表示未填 */
  note: string | null
}

/**
 * 一次提交产生的一条运动记录。
 *
 * 同一天允许多条（早练、晚练各算一次），每条带自己的时刻。
 */
export interface WorkoutLog extends AuditFields {
  /** 记录产生时的设备本地时刻，精确到秒，由程序写入，用户不可编辑。按 UTC 存储，时区另见 tz_offset_minutes */
  logged_at: IsoUtc
  /** 这条记录来自手动填写还是语音提交 */
  input_source: InputSource
  /** 项目卡片，至少 1 张，顺序即用户添加的顺序 */
  items: WorkoutItem[]
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
 * 这是允许物理删除的 store 之一：图片是大二进制，软删除不释放配额，
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
 * 6 张业务表。
 *
 * 「每条记录都带 user_id 与 version」这条契约的口径就是这 6 张，不含下面
 * 3 个非业务 store——它们不持有审计字段，也就不参与用户隔离与版本控制。
 */
export const BUSINESS_STORE_NAMES = [
  'workout_log',
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
 * 进入导出文件的表：6 张业务表加埋点事件。
 *
 * 写操作日志与图片二进制不在其中。前者是操作历史，重放它会把已经发生的写入再做
 * 一遍；后者是二进制，混进纯数据文件会让文件大到无法传输。
 *
 * 导入只接受这 7 张表——文件里出现别的表名说明文件被改过或来自不兼容的版本，
 * 与其猜测意图，不如拒绝。
 */
export const EXPORTED_STORE_NAMES = [
  ...BUSINESS_STORE_NAMES,
  'analytics_event',
] as const
export type ExportedStoreName = (typeof EXPORTED_STORE_NAMES)[number]

/** store 名 → 记录类型的映射，供 Repository 做类型推导 */
export interface BusinessRecordMap {
  workout_log: WorkoutLog
  body_metric: BodyMetric
  meal: Meal
  meal_item: MealItem
  target: Target
  app_meta: AppMeta
}

/** 6 张业务表记录的联合类型 */
export type BusinessRecord = BusinessRecordMap[BusinessStoreName]
