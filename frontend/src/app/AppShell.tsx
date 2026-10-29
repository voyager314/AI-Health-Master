/**
 * 应用外壳。
 *
 * 提供路由，并维持内容之外常驻的全局元素（新版提示、断网提示、底部导航、免责声明）。
 * 界面本身由各路由页面提供，本层不决定它们长什么样。
 *
 * 内容区与底部导航同处一个文档流：内容自己滚动，导航固定在视口底部，
 * 因此页面里的吸底操作区不会被导航压住。
 */
import { BrowserRouter, Route, Routes } from 'react-router'

import { BottomNav } from './BottomNav.tsx'
import { ConnectionNotice } from './ConnectionNotice.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import { NotFoundPage } from './NotFoundPage.tsx'
import { routeElements } from './routes.tsx'
import { UpdatePrompt } from './UpdatePrompt.tsx'

export function AppShell() {
  return (
    <BrowserRouter>
      <UpdatePrompt />
      <ConnectionNotice />
      <div className="app-shell">
        <div className="app-shell__content">
          <Routes>
            {routeElements.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          <Disclaimer />
        </div>
        <BottomNav />
      </div>
    </BrowserRouter>
  )
}
