import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadFavicons } from '@/sidepanel/lib/favicons'

/** Chrome 查不到图标时回的那张兜底灰地球，所有 pageUrl 拿到的都是同一份字节。 */
const FALLBACK_BYTES = 'chrome-default-globe'

/** 实现里用来探兜底图标的那个保留域名，测试要认得它才好模拟。 */
const PROBE_HOST = 'https://tidymark-favicon-probe.invalid/'

let requested: string[]

/**
 * 按 pageUrl 决定返回什么：给了字节就返回图片，给了 null 就 404。
 * 没配置的 pageUrl 一律返回兜底图标——这正是真实 _favicon/ 的行为。
 */
let responses: Map<string, string | null>

/**
 * body 必须是 Uint8Array 而不是 Blob：jsdom 的 Blob 交给 undici 的 Response 之后
 * 会被当普通对象 toString 成 "[object Blob]"，于是每个响应的字节都一样，
 * 兜底指纹会把全部图标误杀，测试就测不出真实行为了。
 */
function imageResponse(bytes: string): Response {
  return new Response(new TextEncoder().encode(bytes), {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  })
}

beforeEach(() => {
  requested = []
  responses = new Map()
  ;(globalThis as { chrome?: Record<string, unknown> }).chrome = {
    ...(globalThis as { chrome?: Record<string, unknown> }).chrome,
    runtime: { getURL: (path: string) => `chrome-extension://fakeid${path}` },
  }
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const pageUrl = url.searchParams.get('pageUrl') ?? ''
    requested.push(pageUrl)
    const bytes = responses.has(pageUrl) ? responses.get(pageUrl)! : FALLBACK_BYTES
    if (bytes === null) return new Response(null, { status: 404 })
    return imageResponse(bytes)
  }) as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadFavicons', () => {
  it('拿到的图标是可直接写进 ICON 属性的 data URL', async () => {
    responses.set('https://figma.com', 'figma-icon')
    const icons = await loadFavicons(['https://figma.com'])
    expect(icons.get('https://figma.com')).toMatch(/^data:image\/png;base64,/)
  })

  it('查不到图标的书签不进结果——Chrome 回的是兜底图标而不是 404', async () => {
    responses.set('https://figma.com', 'figma-icon')
    const icons = await loadFavicons(['https://figma.com', 'https://no-icon.test'])
    expect(icons.has('https://figma.com')).toBe(true)
    expect(icons.has('https://no-icon.test')).toBe(false)
  })

  it('取图标失败的那条被跳过，不连累其他条', async () => {
    responses.set('https://boom.test', null)
    responses.set('https://figma.com', 'figma-icon')
    const icons = await loadFavicons(['https://boom.test', 'https://figma.com'])
    expect(icons.has('https://boom.test')).toBe(false)
    expect(icons.has('https://figma.com')).toBe(true)
  })

  it('fetch 抛异常同样只跳过那一条', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const pageUrl = new URL(String(input)).searchParams.get('pageUrl') ?? ''
      if (pageUrl === 'https://boom.test') throw new Error('network')
      // 探针与真书签必须拿到不同字节，否则会被兜底指纹当成「没有图标」滤掉
      return imageResponse(pageUrl === PROBE_HOST ? FALLBACK_BYTES : 'figma-icon')
    }) as typeof fetch

    const icons = await loadFavicons(['https://boom.test', 'https://figma.com'])
    expect(icons.has('https://boom.test')).toBe(false)
    expect(icons.has('https://figma.com')).toBe(true)
  })

  it('重复 URL 只查一次——书签库里同一个站会出现很多遍', async () => {
    responses.set('https://figma.com', 'figma-icon')
    await loadFavicons(['https://figma.com', 'https://figma.com', 'https://figma.com'])
    expect(requested.filter((u) => u === 'https://figma.com')).toHaveLength(1)
  })

  it('只查 http/https，javascript: 之类不送进 _favicon', async () => {
    await loadFavicons(['javascript:alert(1)', 'chrome://settings', 'file:///tmp/a.html'])
    expect(requested).not.toContain('javascript:alert(1)')
    expect(requested).not.toContain('chrome://settings')
    expect(requested).not.toContain('file:///tmp/a.html')
  })

  it('查的是扩展自己的 _favicon/ 端点，不发任何外部网络请求', async () => {
    responses.set('https://figma.com', 'figma-icon')
    await loadFavicons(['https://figma.com'])
    const calls = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]))
    expect(calls.length).toBeGreaterThan(0)
    for (const url of calls) expect(url.startsWith('chrome-extension://fakeid/_favicon/')).toBe(true)
  })

  it('空输入不发请求', async () => {
    const icons = await loadFavicons([])
    expect(icons.size).toBe(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
