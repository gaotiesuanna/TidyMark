import { createChromePorts } from './chrome-ports'
import { handle } from './handlers'
import type { Request } from './messages'

// 启动打点：MV3 的 service worker 会被浏览器回收。
// 若分析过程中这行日志再次出现，说明 worker 被杀过，在途请求会以
// "TypeError: Failed to fetch" 失败。
console.log('[TidyMark] service worker 启动', new Date().toISOString())

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handle(createChromePorts(), request)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }))
  return true // 保持消息通道开启以支持异步响应
})
