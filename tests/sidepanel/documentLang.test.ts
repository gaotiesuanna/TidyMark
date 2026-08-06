import { afterEach, describe, expect, it } from 'vitest'
import { applyDocumentLang } from '@/sidepanel/lib/documentLang'

/**
 * index.html 里的 lang 是个静态值，只能写死一种语言，而界面是双语的。
 * 英文界面下页面仍自称中文，屏幕阅读器会用中文发音去读英文，浏览器也可能
 * 弹出「是否翻译此页」。所以运行时按实际界面语言改写它。
 *
 * 全局桩（tests/setup/i18n.ts）的 getUILanguage 返回 zh-CN，这里逐例改写它，
 * afterEach 还原，免得污染同一 jsdom project 里后面的测试文件。
 */
const i18n = (globalThis as unknown as { chrome: { i18n: { getUILanguage: () => string } } }).chrome
  .i18n
const original = i18n.getUILanguage

afterEach(() => {
  i18n.getUILanguage = original
})

function withUILanguage(tag: string) {
  i18n.getUILanguage = () => tag
}

describe('applyDocumentLang', () => {
  it('中文界面下写成 zh-CN', () => {
    withUILanguage('zh-CN')
    applyDocumentLang()
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('英文界面下写成 en——这正是 index.html 静态值修不了的情况', () => {
    withUILanguage('en-US')
    applyDocumentLang()
    expect(document.documentElement.lang).toBe('en')
  })

  it('不支持的语言跟着 normalizeLocale 落到 en，而不是留着上一次的值', () => {
    withUILanguage('zh-TW')
    applyDocumentLang()
    expect(document.documentElement.lang).toBe('zh-CN')

    withUILanguage('ja')
    applyDocumentLang()
    expect(document.documentElement.lang).toBe('en')
  })

  it('写出来的是合法 BCP 47 标签，不是 _locales 的目录名', () => {
    withUILanguage('zh-CN')
    applyDocumentLang()
    expect(document.documentElement.lang).not.toContain('_')
  })
})
