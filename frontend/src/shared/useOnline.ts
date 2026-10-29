/**
 * 当前是否联网。
 *
 * 返回浏览器上报的在线状态，并在网络变化时重新渲染调用方。它只反映网络的连通性，
 * 不保证某个具体服务可达——因此依赖它的界面应当说明「需要联网」，而不是断言服务可用。
 */
import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function getSnapshot(): boolean {
  return navigator.onLine
}

/** 服务端渲染或非浏览器环境下按联网处理，避免首屏误报离线 */
function getServerSnapshot(): boolean {
  return true
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
