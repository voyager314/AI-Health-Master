/**
 * 写入包装层。
 *
 * 9 张业务表的审计字段（约束 2/3/4/5/6）全部在这里注入，业务代码既看不到也传不了。
 * 落库前按字段规格校验，把脏数据挡在数据库之外。
 *
 * ⚠️ 本文件是 `'local'` 这个 user_id 字面量在全仓库的**唯一**出现位置——
 * 约束 3 的自检就是搜 storage/** 之外是否有它。
 */
import type {
  AuditFields,
  BusinessRecord,
  IsoUtc,
  StoreName,
  ValidationIssue,
} from '@/entities'
import { RECORD_SPECS, validateRecord } from '@/entities'
import { v7 as uuidv7 } from 'uuid'

/**
 * 本期固定的用户标识（约束 3）。
 *
 * 上云时只把这里换成真实用户 ID，表结构与业务代码都不动。
 */
export const LOCAL_USER_ID = 'local'

/** 本期 version 恒为 1，上云后作为乐观锁（约束 4） */
export const INITIAL_VERSION = 1

// ── 时刻 ────────────────────────────────────────────────────────────────────

export interface Now {
  /** UTC ISO 8601，以 Z 结尾 */
  readonly iso: IsoUtc
  /** 相对 UTC 的偏移，分钟，东为正（UTC+8 → 480） */
  readonly tzOffsetMinutes: number
}

/**
 * 取当前时刻与设备时区偏移。
 *
 * ⚠️ 必须在开启事务**之前**调用。IndexedDB 事务会在控制权交回事件循环时自动提交，
 * 所以事务内不能有任何异步取值；所有准备工作都前置到这里（见 design.md D3）。
 *
 * `clock` 参数让测试能注入固定时刻，不必 mock 全局 Date。
 */
export function createNow(clock: () => Date = () => new Date()): Now {
  const at = clock()
  return {
    iso: at.toISOString(),
    // getTimezoneOffset() 的语义是「本地时间比 UTC 落后多少分钟」，UTC+8 返回 -480。
    // 契约规定 tz_offset_minutes 东为正，所以取反。符号搞错会让所有自然日/周归属偏移一整天。
    tzOffsetMinutes: -at.getTimezoneOffset(),
  }
}

// ── 校验 ────────────────────────────────────────────────────────────────────

export class RecordValidationError extends Error {
  readonly store: StoreName
  readonly issues: readonly ValidationIssue[]

  constructor(store: StoreName, issues: readonly ValidationIssue[]) {
    const detail = issues.map((i) => `  ${i.field}: ${i.message}`).join('\n')
    super(`${store} 记录不符合字段规格：\n${detail}`)
    this.name = 'RecordValidationError'
    this.store = store
    this.issues = issues
  }
}

/**
 * 落库前校验。不合规直接抛错而不是静默写入：
 * 字段拼错或类型不对若被写进去，要到上云建表时才暴露，那时数据已经脏了。
 */
export function assertValidRecord(store: StoreName, record: unknown): void {
  const issues = validateRecord(RECORD_SPECS[store], record)
  if (issues.length > 0) throw new RecordValidationError(store, issues)
}

// ── 审计字段注入 ────────────────────────────────────────────────────────────

/** 新建记录时调用方需要提供的字段：实体字段减去全部审计字段 */
export type CreateInput<T extends BusinessRecord> = Omit<T, keyof AuditFields>

/** 更新记录时允许改动的字段：同样不含审计字段 */
export type UpdateInput<T extends BusinessRecord> = Partial<CreateInput<T>>

/**
 * 注入全部审计字段，生成一条可落库的新记录。
 *
 * `id` 用 UUID v7 而非 `crypto.randomUUID()`（后者是 v4，纯随机）：v7 时间有序，
 * 主键天然可近似按时间排序，上云后也不会让 B 树索引随机分裂（约束 2）。
 * `client_id` 本期与 `id` 同值，上云后服务端靠它为离线重放去重。
 */
export function withAuditForCreate<T extends BusinessRecord>(
  input: CreateInput<T>,
  moment: Now,
): T {
  const id = uuidv7()
  // cast 的原因：TypeScript 无法从 Omit<T, keyof AuditFields> + AuditFields 推回 T，
  // 但字段集合在类型上是完备的——补齐后的对象恰好就是 T。
  return {
    ...input,
    id,
    client_id: id,
    user_id: LOCAL_USER_ID,
    version: INITIAL_VERSION,
    created_at: moment.iso,
    updated_at: moment.iso,
    deleted_at: null,
    tz_offset_minutes: moment.tzOffsetMinutes,
  } as unknown as T
}

/**
 * 在既有记录上应用改动，只刷新 `updated_at`。
 *
 * 身份与来源信息一律不可变，即使 patch 里带了同名字段也会被覆盖回原值：
 *
 * - `id` / `client_id`：改了就等于换了一条记录，上云合并时会出现重复
 * - `created_at`：创建时刻是事实，不随编辑改变
 * - `tz_offset_minutes`：记录的是**写入当时**的时区。用户跨时区旅行后编辑旧记录，
 *   若把它刷成新时区，这条记录的自然日/周归属就会漂走（约束 6）
 * - `version`：本期恒为 1，上云后由服务端递增
 * - `deleted_at`：删除只能走 `withAuditForSoftDelete`
 */
export function withAuditForUpdate<T extends BusinessRecord>(
  existing: T,
  patch: UpdateInput<T>,
  moment: Now,
): T {
  return {
    ...existing,
    ...patch,
    id: existing.id,
    client_id: existing.client_id,
    user_id: existing.user_id,
    version: existing.version,
    created_at: existing.created_at,
    deleted_at: existing.deleted_at,
    tz_offset_minutes: existing.tz_offset_minutes,
    updated_at: moment.iso,
  }
}

/**
 * 软删除（约束 5）：写 `deleted_at`，记录仍留在库中。
 *
 * 物理删除只在两处允许——「清空全部数据」与图片 blob 的清理（见 design.md 偏离留痕）。
 * 重复删除保持首次的删除时刻不变，避免「删除时间」因误操作而漂移。
 */
export function withAuditForSoftDelete<T extends BusinessRecord>(
  existing: T,
  moment: Now,
): T {
  if (existing.deleted_at !== null) return existing
  return { ...existing, deleted_at: moment.iso, updated_at: moment.iso }
}

/** 恢复一条软删除的记录（导入与历史纠错场景会用到） */
export function withAuditForRestore<T extends BusinessRecord>(
  existing: T,
  moment: Now,
): T {
  if (existing.deleted_at === null) return existing
  return { ...existing, deleted_at: null, updated_at: moment.iso }
}
