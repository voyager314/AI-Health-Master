/**
 * 测试工具：库名隔离与记录构造。
 *
 * 用例之间靠独立库名隔离，不重置 indexedDB 全局——测试代码因此完全不需要碰
 * IndexedDB API。存储访问只允许出现在数据库实现目录内，源码扫描据此判定，
 * 测试代码不碰全局对象也就不必申请豁免。
 */
import type {
  AppMeta,
  BodyMetric,
  Meal,
  MealItem,
  Target,
  WorkoutLog,
} from '@/entities'
import type { CreateInput } from '@/storage/indexeddb/write.ts'
import { v7 as uuidv7 } from 'uuid'

/** 给每个用例一个独立的数据库名，避免用例之间互相干扰 */
export function uniqueDbName(label: string): string {
  return `test-${label}-${uuidv7()}`
}

/** 构造一个 UUID v7，用于填外键 */
export function someId(): string {
  return uuidv7()
}

/**
 * 构造一个固定时刻的 Date 替身。
 *
 * `getTimezoneOffset()` 的符号与契约里的 `tz_offset_minutes` 相反：
 * 入参 `tzOffsetMinutes` 用契约的语义（东为正，UTC+8 → 480），
 * 替身内部取反以模拟真实 Date 的行为。
 */
export function fixedDate(iso: string, tzOffsetMinutes: number): Date {
  return {
    toISOString: () => iso,
    getTimezoneOffset: () => -tzOffsetMinutes,
  } as unknown as Date
}

// ── 6 张业务表的 CreateInput 构造器 ─────────────────────────────────────────
//
// 每个构造器返回一条合规的最小记录，用 overrides 覆盖需要变化的字段。
// 审计字段不在这里出现——它们由写入包装层注入，业务代码既看不到也传不了。

export function aWorkoutLog(
  overrides: Partial<CreateInput<WorkoutLog>> = {},
): CreateInput<WorkoutLog> {
  return {
    logged_at: '2026-10-28T10:00:00.000Z',
    input_source: 'manual',
    items: [{ name: '杠铃卧推', sets: 4, reps: 8, weight_kg: 80, note: null }],
    ...overrides,
  }
}

export function aBodyMetric(
  overrides: Partial<CreateInput<BodyMetric>> = {},
): CreateInput<BodyMetric> {
  return {
    measured_at: '2026-10-28T23:00:00.000Z',
    weight_kg: 72.4,
    note: null,
    ...overrides,
  }
}

export function aMeal(overrides: Partial<CreateInput<Meal>> = {}): CreateInput<Meal> {
  return {
    eaten_at: '2026-10-28T12:00:00.000Z',
    note: null,
    photo_ref: null,
    total_kcal: 650,
    protein_g: 35,
    carb_g: 80,
    fat_g: 20,
    ai_confidence: 'medium',
    ...overrides,
  }
}

export function aMealItem(overrides: Partial<CreateInput<MealItem>> = {}): CreateInput<MealItem> {
  return {
    meal_id: someId(),
    name: '米饭',
    net_weight_g: 200,
    ratio: 1,
    kcal: 260,
    protein_g: 5,
    carb_g: 58,
    fat_g: 1,
    source: 'ai',
    ...overrides,
  }
}

export function aTarget(overrides: Partial<CreateInput<Target>> = {}): CreateInput<Target> {
  return {
    protein_per_kg: 1.8,
    kcal_delta: 250,
    weight_gain_per_month: 0.3,
    weekly_workout_target: 4,
    effective_from: '2026-10-28T00:00:00.000Z',
    ...overrides,
  }
}

export function anAppMeta(overrides: Partial<CreateInput<AppMeta>> = {}): CreateInput<AppMeta> {
  return {
    consent_at: null,
    last_export_at: null,
    ...overrides,
  }
}

