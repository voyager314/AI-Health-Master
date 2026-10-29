/**
 * 记录一次应用打开。
 *
 * 挂在同意门禁之内：未同意之前不产生任何本地统计记录，用户还没被告知数据会落在
 * 本机时，先替他记一笔说不通。
 *
 * 没有可见产出，失败也不提示——用户来记录训练，不是来贡献数据的。
 */
import { useEffect } from 'react'

import { trackAppOpen } from '@/telemetry'

/**
 * 是否以独立窗口启动。
 *
 * 主屏图标的启动方式与浏览器标签页不同，这个属性用来判断用户是否真的把它当应用在用。
 */
function launchedStandalone(): boolean {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // iOS 上 matchMedia 不反映主屏启动，得看 navigator.standalone
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true
  return standalone || iosStandalone
}

export function AppOpenTracker() {
  useEffect(() => {
    void trackAppOpen({ pwa: launchedStandalone() })
  }, [])

  return null
}
