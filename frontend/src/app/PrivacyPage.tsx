/**
 * 数据处理说明（设置里的查阅入口）。
 *
 * 正文与首次使用的同意页共用同一个组件。两处各写一份，迟早会在「到底承诺了什么」
 * 上分叉——而这类分歧一旦出现，等于对用户做了一个产品其实没做的事。
 */
import { Link } from 'react-router'

import { DisclosureSections } from './DisclosureSections.tsx'

export function PrivacyPage() {
  return (
    <main className="page">
      <header className="page__header">
        <Link className="page__back" to="/settings">
          ‹ 设置
        </Link>
        <h1>数据处理说明</h1>
      </header>

      <DisclosureSections />
    </main>
  )
}
