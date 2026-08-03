import type { Request, Response } from '@/background/messages'

/**
 * 把 Chrome 的原始通信错误翻译成能指导下一步的话。
 * 这些错误都指向同一件事：后台在响应回来之前没了。
 */
export function describeSendError(raw: string): string {
  if (/message channel closed|message port closed/i.test(raw)) {
    return '后台在返回结果前被中断了（扩展刚重新加载，或后台被浏览器回收）。请重试——已经跑完的批次有缓存，重试会快很多。'
  }
  if (/Extension context invalidated/i.test(raw)) {
    return '扩展已重新加载，这个侧栏面板已失效。请关掉侧栏重新打开。'
  }
  if (/Receiving end does not exist|Could not establish connection/i.test(raw)) {
    return '连不上后台。请在 chrome://extensions 里确认 TidyMark 已启用，然后重开侧栏。'
  }
  return raw
}

export async function send(request: Request): Promise<Response> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as Response | undefined
    // service worker 中途被回收时，Chrome 会以 undefined 结束这次调用
    return response ?? { ok: false, error: '后台没有返回结果，可能已被浏览器回收，请重试。' }
  } catch (error) {
    return { ok: false, error: describeSendError(String(error)) }
  }
}
