/**
 * 设置。
 *
 * 数据相关的入口放在最上面，并且是一级可见：本地优先架构下，「导出」是用户唯一
 * 能对抗数据丢失的手段，藏进二级菜单等于把风险留给用户自己发现。
 *
 * 尚未实现的目标设置用占位说明代替入口，避免点了没有反应。
 */
import { Link } from 'react-router'

export function SettingsPage() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>设置</h1>
      </header>

      <section className="group">
        <h2 className="group__title">数据</h2>
        <nav className="list">
          <Link className="list__row" to="/settings/data">
            <span>导出与导入</span>
            <span className="list__chevron" aria-hidden="true">
              ›
            </span>
          </Link>
          <Link className="list__row" to="/settings/privacy">
            <span>数据处理说明</span>
            <span className="list__chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        </nav>
      </section>

      <section className="group">
        <h2 className="group__title">目标</h2>
        <p className="group__note">蛋白目标、训练频次与体重增速的设置即将提供。</p>
      </section>
    </main>
  )
}
