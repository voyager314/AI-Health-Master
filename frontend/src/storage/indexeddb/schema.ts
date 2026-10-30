/**
 * IndexedDB 的 store 与索引定义。
 *
 * 只建**单字段**索引，查询一律「按主键或单字段索引取数 + 内存过滤」，
 * 不使用复合游标。判定标准是每个查询都能等价写成一条单表 `SELECT ... WHERE`。
 *
 * 两个 IndexedDB 的硬性限制影响了索引选择：
 *
 *   1. **布尔值不是合法 key。** 这类字段无法建索引，只能内存过滤。
 *   2. **索引会跳过被索引字段为 null/undefined 的记录。** 因此 `deleted_at` 上的索引
 *      只会包含「已删除」的记录，用它查不出「未删除」的。排除软删除记录必须在内存中做
 *      （这也正好符合「取数 + 内存过滤」的形状）。
 *
 * 只建实际会用到的索引：每个索引都会增加写入开销与存储占用。
 */
import type {
  AnalyticsEvent,
  AppMeta,
  BlobRecord,
  BodyMetric,
  Meal,
  MealItem,
  PendingOp,
  StoreName,
  Target,
  WorkoutLog,
} from '@/entities'
import type { DBSchema } from 'idb'

export const DB_NAME = 'ai-health-master'

export interface StoreDef {
  readonly name: StoreName
  readonly keyPath: string
  readonly indexes: readonly string[]
  /** business = 6 张业务表，其审计字段由存储层注入；internal = 其余 3 个 */
  readonly kind: 'business' | 'internal'
}

export const STORES: readonly StoreDef[] = [
  {
    name: 'workout_log',
    keyPath: 'id',
    // logged_at 支撑近 30 天列表与「查看更早」范围内的取数
    indexes: ['user_id', 'logged_at'],
    kind: 'business',
  },
  {
    name: 'body_metric',
    keyPath: 'id',
    // measured_at 支撑「近 12 周体重趋势」的范围取数
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
    // created_at 支撑图片清理策略：只保留最近 30 天内、且最多最近 50 张
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
 * 两者漂移由测试兜住——测试断言实际数据库里 9 个 store 与各自的索引都存在。
 */
export interface AppDb extends DBSchema {
  workout_log: {
    key: string
    value: WorkoutLog
    indexes: { user_id: string; logged_at: string }
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
