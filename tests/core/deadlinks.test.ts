import { describe, it, expect } from 'vitest'
import { classifyStatus, needsGetFallback } from '@/core/deadlinks'

describe('classifyStatus', () => {
  it('只有 404 与 410 是确定失效', () => {
    expect(classifyStatus(404)).toBe('dead')
    expect(classifyStatus(410)).toBe('dead')
  })

  it('2xx 与 3xx 是活着', () => {
    for (const s of [200, 204, 301, 302, 304, 308]) expect(classifyStatus(s)).toBe('alive')
  })

  /**
   * 每一条降级都有具体理由，不是「保守起见」：
   * 403 绝大多数是反爬虫在拦扩展的请求，页面本人好好活着；
   * 401 只是要登录，付费文章书签全在这一类；
   * 429 是我们自己请求太快惹的，删它等于自罚；
   * 5xx 是服务器今天不舒服，明天就好了。
   */
  it('401 403 429 5xx 一律降级成可疑，绝不判死', () => {
    for (const s of [400, 401, 403, 405, 418, 429, 500, 502, 503]) {
      expect(classifyStatus(s)).toBe('suspect')
    }
  })
})

describe('needsGetFallback', () => {
  it('405 与 501 表示服务器不认 HEAD，要补一次 GET', () => {
    expect(needsGetFallback(405)).toBe(true)
    expect(needsGetFallback(501)).toBe(true)
  })

  it('其余状态码不补', () => {
    for (const s of [200, 404, 403, 500]) expect(needsGetFallback(s)).toBe(false)
  })
})
