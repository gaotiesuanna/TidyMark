import { describe, it, expect } from 'vitest'
import { sanitizeUrl } from '@/core/sanitize'

describe('sanitizeUrl', () => {
  it('剥离 query 与 fragment', () => {
    expect(sanitizeUrl('https://internal.company.com/project/secret?id=123&token=abc#top'))
      .toEqual({ domain: 'internal.company.com', host: 'internal.company.com', path: '/project/secret' })
  })

  it('去掉 www. 前缀并小写域名', () => {
    expect(sanitizeUrl('https://WWW.Example.COM/A/B')).toEqual({
      domain: 'example.com',
      host: 'example.com',
      path: '/A/B',
    })
  })

  it('去掉 URL 中的用户名密码', () => {
    expect(sanitizeUrl('https://user:pw@example.com/x')).toEqual({
      domain: 'example.com',
      host: 'example.com',
      path: '/x',
    })
  })

  it('根路径归一为 /', () => {
    expect(sanitizeUrl('https://react.dev')).toEqual({ domain: 'react.dev', host: 'react.dev', path: '/' })
  })

  it('去掉路径末尾斜杠但保留根路径', () => {
    expect(sanitizeUrl('https://react.dev/learn/'))
      .toEqual({ domain: 'react.dev', host: 'react.dev', path: '/learn' })
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

describe('sanitizeUrl 的 host', () => {
  it('带上端口，好把同一台机器上的不同服务分开', () => {
    expect(sanitizeUrl('http://localhost:5173/settings')?.host).toBe('localhost:5173')
    expect(sanitizeUrl('http://localhost:8501/settings/license')?.host).toBe('localhost:8501')
  })

  it('默认端口不写出来，普通网站的 host 和 domain 一样', () => {
    expect(sanitizeUrl('https://github.com:443/a')?.host).toBe('github.com')
    expect(sanitizeUrl('http://example.com:80/')?.host).toBe('example.com')
    expect(sanitizeUrl('https://github.com/a')?.host).toBe('github.com')
  })

  it('www. 照旧去掉，端口跟在后面', () => {
    expect(sanitizeUrl('http://www.example.com:8080/x')?.host).toBe('example.com:8080')
  })

  it('domain 不受影响——喂给模型的还是不带端口的域名', () => {
    expect(sanitizeUrl('http://localhost:5173/settings')?.domain).toBe('localhost')
  })
})
