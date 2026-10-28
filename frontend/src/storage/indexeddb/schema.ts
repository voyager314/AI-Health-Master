/**
 * IndexedDB 的 store 与索引定义。
 *
 * 索引遵循约束 8：只建**单字段**索引，查询一律「按主键或单字段索引取数 + 内存过滤」，
 * 禁止复合游标。判定标准是每个查询都能等价写成一条单表 `SELECT ... WHERE`。
 *
 * 两个 IndexedDB 的硬性限制影响了索引选择：
 *
 *   1. **布尔值不是合法 key。** `exercise.is_custom`、`set_entry.is_warmup` 这类字段
 *      无法建索引，只能内存过滤。
 *   2. **索引会跳过被索引字段为 null/undefined 的记录。** 因此 `deleted_at` 上的索引
 *      只会包含「已删除」的记录，用它查不出「未删除」的。排除软删除记录必须在内存中做
 *      （这也正好符合约束 8 的「取数 + 内存过滤」形状）。
 *
 * 只建实际会用到的索引：每个索引都会增加写入开销与存储占用。
 */
import type {
  AnalyticsEvent,
  AppMeta,
  BlobRecord,
  BodyMetric,
  Exercise,
  Meal,
  MealItem,
  PendingOp,
  SetEntry,
  StoreName,
  Target,
  Workout,
  WorkoutExercise,
} from '@/entities'
import type { DBSchema } from 'idb'

export const DB_NAME = 'ai-health-master'

export interface StoreDef {
  readonly name: StoreName
  readonly keyPath: string
  readonly indexes: readonly string[]
  /** business = 9 张业务表，适用审计字段契约（约束 3/4）；internal = 其余 3 个 */
  readonly kind: 'business' | 'internal'
}

export const STORES: readonly StoreDef[] = [
  {
    name: 'exercise',
    keyPath: 'id',
    // is_custom 无法建索引（布尔不是合法 key），按 pattern 取数后内存过滤
    indexes: ['user_id', 'pattern'],
    kind: 'business',
  },
  {
    name: 'workout',
    keyPath: 'id',
    // started_at 支撑「近 N 周训练」的范围取数；status 支撑「找进行中的训练单」
    indexes: ['user_id', 'started_at', 'status'],
    kind: 'business',
  },
  {
    name: 'workout_exercise',
    keyPath: 'id',
    // exercise_id 是 FR-T07「上次同动作」的取数入口（v0.2 使用）
    indexes: ['user_id', 'workout_id', 'exercise_id'],
    kind: 'business',
  },
  {
    name: 'set_entry',
    keyPath: 'id',
    indexes: ['user_id', 'workout_exercise_id'],
    kind: 'business',
  },
  {
    name: 'body_metric',
    keyPath: 'id',
    // measured_at 支撑「近 12 周体重趋势」的范围取数（FR-W02）
    indexes: ['user_id', 'measured_at'],
    kind: 'business',
  },
  {
    name: 'meal',
    keyPath: 'id',
    indexes: ['user_id', 'eaten_at'],
    kind: 'business',
  },
  {
    name: 'meal_item',
    keyPath: 'id',
    indexes: ['user_id', 'meal_id'],
    kind: 'business',
  },
  {
    name: 'target',
    keyPath: 'id',
    // 当前目标 = effective_from 不晚于现在的最后一条
    indexes: ['user_id', 'effective_from'],
    kind: 'business',
  },
  {
    name: 'app_meta',
    keyPath: 'id',
    indexes: ['user_id'],
    kind: 'business',
  },
  {
    name: 'pending_ops',
    keyPath: 'id',
    indexes: ['applied_at'],
    kind: 'internal',
  },
  {
    name: 'blob',
    keyPath: 'id',
    // created_at 支撑图片清理策略（PRD §11.5：最近 30 天或最近 50 张）
    indexes: ['created_at'],
    kind: 'internal',
  },
  {
    name: 'analytics_event',
    keyPath: 'id',
    indexes: ['name', 'occurred_at', 'user_id'],
    kind: 'internal',
  },
]

export const BUSINESS_STORES = STORES.filter((s) => s.kind === 'business')

/**
 * idb 的类型化 schema。
 *
 * 与上面的 STORES 是两份声明：STORES 驱动建表（运行时），本类型驱动类型推导（编译期）。
 * 两者漂移由任务 2.1 的测试兜住——它断言实际数据库里 12 个 store 与各自的索引都存在。
 */
export interface AppDb extends DBSchema {
  exercise: {
    key: string
    value: Exercise
    indexes: { user_id: string; pattern: string }
  }
  workout: {
    key: string
    value: Workout
    indexes: { user_id: string; started_at: string; status: string }
  }
  workout_exercise: {
    key: string
    value: WorkoutExercise
    indexes: { user_id: string; workout_id: string; exercise_id: string }
  }
  set_entry: {
    key: string
    value: SetEntry
    indexes: { user_id: string; workout_exercise_id: string }
  }
  body_metric: {
    key: string
    value: BodyMetric
    indexes: { user_id: string; measured_at: string }
  }
  meal: {
    key: string
    value: Meal
    indexes: { user_id: string; eaten_at: string }
  }
  meal_item: {
    key: string
    value: MealItem
    indexes: { user_id: string; meal_id: string }
  }
  target: {
    key: string
    value: Target
    indexes: { user_id: string; effective_from: string }
  }
  app_meta: {
    key: string
    value: AppMeta
    indexes: { user_id: string }
  }
  pending_ops: {
    key: string
    value: PendingOp
    indexes: { applied_at: string }
  }
  blob: {
    key: string
    value: BlobRecord
    indexes: { created_at: string }
  }
  analytics_event: {
    key: string
    value: AnalyticsEvent
    indexes: { name: string; occurred_at: string; user_id: string }
  }
}
