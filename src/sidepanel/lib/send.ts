import type { Request, Response } from '@/background/messages'
import { t } from '@/i18n'

/**
 * 把 Chrome 的原始通信错误翻译成能指导下一步的话。
 * 这些错误都指向同一件事：后台在响应回来之前没了。
 */
export function describeSendError(raw: string): string {
  if (/message channel closed|message port closed/i.test(raw)) {
    return t('sendErrChannelClosed')
  }
  if (/Extension context invalidated/i.test(raw)) {
    return t('sendErrContextInvalidated')
  }
  if (/Receiving end does not exist|Could not establish connection/i.test(raw)) {
    return t('sendErrNoReceiver')
  }
  return raw
}

export async function send(request: Request): Promise<Response> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as Response | undefined
    // service worker 中途被回收时，Chrome 会以 undefined 结束这次调用
    return response ?? { ok: false, error: t('sendErrNoResponse') }
  } catch (error) {
    return { ok: false, error: describeSendError(String(error)) }
  }
}
