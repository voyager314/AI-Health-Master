/**
 * 加载占位。
 *
 * 存在的理由是时长可感知：本地读取通常很快，但一台用了三年的手机读出几万条记录
 * 时并不快。没有占位就会先白屏再突然出内容，用户分不清是加载还是坏了。
 */
export interface SkeletonProps {
  /** 占位行数 */
  readonly lines?: number
  /** 无障碍名称，说明正在加载什么 */
  readonly label?: string
}

export function Skeleton({ lines = 3, label = '正在加载' }: SkeletonProps) {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="skeleton__line" />
      ))}
    </div>
  )
}
