import { describe, it, expect } from 'vitest'
import { sanitizeUrl } from '@/core/sanitize'

describe('sanitizeUrl', () => {
  it('剥离 query 与 fragment', () => {
    expect(sanitizeUrl('https://internal.company.com/project/secret?id=123&token=abc#top'))
      .toEqual({ domain: 'internal.company.com', path: '/project/secret' })
  })

  it('去掉 www. 前缀并小写域名', () => {
    expect(sanitizeUrl('https://WWW.Example.COM/A/B')).toEqual({
      domain: 'example.com',
      path: '/A/B',
    })
  })

  it('去掉 URL 中的用户名密码', () => {
    expect(sanitizeUrl('https://user:pw@example.com/x')).toEqual({
      domain: 'example.com',
      path: '/x',
    })
  })

  it('根路径归一为 /', () => {
    expect(sanitizeUrl('https://react.dev')).toEqual({ domain: 'react.dev', path: '/' })
  })

  it('去掉路径末尾斜杠但保留根路径', () => {
    expect(sanitizeUrl('https://react.dev/learn/')).toEqual({ domain: 'react.dev', path: '/learn' })
  })

  it('非 http(s) 协议返回 null', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeUrl('chrome://bookmarks')).toBeNull()
    expect(sanitizeUrl('file:///Users/x/a.pdf')).toBeNull()
  })

  it('非法 URL 返回 null', () => {
    expect(sanitizeUrl('not a url')).toBeNull()
    expect(sanitizeUrl('')).toBeNull()
  })
})
