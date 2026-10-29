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
