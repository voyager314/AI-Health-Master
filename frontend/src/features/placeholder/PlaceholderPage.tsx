/**
 * 已规划但尚未实现的页面。
 *
 * 说清楚三件事：这是哪一页、现在没有、之后会有。留一个返回入口，免得用户在主屏
 * 启动后无处可去。
 */
import { Link } from 'react-router'

export interface PlaceholderPageProps {
  /** 页面名称，与底部导航上的叫法一致 */
  readonly title: string
}

export function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <main className="page">
      <header className="page__header">
        <h1>{title}</h1>
      </header>
      <div className="empty">
        <p className="empty__message">这个功能还没有上线。</p>
        <Link className="btn btn--secondary" to="/">
          回到今日
        </Link>
      </div>
    </main>
  )
}
