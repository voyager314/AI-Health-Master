/**
 * service worker 注册的测试替身。
 *
 * 真实的注册接口由 vite 插件在构建时生成，测试进程里没有对应文件，直接导入会在
 * 解析阶段就失败。vite 配置把这个模块别名到该虚拟导入上，测试因此能挂载依赖它的组件。
 *
 * 暴露可写状态而不是固定返回 false：「新版本就绪」是最需要验证的分支——它一旦处理错，
 * 用户正在填写的输入会连同页面一起被换掉。
 */
import { useSyncExternalStore } from 'react'

let needRefresh = false
let updateCalls = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 把「新版本就绪」置为指定状态。仅供测试使用 */
export function setNeedRefreshForTest(value: boolean): void {
  needRefresh = value
  emit()
}

/** 已调用过的刷新次数。仅供测试使用 */
export function updateCallCount(): number {
  return updateCalls
}

/** 复位替身状态。测试之间必须调用，否则状态会串到下一个用例 */
export function resetPwaRegisterStub(): void {
  needRefresh = false
  updateCalls = 0
  listeners.clear()
}

export function useRegisterSW(): {
  needRefresh: [boolean, (value: boolean) => void]
  offlineReady: [boolean, (value: boolean) => void]
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
} {
  const refresh = useSyncExternalStore(
    subscribe,
    () => needRefresh,
    () => false,
  )

  return {
    needRefresh: [refresh, setNeedRefreshForTest],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {
      updateCalls += 1
    },
  }
}
