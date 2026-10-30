/**
 * 运动记录列表。
 *
 * 按自然日分组展示，组内按时刻倒序。窗口分四档递进展开，档位是页面状态、不落库：
 * 记住它会让用户下次打开时看不到最近的记录，而这正是列表最主要的用途。
 */
import type { WorkoutLog } from '@/entities'
import { daySummary, groupByDay } from '@/domain'
import { Button, EmptyState, Skeleton } from '@/shared'
import { clockTimeOf, recentDayInterval } from '@/stats'
import { createNow, workoutLogRepo, type Now } from '@/storage'
import { trackHistoryExpand } from '@/telemetry'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { itemTextOf } from './itemText.ts'

/** 可展开的天数档位，第一档是默认窗口 */
const WINDOWS = [30, 60, 90, 180] as const

type Load =
  | { status: 'loading' }
  | { status: 'ready'; logs: readonly WorkoutLog[] }
  | { status: 'error' }

export function WorkoutListPage() {
  const navigate = useNavigate()
  // 取一次「现在」并固定：每次渲染重取会让窗口在同一页面里悄悄移动，
  // 跨零点时上一秒取到的区间与下一秒不同，列表就会自己刷新一次
  const now = useRef<Now>(createNow()).current
  const [days, setDays] = useState<number>(WINDOWS[0])
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  const read = useCallback(async () => {
    const window = recentDayInterval(now.iso, now.tzOffsetMinutes, days)
    return workoutLogRepo.query({
      index: 'logged_at',
      range: { from: window.from, to: window.to },
    })
  }, [now, days])

  useEffect(() => {
    let alive = true
    read().then(
      (logs) => {
        if (alive) setLoad({ status: 'ready', logs })
      },
      () => {
        if (alive) setLoad({ status: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [read])

  // 切档位时先回到加载态，再改窗口：两次都落在事件处理里，
  // effect 只负责把读数结果写回，不在其中切换状态
  function showWindow(next: number) {
    setLoad({ status: 'loading' })
    setDays(next)
    // 记展开之后的档位而不是增量：30/60/90/180 直接回答「最多会翻多久以前」
    void trackHistoryExpand({ days: next })
  }

  const nextWindow = WINDOWS[WINDOWS.indexOf(days as (typeof WINDOWS)[number]) + 1]

  return (
    <main className="page">
      <header className="page__header">
        <h1>运动</h1>
      </header>

      {load.status === 'loading' ? <Skeleton lines={3} label="正在读取运动记录" /> : null}

      {load.status === 'error' ? (
        <EmptyState message="本地数据读取失败，请重新打开应用。" />
      ) : null}

      {load.status === 'ready' && load.logs.length === 0 ? (
        <EmptyState
          message="还没有运动记录。练完填一张卡片，就能记下今天的训练。"
          actionLabel="记录今天的运动"
          onAction={() => navigate('/workout/new')}
        />
      ) : null}

      {load.status === 'ready' && load.logs.length > 0 ? (
        <DayGroups logs={load.logs} onOpen={(id) => navigate(`/workout/${id}`)} />
      ) : null}

      {load.status === 'ready' ? (
        <Link className="btn btn--block btn--primary" to="/workout/new">
          记录今天的运动
        </Link>
      ) : null}

      {nextWindow ? (
        <Button block onClick={() => showWindow(nextWindow)}>
          查看更早（近 {nextWindow} 天）
        </Button>
      ) : null}
    </main>
  )
}

/**
 * 按日分组后的记录。
 *
 * 每日标题给条数与项目名摘要：条数是「这天练了几次」，摘要是「练了什么」，
 * 两者读出同一件事的两个侧面，缺一个用户都要点进去才知道。
 */
function DayGroups({
  logs,
  onOpen,
}: {
  readonly logs: readonly WorkoutLog[]
  readonly onOpen: (id: string) => void
}) {
  return (
    <>
      {groupByDay(logs).map((group) => {
        const summary = daySummary(group.logs)
        return (
          <section key={group.day} className="group">
            <h2 className="group__title">
              {dayLabel(group.day)} · {summary.count} 条
            </h2>
            <div className="list">
              {group.logs.map((log) => (
                <button
                  key={log.id}
                  className="list__row list__row--action"
                  type="button"
                  onClick={() => onOpen(log.id)}
                >
                  <span className="list__time">
                    {clockTimeOf(log.logged_at, log.tz_offset_minutes)}
                  </span>
                  <span>{log.items.map(itemTextOf).join('、')}</span>
                </button>
              ))}
            </div>
            {summary.itemNames.length > 0 ? (
              <p className="group__note">{summary.itemNames.join('、')}</p>
            ) : null}
          </section>
        )
      })}
    </>
  )
}

/**
 * 自然日标识转成可读的日期。
 *
 * `DayKey` 是定宽的 `YYYY-MM-DD`，按位置切片即可，不必解析成日期——本函数只做
 * 展示，任何日期算术都属于 `stats/timeWindow`。
 */
function dayLabel(day: string): string {
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`
}
