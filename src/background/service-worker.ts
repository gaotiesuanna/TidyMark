import { createChromePorts } from './chrome-ports'
import { PROGRESS_PORT, type ProgressEvent } from './events'
import { handle } from './handlers'
import type { Request } from './messages'

// 启动打点：MV3 的 service worker 会被浏览器回收。
// 若分析过程中这行日志再次出现，说明 worker 被杀过，在途请求会以
// "TypeError: Failed to fetch" 失败。
console.log('[TidyMark] service worker 启动', new Date().toISOString())

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

// 侧栏的进度长连接。连接期间 service worker 也不容易被空闲回收。
let progressPort: chrome.runtime.Port | null = null

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PROGRESS_PORT) return
  progressPort = port
  port.onDisconnect.addListener(() => {
    if (progressPort === port) progressPort = null
  })
})

function emit(event: ProgressEvent): void {
  try {
    progressPort?.postMessage(event)
  } catch {
    // 侧栏已关闭，进度无人接收，不影响正在进行的整理
    progressPort = null
  }
}

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handle(createChromePorts(), request, { onEvent: emit })
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }))
  return true // 保持消息通道开启以支持异步响应
})
