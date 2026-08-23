import { describe, it, expect, vi } from 'vitest'
import { checkLinks } from '@/engine/linkCheck'

/**
 * 可控的假 fetch：按 URL 给状态码，记录每次调用的方法。
 *
 * **必须真的理会 init.signal**——超时那条用例全靠它：checkOne 里的超时是
 * `controller.abort(new Error('timeout'))`，假 fetch 不 reject 的话请求会正常返回
 * 200，那条用例就永远测不出超时，还会绿着骗人。
 */
function fakeFetch(plan: Record<string, { status?: number; delayMs?: number; throws?: string }>) {
  const calls: { url: string; method: string }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    const entry = plan[url] ?? { status: 200 }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, entry.delayMs ?? 0)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(init.signal!.reason ?? new Error('aborted'))
      }, { once: true })
    })
    if (entry.throws !== undefined) throw new Error(entry.throws)
    return new Response(null, { status: entry.status ?? 200 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('checkLinks 判定', () => {
  it('404 判死，403 判可疑，200 判活', async () => {
    const f = fakeFetch({
      'https://a.com/1': { status: 404 },
      'https://b.com/1': { status: 403 },
      'https://c.com/1': { status: 200 },
    })
    const results = await checkLinks([
      { bookmarkId: '1', url: 'https://a.com/1' },
      { bookmarkId: '2', url: 'https://b.com/1' },
      { bookmarkId: '3', url: 'https://c.com/1' },
    ], { fetchImpl: f.impl })

    const byId = new Map(results.map((r) => [r.bookmarkId, r.verdict]))
    expect(byId.get('1')).toBe('dead')
    expect(byId.get('2')).toBe('suspect')
    expect(byId.get('3')).toBe('alive')
  })

  it('先发 HEAD', async () => {
    const f = fakeFetch({ 'https://a.com/1': { status: 200 } })
    await checkLinks([{ bookmarkId: '1', url: 'https://a.com/1' }], { fetchImpl: f.impl })
    expect(f.calls[0]!.method).toBe('HEAD')
  })

  it('HEAD 拿到 405 时补一次 GET，并按 GET 的结果判定', async () => {
    let first = true
    const impl = (async () => {
      const status = first ? 405 : 404
      first = false
      return new Response(null, { status })
    }) as unknown as typeof fetch

    const [result] = await checkLinks(
      [{ bookmarkId: '1', url: 'https://a.com/1' }],
      { fetchImpl: impl },
    )
    expect(result!.verdict).toBe('dead')
    expect(result!.status).toBe(404)
  })

  it('非 http(s) 的书签根本不发请求', async () => {
    const f = fakeFetch({})
    const results = await checkLinks(
      [{ bookmarkId: '1', url: 'chrome://extensions' }],
      { fetchImpl: f.impl },
    )
    expect(f.calls).toHaveLength(0)
    expect(results).toHaveLength(0)
  })

  it('抛异常归可疑，不判死', async () => {
    const f = fakeFetch({ 'https://a.com/1': { throws: 'ENOTFOUND' } })
    const [result] = await checkLinks(
      [{ bookmarkId: '1', url: 'https://a.com/1' }],
      { fetchImpl: f.impl },
    )
    expect(result!.verdict).toBe('suspect')
    expect(result!.errorKind).toBe('network')
  })

  it('超时归可疑', async () => {
    const f = fakeFetch({ 'https://a.com/1': { delayMs: 50 } })
    const [result] = await checkLinks(
      [{ bookmarkId: '1', url: 'https://a.com/1' }],
      { fetchImpl: f.impl, timeoutMs: 5 },
    )
    expect(result!.verdict).toBe('suspect')
    expect(result!.errorKind).toBe('timeout')
  })
})

describe('checkLinks 限速', () => {
  /**
   * 不限速的话同一个站几十条书签并发打过去很容易被 429 一锅端，
   * 那会造出一批纯属自己制造的「可疑」。
   */
  it('同一个域名严格串行', async () => {
    let inFlight = 0
    let peak = 0
    const impl = (async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    await checkLinks(
      Array.from({ length: 5 }, (_, i) => ({ bookmarkId: String(i), url: `https://a.com/${i}` })),
      { fetchImpl: impl },
    )
    expect(peak).toBe(1)
  })

  it('跨域名并发，但不超过上限', async () => {
    let inFlight = 0
    let peak = 0
    const impl = (async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    await checkLinks(
      Array.from({ length: 20 }, (_, i) => ({ bookmarkId: String(i), url: `https://h${i}.com/p` })),
      { fetchImpl: impl, concurrency: 6 },
    )
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
  })
})

describe('checkLinks 取消与进度', () => {
  it('取消后保留已经查到的结果', async () => {
    const controller = new AbortController()
    let count = 0
    const impl = (async () => {
      if (++count === 2) controller.abort()
      await new Promise((r) => setTimeout(r, 1))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const results = await checkLinks(
      Array.from({ length: 10 }, (_, i) => ({ bookmarkId: String(i), url: `https://h${i}.com/p` })),
      { fetchImpl: impl, signal: controller.signal, concurrency: 1 },
    )
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThan(10)
  })

  it('每条查完就回调一次，界面可以流式填结果', async () => {
    const f = fakeFetch({})
    const onResult = vi.fn()
    await checkLinks(
      [{ bookmarkId: '1', url: 'https://a.com/1' }, { bookmarkId: '2', url: 'https://b.com/1' }],
      { fetchImpl: f.impl, onResult },
    )
    expect(onResult).toHaveBeenCalledTimes(2)
  })
})
