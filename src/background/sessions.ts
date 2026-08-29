import type { ProgressEvent } from './events'

/**
 * 侧栏与 service worker 的多对一关系管理。
 *
 * Chrome 的侧栏是**每个浏览器窗口一个实例**，而 service worker 全局只有一个。
 * 这个模块存在之前，SW 里三样东西都是模块级单槽——一条 progressPort、一个
 * cancelled 标记、一个 AbortController——于是开两个窗口的侧栏会撞出两种事故：
 *
 * 1. 后连上的侧栏把 progressPort 顶掉，先开那个窗口的进度条与日志当场哑掉。
 *    正在跑的分析没停，但用户那边看起来就是卡死了。
 * 2. 在任一窗口点取消，abort 的是全局那一个 controller——掐掉的是**另一个窗口**
 *    那轮已经花了钱、跑了几分钟的分析。
 *
 * 这里按 clientId（每个侧栏文档启动时自己生成，见 sidepanel/lib/clientId.ts）
 * 把两件事分开：进度事件只推给发起那次请求的侧栏；取消只掐自己那一轮。
 *
 * 不做的事：**不支持两轮长任务同时跑**。SW 里还有一批真正的单例——撤销快照只有
 * 一个 SNAPSHOT_KEY、分类缓存是整块读写、i18n 的 setLocale 是模块级状态——放两轮
 * 并发进来，它们会互相覆盖，那是比进度串台严重得多的事故。所以第二个窗口想开跑时
 * 收到的是一句说得清的「另一个窗口正在忙」，而不是一次静默的互相破坏。
 */

/** 侧栏没报上身份时用的兜底 id（扩展刚更新、旧侧栏还没重载时会这样）。 */
export const ANONYMOUS_CLIENT = 'anonymous'

interface Run {
  clientId: string
  cancelled: boolean
  controller: AbortController
}

export interface Sessions {
  /** 侧栏连上来。post 由调用方绑到具体的 chrome.runtime.Port 上，本模块不碰 chrome。 */
  attach(clientId: string, post: (event: ProgressEvent) => void): void
  detach(clientId: string): void
  /** 把事件推给指定侧栏。对方不在（窗口关了）就丢掉——一次广播都不该发生。 */
  emit(clientId: string, event: ProgressEvent): void
  /**
   * 认领「当前唯一那一轮长任务」。别的侧栏正占着时返回 false，调用方据此回绝。
   * 同一个侧栏再次认领算重开一轮（换新的 controller），与改造前逐轮新建的行为一致。
   */
  beginRun(clientId: string): boolean
  /** 收工。只有持有者能清，晚到的收尾不会把别人刚开的那轮抹掉。 */
  endRun(clientId: string): void
  /** 取消自己那一轮。没有自己的那一轮时返回 false，调用方据此决定要不要打日志。 */
  cancel(clientId: string): boolean
  isCancelled(clientId: string): boolean
  /** 自己那一轮的取消信号；不持有当前这轮时为 undefined。 */
  signal(clientId: string): AbortSignal | undefined
}

export function createSessions(): Sessions {
  const posts = new Map<string, (event: ProgressEvent) => void>()
  let run: Run | null = null

  /** 持有当前这一轮的是不是它。所有按 clientId 的判断都从这一个谓词出发。 */
  const owns = (clientId: string): boolean => run !== null && run.clientId === clientId

  return {
    attach(clientId, post) {
      posts.set(clientId, post)
    },

    detach(clientId) {
      posts.delete(clientId)
      // 有意不动 run：侧栏关掉不等于要中止已经在跑的整理。它照常跑完，
      // 只是没人接进度了——这与改造前「postMessage 抛异常就丢掉」的行为一致。
      // run 会在自己结束时由 endRun 清掉，不会把后台永久占住。
    },

    emit(clientId, event) {
      const post = posts.get(clientId)
      if (post === undefined) return
      try {
        post(event)
      } catch {
        // 通道已断（侧栏关了但 onDisconnect 还没到）。丢掉这条事件并注销，
        // 不影响正在进行的整理。
        posts.delete(clientId)
      }
    },

    beginRun(clientId) {
      if (run !== null && run.clientId !== clientId) return false
      run = { clientId, cancelled: false, controller: new AbortController() }
      return true
    },

    endRun(clientId) {
      if (owns(clientId)) run = null
    },

    cancel(clientId) {
      if (!owns(clientId)) return false
      run!.cancelled = true
      run!.controller.abort()
      return true
    },

    isCancelled(clientId) {
      return owns(clientId) && run!.cancelled
    },

    signal(clientId) {
      return owns(clientId) ? run!.controller.signal : undefined
    },
  }
}
