import { describe, it, expect } from 'vitest'
import { isCheckableUrl, normalizeUrl } from '@/core/url'

describe('normalizeUrl 该剥的', () => {
  it('剥掉 # 片段', () => {
    expect(normalizeUrl('https://a.com/p#s2')).toBe(normalizeUrl('https://a.com/p'))
  })

  it('剥掉末尾斜杠', () => {
    expect(normalizeUrl('https://a.com/p/')).toBe(normalizeUrl('https://a.com/p'))
  })

  it('剥掉 utm_ 前缀的参数', () => {
    expect(normalizeUrl('https://a.com/p?utm_source=twitter&utm_medium=x'))
      .toBe(normalizeUrl('https://a.com/p'))
  })

  it('剥掉具名追踪参数', () => {
    for (const name of ['fbclid', 'gclid', 'ref', 'spm']) {
      expect(normalizeUrl(`https://a.com/p?${name}=abc`)).toBe(normalizeUrl('https://a.com/p'))
    }
  })

  it('剥掉追踪参数后保留其余参数', () => {
    expect(normalizeUrl('https://a.com/p?id=7&utm_source=x'))
      .toBe(normalizeUrl('https://a.com/p?id=7'))
  })
})

/**
 * 反例比正例重要：它们锁的是「不误伤」。放宽任何一条都会把两个不同的页面
 * 并成一组，而这一组的后果是永久删掉用户的书签。
 */
describe('normalizeUrl 不该剥的', () => {
  it('不统一 http 与 https', () => {
    expect(normalizeUrl('http://a.com/p')).not.toBe(normalizeUrl('https://a.com/p'))
  })

  it('不剥 www.', () => {
    expect(normalizeUrl('https://www.a.com/p')).not.toBe(normalizeUrl('https://a.com/p'))
  })

  it('不剥白名单之外的参数', () => {
    expect(normalizeUrl('https://a.com/p?id=123')).not.toBe(normalizeUrl('https://a.com/p'))
    expect(normalizeUrl('https://a.com/p?id=1')).not.toBe(normalizeUrl('https://a.com/p?id=2'))
  })

  it('不剥端口', () => {
    expect(normalizeUrl('https://a.com:8443/p')).not.toBe(normalizeUrl('https://a.com/p'))
  })

  it('路径大小写不同就是不同的页面', () => {
    expect(normalizeUrl('https://a.com/P')).not.toBe(normalizeUrl('https://a.com/p'))
  })

  it('根路径的那个斜杠不算末尾斜杠，剥了会跟别的域名形态混淆', () => {
    expect(normalizeUrl('https://a.com/')).toBe(normalizeUrl('https://a.com'))
  })
})

describe('normalizeUrl 解析不了的输入', () => {
  it('原样返回去掉首尾空白的字符串，让它只可能参与完全相同的分组', () => {
    expect(normalizeUrl('  not a url  ')).toBe('not a url')
  })
})

describe('isCheckableUrl', () => {
  it('http 与 https 可以查', () => {
    expect(isCheckableUrl('https://a.com')).toBe(true)
    expect(isCheckableUrl('http://a.com')).toBe(true)
  })

  it('其余协议一律不查', () => {
    for (const url of ['chrome://extensions', 'file:///tmp/a.html', 'javascript:void(0)', 'data:text/plain,x']) {
      expect(isCheckableUrl(url)).toBe(false)
    }
  })

  it('解析不了的不查', () => {
    expect(isCheckableUrl('not a url')).toBe(false)
  })
})
