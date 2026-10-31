/**
 * 体重记录的写入命令：记录、修改、删除。
 *
 * 三条命令都以 `client_id` 为入口，与运动记录同一套定位规则。测量时刻与录入
 * 来源一样由命令写入，载荷里出现同名字段也不会被采纳：测量时刻是记录的事实，
 * 允许界面改它，记录就能跨日、跨周移动，悄悄改写用户已经看过的周均。
 *
 * 体重值只接受落在 0.1 kg 网格上的数，命令不替调用方取整——取整会让存储值与
 * 界面显示值不一致，而且这种不一致无从发现。规整是界面在提交前的职责。
 */
import type { BodyMetric, Uuid, ValidationIssue } from '@/entities'
import { checkBodyWeight } from '@/entities'
import { withAuditForCreate, withAuditForUpdate } from '@/storage/internal'
import { checkClientId, findRowByClientId, type ClientKeyed } from './records.ts'
import { defineCommand } from './types.ts'

/** 录入与修改共用的载荷 */
export interface BodyMetricDraft extends ClientKeyed {
  /** 体重，单位 kg，取值 1–500，必须落在 0.1 kg 网格上 */
  readonly weight_kg: number
}

/** 校验载荷：幂等键加体重值 */
function checkDraft(payload: unknown): ValidationIssue[] {
  if (typeof payload !== 'object' || payload === null) {
    return [{ field: 'payload', message: '应为对象' }]
  }

  const { client_id, weight_kg: weight } = payload as Partial<BodyMetricDraft>
  const issues: ValidationIssue[] = checkClientId(client_id)

  const reason = checkBodyWeight(weight)
  if (reason !== null) issues.push({ field: 'weight_kg', message: reason })

  return issues
}

/**
 * 记录一条体重。
 *
 * `measured_at` 取总线上已经算好的当前时刻，备注恒为 `null`。同一 `client_id`
 * 已经存在（含墓碑）时原样返回既有记录的主键，不写入第二条——连续点两次记录、
 * 或离线重放一次，都会落到这条分支上。
 */
export const recordBodyMetric = defineCommand<BodyMetricDraft, Uuid>({
  type: 'body_metric/record',
  stores: ['body_metric'],
  validate: checkDraft,
  handler: async (ctx, payload) => {
    const existing = await findRowByClientId(ctx, 'body_metric', payload.client_id)
    if (existing) return existing.id

    const created = withAuditForCreate(
      'body_metric',
      { measured_at: ctx.now.iso, weight_kg: payload.weight_kg, note: null },
      ctx.now,
    )
    // 幂等键由调用方给出，写入包装层生成的同名值只是缺省值
    const record: BodyMetric = { ...created, client_id: payload.client_id }
    await ctx.repos.body_metric.put(record, ctx.tx)
    return record.id
  },
})

/**
 * 修改一条体重记录的数值。
 *
 * 只改体重：测量时刻与备注都不在可写范围内，载荷里多带也不会进入写入路径。
 * 记录不存在或已被删除时什么都不做——改一条已删除的记录没有任何读者，编辑页
 * 本来也把墓碑当作不存在。
 */
export const updateBodyMetric = defineCommand<BodyMetricDraft, boolean>({
  type: 'body_metric/update',
  stores: ['body_metric'],
  validate: checkDraft,
  handler: async (ctx, payload) => {
    const existing = await findRowByClientId(ctx, 'body_metric', payload.client_id)
    if (!existing || existing.deleted_at !== null) return false

    await ctx.repos.body_metric.put(
      withAuditForUpdate(existing, { weight_kg: payload.weight_kg }, ctx.now),
      ctx.tx,
    )
    return true
  },
})

/** 整条删除一条体重记录：写 `deleted_at`，记录本身保留 */
export const removeBodyMetric = defineCommand<ClientKeyed, boolean>({
  type: 'body_metric/remove',
  stores: ['body_metric'],
  validate: (payload) => checkClientId((payload as Partial<ClientKeyed> | null)?.client_id),
  handler: async (ctx, payload) => {
    const existing = await findRowByClientId(ctx, 'body_metric', payload.client_id)
    if (!existing || existing.deleted_at !== null) return false

    await ctx.repos.body_metric.remove(existing.id, ctx.now, ctx.tx)
    return true
  },
})
