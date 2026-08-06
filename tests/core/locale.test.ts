import { describe, it, expect } from 'vitest'
import { LOCALES, normalizeLocale } from '@/core/locale'

describe('normalizeLocale', () => {
  it('中文的各种写法都归到 zh_CN', () => {
    expect(normalizeLocale('zh')).toBe('zh_CN')
    expect(normalizeLocale('zh-CN')).toBe('zh_CN')
    expect(normalizeLocale('zh_CN')).toBe('zh_CN')
    expect(normalizeLocale('zh-Hans')).toBe('zh_CN')
  })

  it('繁体也归到 zh_CN——只有一套中文词条，繁体读简体好过读英文', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh_CN')
    expect(normalizeLocale('zh-HK')).toBe('zh_CN')
  })

  it('英文的各种写法都归到 en', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('en-GB')).toBe('en')
  })

  it('大小写不敏感', () => {
    expect(normalizeLocale('ZH-cn')).toBe('zh_CN')
    expect(normalizeLocale('EN-us')).toBe('en')
  })

  it('不支持的语言落到 en——en 是 default_locale', () => {
    expect(normalizeLocale('fr')).toBe('en')
    expect(normalizeLocale('de-DE')).toBe('en')
    expect(normalizeLocale('ja')).toBe('en')
  })

  it('空串或异常输入也落到 en，不抛异常', () => {
    expect(normalizeLocale('')).toBe('en')
    expect(normalizeLocale('   ')).toBe('en')
  })

  it('LOCALES 列出全部支持的语言', () => {
    expect([...LOCALES].sort()).toEqual(['en', 'zh_CN'])
  })
})
