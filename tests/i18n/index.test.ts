import { afterEach, describe, expect, it } from 'vitest'
import { currentLocale, resolveLocale, setLocale, t } from '@/i18n'

const i18n = (globalThis as unknown as { chrome: { i18n: { getUILanguage: () => string } } })
  .chrome.i18n
const originalGetUILanguage = i18n.getUILanguage

afterEach(() => {
  i18n.getUILanguage = originalGetUILanguage
  setLocale('zh_CN') // 全局桩的约定语言，别污染同 project 里后面的测试文件
})

describe('resolveLocale', () => {
  it("'auto' 时跟随浏览器 UI 语言", () => {
    i18n.getUILanguage = () => 'en-US'
    expect(resolveLocale('auto')).toBe('en')
    i18n.getUILanguage = () => 'zh-CN'
    expect(resolveLocale('auto')).toBe('zh_CN')
  })

  it("'auto' 时认不出的语言落到 en，繁体归到 zh_CN", () => {
    i18n.getUILanguage = () => 'ja'
    expect(resolveLocale('auto')).toBe('en')
    i18n.getUILanguage = () => 'zh-TW'
    expect(resolveLocale('auto')).toBe('zh_CN')
  })

  it('显式取值时完全忽略浏览器语言——这正是本次改造的目的', () => {
    i18n.getUILanguage = () => 'zh-CN'
    expect(resolveLocale('en')).toBe('en')
    i18n.getUILanguage = () => 'en-US'
    expect(resolveLocale('zh_CN')).toBe('zh_CN')
  })
})

describe('setLocale / t', () => {
  it('setLocale 之后 t() 取的是对应语言的词条', () => {
    setLocale('en')
    expect(t('settingsTitle')).toBe('Settings')
    expect(currentLocale()).toBe('en')
    setLocale('zh_CN')
    expect(t('settingsTitle')).toBe('设置')
    expect(currentLocale()).toBe('zh_CN')
  })

  it('带占位符的词条按当前语言插值', () => {
    setLocale('en')
    expect(t('logScanDone', '12', '3')).toContain('12')
  })
})
