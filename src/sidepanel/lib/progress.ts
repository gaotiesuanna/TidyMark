import { progressPortName, type ProgressEvent } from '@/background/events'
import { CLIENT_ID } from './clientId'

export interface ProgressHandlers {
  onEvent: (event: ProgressEvent) => void
  /** 长连接断开——通常意味着 service worker 被浏览器回收了。 */
  onDisconnect: () => void
}

export interface ProgressConnection {
  /** 往后台发一个空消息。收到消息会重置 service worker 的空闲计时。 */
  ping(): void
  disconnect(): void
}

/**
 * 连接后台的进度通道。测试环境没有 chrome API，返回 null 表示没连上。
 */
export function connectProgress(handlers: ProgressHandlers): ProgressConnection | null {
  if (typeof chrome === 'undefined' || chrome.runtime?.connect === undefined) return null
  // 连接名里带上本侧栏的身份，后台据此只把属于这个窗口的进度推回来
  const port = chrome.runtime.connect({ name: progressPortName(CLIENT_ID) })
  port.onMessage.addListener((event) => handlers.onEvent(event as ProgressEvent))
  port.onDisconnect.addListener(() => handlers.onDisconnect())
  return {
    ping: () => {
      try {
        port.postMessage({ kind: 'ping' })
      } catch {
        // 通道已断，onDisconnect 会走它自己的处理
      }
    },
    disconnect: () => port.disconnect(),
  }
}

/** 长任务期间每 20 秒 ping 一次，避免 service worker 因空闲被回收。 */
export const KEEPALIVE_INTERVAL_MS = 20_000

export function startKeepalive(connection: ProgressConnection | null): () => void {
  if (connection === null) return () => {}
  const timer = setInterval(() => connection.ping(), KEEPALIVE_INTERVAL_MS)
  return () => clearInterval(timer)
}
