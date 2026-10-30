/**
 * 启动维护：在业务页面渲染之前清理超出保留期的运动记录。
 *
 * 位置在同意之后、业务内容之前。再早没有意义——未同意时不该碰业务数据；
 * 再晚则用户会先看到超期记录，再看着它们消失。
 *
 * 清理失败一律吞掉并继续启动。它是维护动作而不是用户提交的动作：失败时用户没有
 * 可做的补救，弹一个错误只会让人以为应用坏了，而记录多留一天并没有损害。
 */
import { applyCommand } from '@/commands'
import { Skeleton } from '@/shared'
import { useEffect, useState, type ReactNode } from 'react'

export interface StartupMaintenanceProps {
  readonly children: ReactNode
  /** 执行命令的能力。默认走真实命令总线，测试注入以观察调用时机或制造失败 */
  readonly run?: (type: string) => Promise<unknown>
}

export function StartupMaintenance({ children, run }: StartupMaintenanceProps) {
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    let alive = true

    // 同步抛错与异步失败同等对待：两者都是「这次清理没成功」，都不该拦住启动
    let attempt: Promise<unknown>
    try {
      attempt = (run ?? applyCommand)('workout_log/purge_expired')
    } catch {
      attempt = Promise.resolve()
    }

    void attempt.catch(() => undefined).then(() => {
      if (alive) setSettled(true)
    })

    return () => {
      alive = false
    }
  }, [run])

  if (!settled) return <Skeleton lines={3} label="正在准备本地数据" />

  return <>{children}</>
}
