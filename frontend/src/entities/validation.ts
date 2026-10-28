/**
 * 字段规格与校验。
 *
 * 一份规格，两处使用：
 *   1. 写入路径（storage）——落库前校验，把脏数据挡在数据库之外
 *   2. 导入路径（任务 9.1）——必须在清空数据库**之前**完成全量校验，
 *      否则「清空后才发现文件第 300 条有问题」会让用户原数据直接没了
 *
 * 校验是纯函数、零依赖，因此导入校验天然满足「不碰数据库」的要求。
 */
import {
  CONFIDENCE_LEVELS,
  EXERCISE_PATTERNS,
  INPUT_SOURCES,
  MEAL_ITEM_SOURCES,
  METRIC_TYPES,
  WORKOUT_STATUSES,
  type StoreName,
} from './records.ts'

// ── 规格定义 ────────────────────────────────────────────────────────────────

export type FieldRule =
  /** UUID v7。版本位必须是 7——这让一个 v4 主键在落库前就被拒绝（约束 2） */
  | { readonly type: 'uuidV7' }
  | { readonly type: 'userId' }
  /** 以 Z 结尾的 UTC ISO 8601（约束 6） */
  | { readonly type: 'isoUtc' }
  /** `local://<uuid>`（约束 7） */
  | { readonly type: 'storageRef' }
  | { readonly type: 'boolean' }
  | { readonly type: 'string'; readonly maxLength?: number; readonly allowEmpty?: boolean }
  | { readonly type: 'int'; readonly min?: number; readonly max?: number }
  | { readonly type: 'number'; readonly min?: number; readonly max?: number }
  | { readonly type: 'enum'; readonly values: readonly string[] }
  /** 任意可序列化值，仅用于 pending_ops.payload */
  | { readonly type: 'json' }
  | { readonly type: 'blob' }
  /** 埋点属性：扁平对象，值只能是标量。结构上排除自由文本载荷与嵌套对象 */
  | { readonly type: 'analyticsProps' }

export interface FieldSpec {
  readonly rule: FieldRule
  readonly nullable: boolean
}

export type RecordSpec = Readonly<Record<string, FieldSpec>>

export interface ValidationIssue {
  readonly field: string
  readonly message: string
}

const f = (rule: FieldRule, nullable = false): FieldSpec => ({ rule, nullable })

// ── 校验实现 ────────────────────────────────────────────────────────────────

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const STORAGE_REF = /^local:\/\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** 返回不合规原因；合规返回 null */
function checkRule(rule: FieldRule, value: unknown): string | null {
  switch (rule.type) {
    case 'uuidV7':
      if (typeof value !== 'string') return '应为字符串'
      if (!UUID_V7.test(value)) {
        return '应为 UUID v7。约束 2 禁止 v4（crypto.randomUUID 返回的就是 v4）与自增 ID'
      }
      return null

    case 'userId':
      if (typeof value !== 'string' || value.length === 0) return '应为非空字符串'
      return null

    case 'isoUtc':
      if (typeof value !== 'string') return '应为字符串'
      if (!ISO_UTC.test(value)) {
        return '应为以 Z 结尾的 UTC ISO 8601。约束 6 禁止带时区偏移的时间字符串与时间戳数字'
      }
      if (Number.isNaN(Date.parse(value))) return '不是合法时刻'
      return null

    case 'storageRef':
      if (typeof value !== 'string') return '应为字符串'
      if (!STORAGE_REF.test(value)) return '应为 local://<uuid-v7> 格式（约束 7）'
      return null

    case 'boolean':
      return typeof value === 'boolean' ? null : '应为布尔值'

    case 'string': {
      if (typeof value !== 'string') return '应为字符串'
      if (!rule.allowEmpty && value.length === 0) return '不能为空字符串'
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        return `长度不能超过 ${rule.maxLength}`
      }
      return null
    }

    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return '应为整数'
      if (rule.min !== undefined && value < rule.min) return `不能小于 ${rule.min}`
      if (rule.max !== undefined && value > rule.max) return `不能大于 ${rule.max}`
      return null
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '应为有限数值'
      if (rule.min !== undefined && value < rule.min) return `不能小于 ${rule.min}`
      if (rule.max !== undefined && value > rule.max) return `不能大于 ${rule.max}`
      return null
    }

    case 'enum':
      if (typeof value !== 'string') return '应为字符串'
      if (!rule.values.includes(value)) {
        return `取值必须是 ${rule.values.join(' / ')} 之一`
      }
      return null

    case 'json':
      return value === undefined ? '不能为 undefined' : null

    case 'blob':
      return value instanceof Blob ? null : '应为 Blob'

    case 'analyticsProps': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return '应为扁平对象'
      }
      for (const [k, v] of Object.entries(value)) {
        const ok = v === null || ['string', 'number', 'boolean'].includes(typeof v)
        if (!ok) {
          return `属性 ${k} 只能是字符串、数值、布尔或 null——埋点禁止采集自由文本与嵌套结构`
        }
      }
      return null
    }
  }
}

/**
 * 按规格校验一条记录。返回全部问题（不是遇到第一个就停），
 * 因为导入场景下用户需要一次看到所有错误而不是逐个修。
 *
 * 未在规格中声明的字段视为错误：拼错的字段名若被静默写入，
 * 到上云建表时才会被发现，届时数据已经脏了。
 */
export function validateRecord(spec: RecordSpec, value: unknown): ValidationIssue[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ field: '(record)', message: '应为对象' }]
  }
  const record = value as Record<string, unknown>
  const issues: ValidationIssue[] = []

  for (const [field, { rule, nullable }] of Object.entries(spec)) {
    if (!(field in record)) {
      issues.push({ field, message: '缺少必需字段' })
      continue
    }
    const v = record[field]
    if (v === null) {
      if (!nullable) issues.push({ field, message: '不允许为 null' })
      continue
    }
    const reason = checkRule(rule, v)
    if (reason !== null) issues.push({ field, message: reason })
  }

  for (const field of Object.keys(record)) {
    if (!(field in spec)) issues.push({ field, message: '未知字段' })
  }

  return issues
}

// ── 各 store 的规格 ─────────────────────────────────────────────────────────

/** 9 张业务表共有的审计字段规格（约束 2/3/4/5/6） */
export const AUDIT_SPEC: RecordSpec = {
  id: f({ type: 'uuidV7' }),
  client_id: f({ type: 'uuidV7' }),
  user_id: f({ type: 'userId' }),
  version: f({ type: 'int', min: 1 }),
  created_at: f({ type: 'isoUtc' }),
  updated_at: f({ type: 'isoUtc' }),
  deleted_at: f({ type: 'isoUtc' }, true),
  // 时区偏移的有效范围是 UTC-12 到 UTC+14
  tz_offset_minutes: f({ type: 'int', min: -720, max: 840 }),
}

export const RECORD_SPECS: Readonly<Record<StoreName, RecordSpec>> = {
  exercise: {
    ...AUDIT_SPEC,
    name: f({ type: 'string', maxLength: 60 }),
    pattern: f({ type: 'enum', values: EXERCISE_PATTERNS }),
    primary_muscle: f({ type: 'string', maxLength: 40 }),
    metric_type: f({ type: 'enum', values: METRIC_TYPES }),
    is_custom: f({ type: 'boolean' }),
  },

  workout: {
    ...AUDIT_SPEC,
    started_at: f({ type: 'isoUtc' }),
    ended_at: f({ type: 'isoUtc' }, true),
    template_id: f({ type: 'uuidV7' }, true),
    note: f({ type: 'string', maxLength: 500, allowEmpty: true }, true),
    status: f({ type: 'enum', values: WORKOUT_STATUSES }),
  },

  workout_exercise: {
    ...AUDIT_SPEC,
    workout_id: f({ type: 'uuidV7' }),
    exercise_id: f({ type: 'uuidV7' }),
    order_index: f({ type: 'int', min: 0 }),
  },

  set_entry: {
    ...AUDIT_SPEC,
    workout_exercise_id: f({ type: 'uuidV7' }),
    // 上限取宽松值：识别出 500kg 这类异常值不在这里拦，而是在界面上高亮
    // 并要求用户二次确认（PRD §12-6）——校验层拒绝会让用户无法保存真实的大重量
    weight_kg: f({ type: 'number', min: 0, max: 1000 }, true),
    reps: f({ type: 'int', min: 1, max: 1000 }, true),
    duration_sec: f({ type: 'int', min: 1, max: 86_400 }, true),
    rpe: f({ type: 'number', min: 1, max: 10 }, true),
    is_warmup: f({ type: 'boolean' }),
    input_source: f({ type: 'enum', values: INPUT_SOURCES }),
    confidence: f({ type: 'enum', values: CONFIDENCE_LEVELS }, true),
  },

  body_metric: {
    ...AUDIT_SPEC,
    measured_at: f({ type: 'isoUtc' }),
    weight_kg: f({ type: 'number', min: 1, max: 500 }),
    note: f({ type: 'string', maxLength: 200, allowEmpty: true }, true),
  },

  meal: {
    ...AUDIT_SPEC,
    eaten_at: f({ type: 'isoUtc' }),
    note: f({ type: 'string', maxLength: 500, allowEmpty: true }, true),
    photo_ref: f({ type: 'storageRef' }, true),
    total_kcal: f({ type: 'number', min: 0, max: 20_000 }, true),
    protein_g: f({ type: 'number', min: 0, max: 2000 }, true),
    carb_g: f({ type: 'number', min: 0, max: 2000 }, true),
    fat_g: f({ type: 'number', min: 0, max: 2000 }, true),
    ai_confidence: f({ type: 'enum', values: CONFIDENCE_LEVELS }, true),
  },

  meal_item: {
    ...AUDIT_SPEC,
    meal_id: f({ type: 'uuidV7' }),
    name: f({ type: 'string', maxLength: 60 }),
    net_weight_g: f({ type: 'number', min: 0, max: 10_000 }, true),
    ratio: f({ type: 'number', min: 0, max: 1 }),
    kcal: f({ type: 'number', min: 0, max: 20_000 }, true),
    protein_g: f({ type: 'number', min: 0, max: 2000 }, true),
    carb_g: f({ type: 'number', min: 0, max: 2000 }, true),
    fat_g: f({ type: 'number', min: 0, max: 2000 }, true),
    source: f({ type: 'enum', values: MEAL_ITEM_SOURCES }),
  },

  target: {
    ...AUDIT_SPEC,
    // PRD §15.5 的经验区间是 1.6-2.2 g/kg，这里放宽到 0.5-5 允许用户自行调整
    protein_per_kg: f({ type: 'number', min: 0.5, max: 5 }),
    kcal_delta: f({ type: 'number', min: -2000, max: 2000 }),
    weight_gain_per_month: f({ type: 'number', min: -5, max: 5 }),
    weekly_workout_target: f({ type: 'int', min: 0, max: 14 }),
    effective_from: f({ type: 'isoUtc' }),
  },

  app_meta: {
    ...AUDIT_SPEC,
    schema_version: f({ type: 'int', min: 1 }),
    consent_at: f({ type: 'isoUtc' }, true),
    last_export_at: f({ type: 'isoUtc' }, true),
  },

  // ── 非业务 store：不带审计字段契约 ──

  pending_ops: {
    id: f({ type: 'uuidV7' }),
    command_type: f({ type: 'string', maxLength: 80 }),
    payload: f({ type: 'json' }),
    applied_at: f({ type: 'isoUtc' }),
    tz_offset_minutes: f({ type: 'int', min: -720, max: 840 }),
  },

  blob: {
    id: f({ type: 'uuidV7' }),
    mime: f({ type: 'string', maxLength: 80 }),
    bytes: f({ type: 'blob' }),
    byte_size: f({ type: 'int', min: 0 }),
    created_at: f({ type: 'isoUtc' }),
  },

  analytics_event: {
    id: f({ type: 'uuidV7' }),
    name: f({ type: 'string', maxLength: 60 }),
    occurred_at: f({ type: 'isoUtc' }),
    tz_offset_minutes: f({ type: 'int', min: -720, max: 840 }),
    props: f({ type: 'analyticsProps' }),
    user_id: f({ type: 'userId' }),
  },
}
