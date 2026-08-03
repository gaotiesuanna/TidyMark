import type { Request, Response } from '@/background/messages'

export async function send(request: Request): Promise<Response> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as Response | undefined
    // service worker 中途被回收时，Chrome 会以 undefined 结束这次调用
    return response ?? { ok: false, error: '后台没有返回结果，可能已被浏览器回收，请重试。' }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}
