/**
 * 应用自身状态的写入命令。
 *
 * `app_meta` 只保留一行：它是全局状态而非可增长的实体集合，多行会让「当前状态是
 * 哪一行」变成需要额外规则回答的问题。
 */
import { defineCommand } from './types.ts'
import { withAuditForCreate, withAuditForUpdate } from '@/storage/internal'

/** 记录一次导出完成，用于提醒用户定期导出 */
export const markExported = defineCommand<null, void>({
  type: 'app_meta/mark_exported',
  stores: ['app_meta'],
  handler: async (ctx) => {
    // 读取必须走事务句柄：改用独立连接会交出控制权，外层事务随即提交
    const [existing] = await ctx.repos.app_meta.list(undefined, ctx.tx)

    if (existing) {
      await ctx.repos.app_meta.put(
        withAuditForUpdate(existing, { last_export_at: ctx.now.iso }, ctx.now),
        ctx.tx,
      )
      return
    }

    await ctx.repos.app_meta.put(
      withAuditForCreate('app_meta', { consent_at: null, last_export_at: ctx.now.iso }, ctx.now),
      ctx.tx,
    )
  },
})

/**
 * 记录用户已阅读并同意数据处理说明。
 *
 * 这只是落一个时刻，不做任何校验：同意是用户在界面上主动勾选的结果，命令层无法
 * 也不该去判断一次勾选是否「真实」，那属于界面与流程的职责。
 *
 * 重复调用不改变首次同意的时刻：同意发生的时间是一次事实，不是可刷新的状态。
 */
export const grantConsent = defineCommand<null, void>({
  type: 'app_meta/grant_consent',
  stores: ['app_meta'],
  handler: async (ctx) => {
    const [existing] = await ctx.repos.app_meta.list(undefined, ctx.tx)

    if (existing) {
      if (existing.consent_at !== null) return
      await ctx.repos.app_meta.put(
        withAuditForUpdate(existing, { consent_at: ctx.now.iso }, ctx.now),
        ctx.tx,
      )
      return
    }

    await ctx.repos.app_meta.put(
      withAuditForCreate('app_meta', { consent_at: ctx.now.iso, last_export_at: null }, ctx.now),
      ctx.tx,
    )
  },
})
