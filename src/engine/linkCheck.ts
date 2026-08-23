import { classifyError, classifyStatus, needsGetFallback, type LinkErrorKind, type LinkVerdict } from '@/core/deadlinks'
import { isCheckableUrl } from '@/core/url'

export interface LinkTarget {
  bookmarkId: string
  url: string
}

export interface LinkResult {
  bookmarkId: string
  url: string
  verdict: LinkVerdict
  /** 拿到状态码时填，超时或连不上时为 null。 */
  status: number | null
  errorKind: LinkErrorKind | null
}

export interface LinkCheckOptions {
  /** 网络依赖靠默认参数注入，做法与 llm/client.ts 一致，不动 core/ports.ts。 */
  fetchImpl?: typeof fetch
  concurrency?: number
  timeoutMs?: number
  signal?: AbortSignal
  onResult?: (result: LinkResult) => void
  onProgress?: (done: number, total: number) => void
}

const DEFAULT_CONCURRENCY = 6
const DEFAULT_TIMEOUT_MS = 10_000

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** 一条 URL 查一次，含 HEAD → GET 回退。任何异常都收进 LinkResult，不往上抛。 */
async function checkOne(
  target: LinkTarget,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  outer: AbortSignal | undefined,
): Promise<LinkResult> {
  const base = { bookmarkId: target.bookmarkId, url: target.url }

  const once = async (method: 'HEAD' | 'GET'): Promise<number> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
    const onOuterAbort = (): void => controller.abort(new Error('cancelled'))
    outer?.addEventListener('abort', onOuterAbort, { once: true })
    try {
      const response = await fetchImpl(target.url, { method, signal: controller.signal })
      return response.status
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    }
  }

  try {
    let status = await once('HEAD')
    // 服务器不认 HEAD 时才下正文。不一上来就 GET 是因为几百条书签的流量不小。
    if (needsGetFallback(status)) status = await once('GET')
    return { ...base, verdict: classifyStatus(status), status, errorKind: null }
  } catch (error) {
    // 超时与连不上分开报：界面要能说清「查了但没回」和「站可能真没了」。
    // 两者都归可疑，从不判死。
    const kind: LinkErrorKind = String(error).includes('timeout') ? 'timeout' : 'network'
    return { ...base, verdict: classifyError(kind), status: null, errorKind: kind }
  }
}

/**
 * 批量查链接。
 *
 * 限速的形状是「一个域名一条队，一条队一个工人」：按 host 分桶，起
 * `min(concurrency, 桶数)` 个工人，每个工人认领一个桶从头串到尾，做完再认领下一个。
 * 于是同域严格串行、全局并发不超上限，两件事由同一个结构同时保证，不需要额外的锁。
 *
 * 不限速的话同一个站几十条书签并发打过去很容易被 429 一锅端，
 * 那会造出一批纯属自己制造的「可疑」——删它等于自罚。
 *
 * 取消后**保留已经查到的结果**：查一千条要一分多钟，让用户中途停下来看看
 * 已经查出什么，比让他要么等完要么白等强。
 */
export async function checkLinks(
  targets: LinkTarget[],
  options: LinkCheckOptions = {},
): Promise<LinkResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const signal = options.signal

  const checkable = targets.filter((t) => isCheckableUrl(t.url))
  const total = checkable.length
  options.onProgress?.(0, total)

  const queues = new Map<string, LinkTarget[]>()
  for (const target of checkable) {
    const host = hostOf(target.url)
    const queue = queues.get(host)
    if (queue === undefined) queues.set(host, [target])
    else queue.push(target)
  }

  const buckets = [...queues.values()]
  let nextBucket = 0
  const results: LinkResult[] = []
  let done = 0

  // 包一层函数读 signal.aborted：直接内联 `signal?.aborted === true` 会被 tsc 的控制流分析
  // 误判成「跨 await 后仍是 false」而报 TS2367——它看不见其他并发 worker 会异步改这个值。
  const isAborted = (): boolean => signal?.aborted === true

  async function worker(): Promise<void> {
    for (;;) {
      if (isAborted()) return
      const bucket = buckets[nextBucket++]
      if (bucket === undefined) return
      for (const target of bucket) {
        if (isAborted()) return
        const result = await checkOne(target, fetchImpl, timeoutMs, signal)
        results.push(result)
        options.onResult?.(result)
        options.onProgress?.(++done, total)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, buckets.length) }, () => worker()),
  )
  return results
}
