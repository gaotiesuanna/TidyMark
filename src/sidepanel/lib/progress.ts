import { PROGRESS_PORT, type ProgressEvent } from '@/background/events'

export interface ProgressHandlers {
  onEvent: (event: ProgressEvent) => void
  /** 长连接断开——通常意味着 service worker 被浏览器回收了。 */
  onDisconnect: () => void
}

/**
 * 连接后台的进度通道。测试环境没有 chrome API，返回 null 表示没连上。
 */
export function connectProgress(handlers: ProgressHandlers): (() => void) | null {
  if (typeof chrome === 'undefined' || chrome.runtime?.connect === undefined) return null
  const port = chrome.runtime.connect({ name: PROGRESS_PORT })
  port.onMessage.addListener((event) => handlers.onEvent(event as ProgressEvent))
  port.onDisconnect.addListener(() => handlers.onDisconnect())
  return () => port.disconnect()
}
