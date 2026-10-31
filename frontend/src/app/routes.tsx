/**
 * 路由表。
 *
 * 页面位置一次定全，尚未实现的功能用占位页占住：直接访问一个已规划的地址要能正常
 * 打开并说明「还没上线」，而不是落到 404——用户从主屏图标或历史记录进到一个 404，
 * 会以为应用坏了。
 *
 * 与底部导航共用同一份清单，避免两边各写一套路径、日后加页面时漏改一处。
 */
import type { ReactElement } from 'react'

import { PlaceholderPage } from '@/features/placeholder'
import { WeightEditorPage, WeightPage } from '@/features/weight'
import { WorkoutEditorPage, WorkoutListPage } from '@/features/workout'

import { DataPage } from './DataPage.tsx'
import { HomePage } from './HomePage.tsx'
import { PrivacyPage } from './PrivacyPage.tsx'
import { SettingsPage } from './SettingsPage.tsx'

export interface RouteEntry {
  readonly path: string
  readonly element: ReactElement
}

export interface NavItem {
  readonly path: string
  readonly label: string
}

/** 底部导航：三个主功能加设置，覆盖日常全部入口 */
export const navItems: readonly NavItem[] = [
  { path: '/', label: '今日' },
  { path: '/workout', label: '运动' },
  { path: '/weight', label: '体重' },
  { path: '/settings', label: '设置' },
]

export const routeElements: readonly RouteEntry[] = [
  { path: '/', element: <HomePage /> },
  { path: '/workout', element: <WorkoutListPage /> },
  { path: '/workout/new', element: <WorkoutEditorPage /> },
  { path: '/workout/:id', element: <WorkoutEditorPage /> },
  { path: '/weight', element: <WeightPage /> },
  { path: '/weight/:id', element: <WeightEditorPage /> },
  { path: '/meal', element: <PlaceholderPage title="饮食记录" /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/settings/data', element: <DataPage /> },
  { path: '/settings/privacy', element: <PrivacyPage /> },
]

/**
 * 底部导航是否高亮某个路径。
 *
 * 设置下的子页仍然算作设置：进入「导出与导入」后底栏不应失去高亮，
 * 否则用户会以为已经离开了当前分区。
 */
export function isNavActive(navPath: string, currentPath: string): boolean {
  if (navPath === '/') return currentPath === '/'
  return currentPath === navPath || currentPath.startsWith(`${navPath}/`)
}
