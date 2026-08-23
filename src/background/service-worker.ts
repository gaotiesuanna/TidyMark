import { resolveLocale, setLocale, t } from '@/i18n'
import { loadSettings } from '@/storage/settings'
import { createChromePorts } from './chrome-ports'
import { PROGRESS_PORT, type ProgressEvent } from './events'
import { handle } from './handlers'
import type { Request } from './messages'

// 启动打点：MV3 的 service worker 会被浏览器回收。
// 若分析过程中这行日志再次出现，说明 worker 被杀过，在途请求会以
// "TypeError: Failed to fetch" 失败。
console.log('[TidyMark] service worker 启动', new Date().toISOString())

// cancel 的日志不走 handle()，没有「刚读过的设置」可用，所以启动时先定一次语言。
// worker 被回收重启时会重新走这里，语言不会丢。
void loadSettings(createChromePorts())
  .then((settings) => setLocale(resolveLocale(settings.uiLocale)))
  .catch(() => {}) // 读不到就用默认语言，不该因此阻塞消息监听

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error)
})

// 侧栏的进度长连接。连接期间 service worker 也不容易被空闲回收。
let progressPort: chrome.runtime.Port | null = null

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PROGRESS_PORT) return
  progressPort = port
  // 侧栏的 keepalive ping：收到消息本身就会重置空闲计时，不需要回应
  port.onMessage.addListener(() => {})
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

// 取消标记由 worker 持有：analyze 或 check_links 开始时清零，收到 cancel 时置位，
// 分析／链接检查在批次之间读取它。
let cancelled = false

/**
 * 在飞的请求靠它掐断。
 *
 * 只有标记位是不够的：那只挡得住「还没发出去的下一批」，已经飞出去的最多
 * concurrency 个请求会一直跑到自己结束，用户点完取消得干等着（见 llm/client.ts
 * 的 runSignal）。每次 analyze 或 check_links 开始都换一个新的——上一轮取消过的
 * 那个已经 aborted，沿用它会让新一轮第一个请求当场断掉。
 */
let controller: AbortController | null = null

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  if (request.kind === 'cancel') {
    cancelled = true
    controller?.abort()
    emit({ phase: 'classify', message: t('logCancelRequested'), level: 'warn' })
    sendResponse({ ok: true, kind: 'cancel' })
    return false
  }
  // analyze 与 check_links 都可能跑好几十秒到几分钟、都是分批的批量网络请求，
  // 取消要能掐断在飞的那几个——所以都换新 controller、都吃这个 signal。
  // test_model、导入导出是一来一回的短请求，不归取消管，沿用上一轮的
  // controller 会让它们当场断在起跑线上。
  if (request.kind === 'analyze' || request.kind === 'check_links') {
    cancelled = false
    controller = new AbortController()
  }

  // cancelled 这个标记位两种请求共用没问题：侧栏的 busy 是单槽，analyze 与
  // check_links 不可能同时在跑，不存在一个把另一个的取消标记冲掉的场景。
  const signal =
    request.kind === 'analyze' || request.kind === 'check_links' ? controller?.signal : undefined

  handle(createChromePorts(), request, {
    onEvent: emit,
    isCancelled: () => cancelled,
    ...(signal === undefined ? {} : { signal }),
  })
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }))
  return true // 保持消息通道开启以支持异步响应
})
