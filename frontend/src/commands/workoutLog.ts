/**
 * 运动记录的写入命令：新建、编辑、删除与保留期清理。
 *
 * 四条命令共用一套卡片校验与一套定位规则：`client_id` 是记录的幂等键，
 * 新建靠它去重，编辑与删除靠它定位。
 *
 * 记录的提交时刻与录入来源由命令写入，载荷里出现同名字段也不会被采纳：
 * 前者是记录的事实，后者记录的是这条记录当初怎么进来的，两者都不该由界面改。
 */
import type { Uuid, ValidationIssue, WorkoutItem, WorkoutLog } from '@/entities'
import { validateWorkoutItems } from '@/entities'
import { retentionCutoff } from '@/stats'
import { withAuditForCreate, withAuditForUpdate } from '@/storage/internal'
import { checkClientId, findRowByClientId, type ClientKeyed } from './records.ts'
import { defineCommand } from './types.ts'

/**
 * 运动记录的保留期，单位自然日。
 *
 * 与列表中「查看更早」的最大档位是同一个数：留下的记录一定查得到，
 * 查得到的记录一定还在库里。
 */
export const RETENTION_DAYS = 180

/** 新建与编辑共用的载荷：幂等键加一组项目卡片 */
export interface WorkoutLogDraft {
  /** 客户端生成的幂等键。同一 `client_id` 重复提交不产生第二条记录 */
  readonly client_id: Uuid
  /** 项目卡片，至少一张，项目名必填 */
  readonly items: readonly WorkoutItem[]
}

/** 校验载荷的公共部分：幂等键与卡片 */
function checkDraft(payload: unknown): ValidationIssue[] {
  if (typeof payload !== 'object' || payload === null) {
    return [{ field: 'payload', message: '应为对象' }]
  }

  const { client_id, items } = payload as Partial<WorkoutLogDraft>
  const issues: ValidationIssue[] = checkClientId(client_id)
  issues.push(...validateWorkoutItems(items))

  return issues
}

/**
 * 新建一条运动记录。
 *
 * `logged_at` 取总线上已经算好的当前时刻，`input_source` 固定为手册填写。
 * 同一 `client_id` 已经存在时原样返回既有记录的主键，不写入第二条——连续点两次
 * 保存、或离线重放一次，都会落到这条分支上。
 */
export const createWorkoutLog = defineCommand<WorkoutLogDraft, Uuid>({
  type: 'workout_log/create',
  stores: ['workout_log'],
  validate: checkDraft,
  handler: async (ctx, payload) => {
    const existing = await findRowByClientId(ctx, 'workout_log', payload.client_id)
    if (existing) return existing.id

    const created = withAuditForCreate(
      'workout_log',
      {
        logged_at: ctx.now.iso,
        input_source: 'manual',
        items: [...payload.items],
      },
      ctx.now,
    )
    // 幂等键由调用方给出，写入包装层生成的同名值只是缺省值
    const record: WorkoutLog = { ...created, client_id: payload.client_id }
    await ctx.repos.workout_log.put(record, ctx.tx)
    return record.id
  },
})

/**
 * 修改一条运动记录的卡片。
 *
 * 只接受卡片：`logged_at` 与 `input_source` 由载荷里根本没有可写的入口，
 * 即便调用方多传也不会进入写入路径。记录不存在时什么都不做——它可能刚被
 * 保留期清理掉，此时重建一条比当作没发生更糟。
 */
export const updateWorkoutLog = defineCommand<WorkoutLogDraft, boolean>({
  type: 'workout_log/update',
  stores: ['workout_log'],
  validate: checkDraft,
  handler: async (ctx, payload) => {
    const existing = await findRowByClientId(ctx, 'workout_log', payload.client_id)
    if (!existing) return false

    await ctx.repos.workout_log.put(
      withAuditForUpdate(existing, { items: [...payload.items] }, ctx.now),
      ctx.tx,
    )
    return true
  },
})

/** 整条删除一条运动记录：写 `deleted_at`，记录本身保留到超出保留期 */
export const removeWorkoutLog = defineCommand<ClientKeyed, boolean>({
  type: 'workout_log/remove',
  stores: ['workout_log'],
  validate: (payload) => checkClientId((payload as Partial<ClientKeyed> | null)?.client_id),
  handler: async (ctx, payload) => {
    const existing = await findRowByClientId(ctx, 'workout_log', payload.client_id)
    if (!existing) return false

    await ctx.repos.workout_log.remove(existing.id, ctx.now, ctx.tx)
    return true
  },
})

/**
 * 清理超出保留期的运动记录。
 *
 * 截止时刻由 `stats/timeWindow` 按自然日算出，命令只做「按上界取数 → 交给批量
 * 删除」，不自行算日期。软删除的墓碑一并清理：保留期管的是记录本身的寿命，
 * 墓碑没有读者，留着只会让库随使用时间无限增长。
 *
 * 没有超期记录时不产生任何写入，因此也不留下写操作日志——一条没有对应写入的
 * 操作历史只会让将来的重放队列多出一条无事可做的工作。
 */
export const purgeExpiredWorkoutLogs = defineCommand<null, number>({
  type: 'workout_log/purge_expired',
  stores: ['workout_log'],
  shouldLog: (_ctx, removed) => removed > 0,
  handler: async (ctx) => {
    const cutoff = retentionCutoff(ctx.now.iso, ctx.now.tzOffsetMinutes, RETENTION_DAYS)

    const expired = await ctx.repos.workout_log.query(
      {
        index: 'logged_at',
        // 索引区间是闭区间，恰好落在截止时刻的记录属于保留期的第一天，必须在内存中排除
        range: { to: cutoff },
        includeDeleted: true,
        filter: (row) => row.logged_at < cutoff,
      },
      ctx.tx,
    )

    return ctx.repos.workout_log.purge(
      expired.map((row) => row.id),
      ctx.tx,
    )
  },
})
