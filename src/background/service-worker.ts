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
console.log('[Reshelve] service worker 启动', new Date().toISOString())

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

/**
 * 必须独占后台的请求。判准是「会不会动全局单例」，不是「跑得久不久」。
 *
 * analyze / check_links 是长任务，这好理解。真正容易漏的是后面四个：apply、undo、
 * import、apply_cleanup 全都在改**同一棵书签树**，而 apply 与 undo 还共用
 * engine/snapshot.ts 里唯一那个 SNAPSHOT_KEY——两个窗口同时落地，后写的快照会把
 * 先写的整个盖掉，于是先落地那一次**再也撤销不回去**。这比进度串台严重得多。
 *
 * analyze 也必须挡住 apply：分析产出的方案是对着某一刻的书签树算的，
 * 另一个窗口在这中间把树改了，那份方案落地时指向的 id 已经不是原来那个东西。
 *
 * 没进来的都是只读或瞬时的（get_tree、scan、cleanup_scan、test_model、list_models…），
 * 并发跑没有互相破坏的余地，挡住它们只会让另一个窗口连书签树都读不了。
 */
const EXCLUSIVE: ReadonlySet<Request['kind']> = new Set([
  'analyze', 'check_links', 'apply', 'undo', 'import', 'apply_cleanup',
])

/**
 * 独占任务里**吃取消信号**的那几种。
 *
 * 与 EXCLUSIVE 分开是必须的：apply / undo / import / apply_cleanup 从不读
 * isCancelled、不收 signal，界面也不给它们取消按钮。把它们一并当成可取消，
 * 换来的是「点了取消 → 日志说正在取消 → 它照样跑完」这种骗人的三连。
 */
const CANCELLABLE: ReadonlySet<Request['kind']> = new Set(['analyze', 'check_links'])

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

  const exclusive = EXCLUSIVE.has(request.kind)
  if (exclusive && !sessions.beginRun(id, CANCELLABLE.has(request.kind))) {
    // 说清楚比静默排队强：用户看得见是「另一个窗口占着」，而不是自己这边没反应。
    // 这一步是**在动手之前**回绝的，一个书签都没碰，所以再点一次是安全的——
    // 与 apply/undo 那几处「失败了不给重试入口」不是一回事，那些是可能已经改了一半。
    sendResponse({ ok: false, error: t('errAnotherWindowBusy') })
    return false
  }

  // 两道闸都要：sessions.signal 只回答「这个窗口那一轮可不可取消」，回答不了
  // 「眼下这条请求**是不是**那一轮」。少了 exclusive 这一道，同一个窗口在分析途中
  // 发的 get_settings 会拿到分析那一轮的 signal，用户点取消时它跟着莫名其妙地断掉。
  const signal = exclusive ? sessions.signal(id) : undefined

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
      if (exclusive) sessions.endRun(id)
    })
  return true // 保持消息通道开启以支持异步响应
})
