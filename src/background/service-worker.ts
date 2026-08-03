import { createChromePorts } from './chrome-ports'
import { handle } from './handlers'
import type { Request } from './messages'

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handle(createChromePorts(), request)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }))
  return true // 保持消息通道开启以支持异步响应
})
