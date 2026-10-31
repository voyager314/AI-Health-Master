/**
 * 字段规格与校验。
 *
 * 一份规格，两处使用：
 *   1. 写入路径（storage）——落库前校验，把脏数据挡在数据库之外
 *   2. 导入路径——必须在清空数据库**之前**完成全量校验，
 *      否则「清空后才发现文件第 300 条有问题」会让用户原数据直接没了
 *
 * 校验是纯函数、零依赖，因此导入校验天然满足「不碰数据库」的要求。
 */
import type { WorkoutItem } from './records.ts'
import { ISO_UTC, STORAGE_REF, UUID_V7 } from './formats.ts'
import {
  CONFIDENCE_LEVELS,
  INPUT_SOURCES,
  MEAL_ITEM_SOURCES,
  type StoreName,
} from './records.ts'

// ── 规格定义 ────────────────────────────────────────────────────────────────

export type FieldRule =
  /** UUID v7。版本位必须是 7——这让一个 v4 主键在落库前就被拒绝 */
  | { readonly type: 'uuidV7' }
  | { readonly type: 'userId' }
  /** 以 Z 结尾的 UTC ISO 8601 */
  | { readonly type: 'isoUtc' }
  /** `local://<uuid>` */
  | { readonly type: 'storageRef' }
  | { readonly type: 'boolean' }
  | { readonly type: 'string'; readonly maxLength?: number; readonly allowEmpty?: boolean }
  | { readonly type: 'int'; readonly min?: number; readonly max?: number }
  | { readonly type: 'number'; readonly min?: number; readonly max?: number }
  /** 体重：范围内的 kg 值，且落在 0.1 kg 网格上 */
  | { readonly type: 'weightKg' }
  | { readonly type: 'enum'; readonly values: readonly string[] }
  /** 任意可序列化值，仅用于 pending_ops.payload */
  | { readonly type: 'json' }
  | { readonly type: 'blob' }
  /** 埋点属性：扁平对象，值只能是标量。结构上排除自由文本载荷与嵌套对象 */
  | { readonly type: 'analyticsProps' }
  /** 运动记录的项目卡片数组，见 `ITEM_FIELDS` */
  | { readonly type: 'itemList' }

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

// ── 项目卡片 ────────────────────────────────────────────────────────────────

/** 卡片允许出现的字段。数组里多出任何一个键都说明文件被改过或来自别的数据模型 */
const ITEM_FIELDS = ['name', 'sets', 'reps', 'weight_kg', 'note'] as const

/** 项目名长度上限，字。超长的名字在列表里无法一眼读完，摘要也失去意义 */
export const ITEM_NAME_MAX_LENGTH = 40

/** 项目描述长度上限，字 */
export const ITEM_NOTE_MAX_LENGTH = 200

/** 体重允许的取值下界，kg。界面的范围提示与字段规格共用它 */
export const BODY_WEIGHT_MIN_KG = 1

/** 体重允许的取值上界，kg */
export const BODY_WEIGHT_MAX_KG = 500

/**
 * 体重是否落在 0.1 kg 网格上。
 *
 * 用乘以 10 后是否为整数判断。范围内每个由「整数 ÷ 10」得到的网格值都满足，而在
 * 0.1 上反复累加得到的近似值（如 70.19999999999999）不满足——这类值能通过范围
 * 校验，却会以「一位小数」以外的形态流进存储与导出。
 *
 * 调用方负责在提交前把值规整到网格；本函数只判定，不改写传入的值。
 */
export function isBodyWeightOnGrid(value: number): boolean {
  return Number.isInteger(value * 10)
}

/**
 * 校验一个体重值，返回不合规原因；合规返回 null。
 *
 * 字段规格与命令的载荷校验共用它：落库前与「提交前」用的是同一条规则，命令层
 * 因此不必另写一份范围与网格判断。
 */
export function checkBodyWeight(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '应为有限数值'
  if (value < BODY_WEIGHT_MIN_KG || value > BODY_WEIGHT_MAX_KG) {
    return `应为 ${BODY_WEIGHT_MIN_KG}–${BODY_WEIGHT_MAX_KG} kg`
  }
  if (!isBodyWeightOnGrid(value)) return '至多一位小数（步进 0.1 kg）'
  return null
}

/**
 * 重量是否落在 0.5 kg 的网格上。
 *
 * 用乘以 2 取整来判断，而不是比较浮点余数：0.1 + 0.2 这类表示误差会让余数判据
 * 把合法的 0.5 步进重量判成不合法。
 */
function onHalfKilogramGrid(value: number): boolean {
  return Number.isInteger(value * 2)
}

/** 校验一张项目卡片，返回全部问题；合规返回空数组 */
function checkItem(item: unknown, index: number): ValidationIssue[] {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return [{ field: `items[${index}]`, message: '应为对象' }]
  }

  const card = item as Record<string, unknown>
  const issues: ValidationIssue[] = []
  const at = (field: string) => `items[${index}].${field}`

  for (const field of ITEM_FIELDS) {
    if (!(field in card)) issues.push({ field: at(field), message: '缺少必需字段' })
  }
  for (const field of Object.keys(card)) {
    if (!(ITEM_FIELDS as readonly string[]).includes(field)) {
      issues.push({ field: at(field), message: '未知字段' })
    }
  }

  const { name, sets, reps, weight_kg: weight, note } = card

  if (typeof name !== 'string' || name.length === 0) {
    issues.push({ field: at('name'), message: '项目名必填' })
  } else if (name.length > ITEM_NAME_MAX_LENGTH) {
    issues.push({ field: at('name'), message: `长度不能超过 ${ITEM_NAME_MAX_LENGTH}` })
  }

  for (const [field, value] of [
    ['sets', sets],
    ['reps', reps],
  ] as const) {
    if (value === null || value === undefined) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      issues.push({ field: at(field), message: '应为正整数，未填则须为 null' })
    }
  }

  if (weight !== null && weight !== undefined) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      issues.push({ field: at('weight_kg'), message: '应为不小于 0 的数值，未填则须为 null' })
    } else if (!onHalfKilogramGrid(weight)) {
      issues.push({ field: at('weight_kg'), message: '步进为 0.5 kg' })
    }
  }

  if (note !== null && note !== undefined) {
    if (typeof note !== 'string') {
      issues.push({ field: at('note'), message: '应为字符串或 null' })
    } else if (note.length > ITEM_NOTE_MAX_LENGTH) {
      issues.push({ field: at('note'), message: `长度不能超过 ${ITEM_NOTE_MAX_LENGTH}` })
    }
  }

  return issues
}

// ── 校验实现 ────────────────────────────────────────────────────────────────

/** 返回不合规原因；合规返回 null */
function checkRule(rule: FieldRule, value: unknown): string | null {
  switch (rule.type) {
    case 'uuidV7':
      if (typeof value !== 'string') return '应为字符串'
      if (!UUID_V7.test(value)) {
        return '主键必须是 UUID v7；v4 与自增 ID 都不允许，前者无法保证时间有序'
      }
      return null

    case 'userId':
      if (typeof value !== 'string' || value.length === 0) return '应为非空字符串'
      return null

    case 'isoUtc':
      if (typeof value !== 'string') return '应为字符串'
      if (!ISO_UTC.test(value)) {
        return '应为以 Z 结尾的 UTC ISO 8601；带时区偏移的时间字符串与时间戳数字都不允许'
      }
      if (Number.isNaN(Date.parse(value))) return '不是合法时刻'
      return null

    case 'storageRef':
      if (typeof value !== 'string') return '应为字符串'
      if (!STORAGE_REF.test(value)) return '应为 local://<uuid-v7> 格式'
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

    case 'weightKg':
      return checkBodyWeight(value)

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

    case 'itemList':
      // 逐项的问题由 `checkItem` 按字段定位，这里只挡「不是数组」与「空数组」
      return null
  }
}

/**
 * 校验一组项目卡片，返回全部问题；合规返回空数组。
 *
 * 与落库校验共用同一套规则，只是不必先把卡片拼成一条完整记录：命令层在写入前
 * 用它跑一遍载荷，把不合规的卡片挡在事务之外。
 */
export function validateWorkoutItems(items: unknown): ValidationIssue[] {
  if (!Array.isArray(items)) return [{ field: 'items', message: '应为项目卡片数组' }]
  if (items.length === 0) return [{ field: 'items', message: '至少需要一张项目卡片' }]

  const issues: ValidationIssue[] = []
  items.forEach((item, index) => issues.push(...checkItem(item, index)))
  return issues
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

    if (rule.type === 'itemList') {
      if (!Array.isArray(v)) {
        issues.push({ field, message: '应为项目卡片数组' })
        continue
      }
      if (v.length === 0) {
        issues.push({ field, message: '至少需要一张项目卡片' })
        continue
      }
      v.forEach((item, index) => issues.push(...checkItem(item, index)))
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

/** 6 张业务表共有的审计字段规格：主键、幂等键、用户、版本、时刻与时区偏移 */
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
  workout_log: {
    ...AUDIT_SPEC,
    logged_at: f({ type: 'isoUtc' }),
    input_source: f({ type: 'enum', values: INPUT_SOURCES }),
    items: f({ type: 'itemList' }),
  },

  body_metric: {
    ...AUDIT_SPEC,
    measured_at: f({ type: 'isoUtc' }),
    weight_kg: f({ type: 'weightKg' }),
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
    // 增肌期的经验区间是 1.6-2.2 g/kg，这里放宽到 0.5-5 允许用户自行调整
    protein_per_kg: f({ type: 'number', min: 0.5, max: 5 }),
    kcal_delta: f({ type: 'number', min: -2000, max: 2000 }),
    weight_gain_per_month: f({ type: 'number', min: -5, max: 5 }),
    weekly_workout_target: f({ type: 'int', min: 0, max: 14 }),
    effective_from: f({ type: 'isoUtc' }),
  },

  app_meta: {
    ...AUDIT_SPEC,
    consent_at: f({ type: 'isoUtc' }, true),
    last_export_at: f({ type: 'isoUtc' }, true),
  },

  // ── 非业务 store：不带审计字段契约 ──

  pending_ops: {
    id: f({ type: 'uuidV7' }),
    command_type: f({ type: 'string', maxLength: 80 }),
    // 可为 null：有些命令本来就没有载荷（清空全部数据、标记同意）。
    // 伪造一个空对象会让上云后的重放分不清「无载荷」与「空载荷」
    payload: f({ type: 'json' }, true),
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

export type { WorkoutItem }
