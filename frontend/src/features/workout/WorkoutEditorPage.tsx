/**
 * 运动记录的录入页与编辑页。
 *
 * 两种用途共用一套卡片编辑器，差别只在初始数据与提交调哪条命令：
 * - 新建：`client_id` 在页面挂载时生成一次，重试沿用同一个，因此连点两次保存
 *   不会产生两条记录；
 * - 编辑：按主键读出记录，`logged_at` 与 `input_source` 只读展示，不提供修改入口。
 *
 * 删除是软删除，二次确认里写明后果：确认框必须说明这条记录不再出现在列表与导出里，
 * 否则用户会以为过一阵还能找回。
 */
import type { WorkoutLog } from '@/entities'
import { applyCommand } from '@/commands'
import { clockTimeOf, dayKeyOf } from '@/stats'
import { workoutLogRepo } from '@/storage'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { v7 as uuidv7 } from 'uuid'

import { Button, EmptyState, Skeleton, dayLabel } from '@/shared'

import { WorkoutCardForm } from './WorkoutCardForm.tsx'

type Load =
  | { status: 'loading' }
  | { status: 'ready'; log: WorkoutLog }
  | { status: 'missing' }
  | { status: 'error' }

/** 录入来源的展示文案 */
const SOURCE_LABELS: Record<WorkoutLog['input_source'], string> = {
  manual: '手动填写',
  voice: '语音记录',
}

export function WorkoutEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // 新建时幂等键只生成一次：重试沿用同一个，连点两次保存不会产生第二条记录
  const newClientId = useRef(uuidv7()).current
  const [load, setLoad] = useState<Load>(
    id ? { status: 'loading' } : { status: 'missing' },
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!id) return
    let alive = true

    workoutLogRepo.get(id).then(
      (log) => {
        if (!alive) return
        // 墓碑也按「没有这条记录」处理：硬要打开一条已删除的记录没有可用操作
        setLoad(log && log.deleted_at === null ? { status: 'ready', log } : { status: 'missing' })
      },
      () => {
        if (alive) setLoad({ status: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [id])

  if (id === undefined) {
    return (
      <EditorShell title="记录运动">
        <WorkoutCardForm
          initialItems={[]}
          saveLabel="保存"
          onSave={async (items) => {
            await applyCommand('workout_log/create', { client_id: newClientId, items })
            navigate('/workout')
          }}
        />
      </EditorShell>
    )
  }

  if (load.status === 'loading') {
    return (
      <EditorShell title="编辑记录">
        <Skeleton lines={4} label="正在读取这条记录" />
      </EditorShell>
    )
  }

  if (load.status === 'error') {
    return (
      <EditorShell title="编辑记录">
        <EmptyState message="本地数据读取失败，请重新打开应用。" />
      </EditorShell>
    )
  }

  if (load.status === 'missing') {
    return (
      <EditorShell title="编辑记录">
        <EmptyState message="这条记录不存在，可能已经被删除。" />
      </EditorShell>
    )
  }

  const { log } = load

  return (
    <EditorShell title="编辑记录">
      <dl className="meta">
        <div className="meta__item">
          <dt>训练时间</dt>
          <dd>
            {/* 日期与时刻都由记录自带的偏移换算：取 UTC 日期会与列表的分组差一天 */}
            {dayLabel(dayKeyOf(log.logged_at, log.tz_offset_minutes))}{' '}
            {clockTimeOf(log.logged_at, log.tz_offset_minutes)}
          </dd>
        </div>
        <div className="meta__item">
          <dt>录入方式</dt>
          <dd>{SOURCE_LABELS[log.input_source]}</dd>
        </div>
      </dl>

      <WorkoutCardForm
        initialItems={log.items}
        saveLabel="保存修改"
        inputSource={log.input_source}
        onSave={async (items) => {
          await applyCommand('workout_log/update', { client_id: log.client_id, items })
          navigate('/workout')
        }}
      />

      {confirmingDelete ? (
        <div className="stack">
          <p className="feedback" role="alert">
            删除后这条记录不再显示在列表里，导出文件也不含它。此操作无法撤销。
          </p>
          <Button
            block
            tone="primary"
            onClick={() => {
              void applyCommand('workout_log/remove', { client_id: log.client_id }).then(
                () => navigate('/workout'),
                () => setConfirmingDelete(false),
              )
            }}
          >
            确认删除
          </Button>
          <Button block tone="quiet" onClick={() => setConfirmingDelete(false)}>
            取消
          </Button>
        </div>
      ) : (
        <Button block onClick={() => setConfirmingDelete(true)}>
          删除这条记录
        </Button>
      )}
    </EditorShell>
  )
}

/** 页面外壳：标题、返回入口与统一间距 */
function EditorShell({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <main className="page">
      <header className="page__header">
        <Link className="page__back" to="/workout">
          ‹ 运动
        </Link>
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  )
}
