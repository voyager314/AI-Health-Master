/**
 * 底部导航。
 *
 * 固定在屏幕底部，是单手拇指最容易够到的区域。每个目标的可点击区域覆盖整格，
 * 高度不低于 44 px，避免训练间隙手指带汗时点不中。
 *
 * 用链接而不是按钮：导航是页面跳转，应当支持浏览器的返回与在新标签页打开。
 */
import { NavLink, useLocation } from 'react-router'

import { isNavActive, navItems } from './routes.tsx'

export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav className="tabs" aria-label="主导航">
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={`tabs__item${isNavActive(item.path, pathname) ? ' tabs__item--active' : ''}`}
          aria-current={isNavActive(item.path, pathname) ? 'page' : undefined}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
