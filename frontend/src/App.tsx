/**
 * 应用根组件。
 *
 * 只负责挂载外壳。需要在外壳层面存在的东西都贴在外壳本身上，这里不做业务决策。
 */
import { AppShell } from './app/AppShell.tsx'

export default function App() {
  return <AppShell />
}
