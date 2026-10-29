/**
 * 未定义路径。
 *
 * 只对真正不存在的地址出现。已规划但未实现的页面走占位页，两者的区别对用户是
 * 「你点错了」与「这个功能还没上线」。
 */
import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>没有这个页面</h1>
      </header>
      <div className="empty">
        <p className="empty__message">地址可能有误，或者这个页面已经移走。</p>
        <Link className="btn btn--secondary" to="/">
          回到今日
        </Link>
      </div>
    </main>
  )
}
