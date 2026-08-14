import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '@/i18n'
import { applyDocumentLang } from '@/sidepanel/lib/documentLang'

/**
 * index.html 里的 lang 是个静态值，只能写死一种语言，而界面是双语的。
 * 英文界面下页面仍自称中文，屏幕阅读器会用中文发音去读英文，浏览器也可能
 * 弹出「是否翻译此页」。所以运行时按实际界面语言改写它。
 *
 * 语言来自 i18n 的模块级状态（用户可以在设置里选），不再是浏览器 UI 语言，
 * 所以这里用 setLocale 驱动。「浏览器语言怎么映射成 Locale」由
 * tests/i18n/index.test.ts 的 resolveLocale('auto') 用例覆盖。
 */
afterEach(() => setLocale('zh_CN'))

describe('applyDocumentLang', () => {
  it('中文界面下写成 zh-CN', () => {
    setLocale('zh_CN')
    applyDocumentLang()
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('英文界面下写成 en——这正是 index.html 静态值修不了的情况', () => {
    setLocale('en')
    applyDocumentLang()
    expect(document.documentElement.lang).toBe('en')
  })

  it('切回来时跟着变，不留着上一次的值', () => {
    setLocale('en')
    applyDocumentLang()
    setLocale('zh_CN')
    applyDocumentLang()
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('写出来的是合法 BCP 47 标签，不是 _locales 的目录名', () => {
    setLocale('zh_CN')
    applyDocumentLang()
    expect(document.documentElement.lang).not.toContain('_')
  })
})
