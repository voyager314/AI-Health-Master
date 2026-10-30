/**
 * 今日总览。
 *
 * 当前只显示本地记录的概况，够用来确认「数据还在」。运动记录列表、体重周均与蛋白
 * 进度随各自功能接入后逐个填进来。
 *
 * 三种状态必须分开呈现：读取中给占位、没有数据给一句话加一个主行动、有数据才画内容。
 * 把「还没有」画成空图表是最容易犯的错——用户看到的是坏了，而不是还没开始。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { EmptyState, Skeleton } from '@/shared'
import { bodyMetricRepo, workoutLogRepo } from '@/storage'

interface Overview {
  readonly workouts: number
  readonly weights: number
}

type Load = { status: 'loading' } | { status: 'ready'; data: Overview } | { status: 'error' }

export function HomePage() {
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  const read = useCallback(async () => {
    const [workouts, weights] = await Promise.all([
      workoutLogRepo.list({ includeDeleted: false }),
      bodyMetricRepo.list({ includeDeleted: false }),
    ])
    return { workouts: workouts.length, weights: weights.length }
  }, [])

  useEffect(() => {
    let alive = true
    read().then(
      (data) => {
        if (alive) setLoad({ status: 'ready', data })
      },
      () => {
        if (alive) setLoad({ status: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [read])

  return (
    <main className="page">
      <header className="page__header">
        <h1>今日</h1>
      </header>

      {load.status === 'loading' ? <Skeleton lines={3} label="正在读取本地记录" /> : null}

      {load.status === 'error' ? (
        <EmptyState message="本地数据读取失败，请重新打开应用。" />
      ) : null}

      {load.status === 'ready' && load.data.workouts === 0 && load.data.weights === 0 ? (
        <EmptyState
          message="还没有任何记录。练完说一句话或填一张卡片，就能记下今天的运动。"
          actionLabel="记录今天的运动"
          onAction={() => navigate('/workout')}
        />
      ) : null}

      {load.status === 'ready' && (load.data.workouts > 0 || load.data.weights > 0) ? (
        <dl className="stats">
          <div className="stats__item">
            <dt>运动记录</dt>
            <dd>{load.data.workouts} 次</dd>
          </div>
          <div className="stats__item">
            <dt>体重记录</dt>
            <dd>{load.data.weights} 条</dd>
          </div>
        </dl>
      ) : null}
    </main>
  )
}
