import { resolveLocale, setLocale, t } from '@/i18n'
import { loadSettings } from '@/storage/settings'
import { createChromePorts } from './chrome-ports'
import { clientIdFromPortName, type ProgressEvent } from './events'
import { handle } from './handlers'
import { ANONYMOUS_CLIENT, createSessions } from './sessions'
import type { IncomingMessage, Request } from './messages'

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

/**
 * 每个窗口的侧栏各一条长连接、各一份取消状态。
 *
 * 这三样东西以前都是这个文件里的模块级单槽，两个窗口同时开着侧栏就会互相顶掉
 * ——事故形态与不这么做的理由都写在 sessions.ts 的头注释里。
 */
const sessions = createSessions()

/** 这一轮里必须独占后台的请求：都要跑几十秒到几分钟，都吃取消信号。 */
function isLongRun(request: Request): boolean {
  return request.kind === 'analyze' || request.kind === 'check_links'
}

chrome.runtime.onConnect.addListener((port) => {
  const clientId = clientIdFromPortName(port.name)
  if (clientId === null) return
  // 空串＝老侧栏没报身份（扩展刚更新还没重载）。退回匿名槽而不是拒连：
  // 拒了它连进度都收不到，比串台更糟。
  const id = clientId === '' ? ANONYMOUS_CLIENT : clientId
  sessions.attach(id, (event: ProgressEvent) => port.postMessage(event))
  // 侧栏的 keepalive ping：收到消息本身就会重置空闲计时，不需要回应
  port.onMessage.addListener(() => {})
  port.onDisconnect.addListener(() => sessions.detach(id))
})

chrome.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse) => {
  const { clientId, ...rest } = message
  const id = clientId ?? ANONYMOUS_CLIENT
  const request = rest as Request

  if (request.kind === 'cancel') {
    // 只掐自己那一轮。以前这里 abort 的是全局那一个 controller，
    // 在 A 窗口点取消会掐掉 B 窗口正在跑的分析。
    const stopped = sessions.cancel(id)
    if (stopped) {
      sessions.emit(id, { phase: 'classify', message: t('logCancelRequested'), level: 'warn' })
    }
    sendResponse({ ok: true, kind: 'cancel' })
    return false
  }

  if (isLongRun(request) && !sessions.beginRun(id)) {
    // 后台的撤销快照、分类缓存、i18n 语言都是单例，放第二轮并发进来会互相覆盖。
    // 说清楚比静默排队强：用户看得见是「另一个窗口占着」，而不是自己这边没反应。
    sendResponse({ ok: false, error: t('errAnotherWindowBusy') })
    return false
  }

  // 取消信号只给长任务。短请求（get_tree、save_settings 之类）一来一回就结束，
  // 把正在跑的那一轮的 signal 递给它们，只会让它们在用户点取消时莫名其妙地断掉。
  const signal = isLongRun(request) ? sessions.signal(id) : undefined

  handle(createChromePorts(), request, {
    // 进度只回发起这次请求的那个侧栏。apply、undo、import、cleanup 同样在报进度，
    // 所以路由按**请求**来，不是只管长任务那两种。
    onEvent: (event) => sessions.emit(id, event),
    isCancelled: () => sessions.isCancelled(id),
    ...(signal === undefined ? {} : { signal }),
  })
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }))
    .finally(() => {
      if (isLongRun(request)) sessions.endRun(id)
    })
  return true // 保持消息通道开启以支持异步响应
})
