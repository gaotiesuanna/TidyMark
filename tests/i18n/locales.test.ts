import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCALES, type Locale } from '@/core/locale'
import type { Catalog } from '@/i18n/format'

/**
 * 故意不写成 `new URL('../../public/...', import.meta.url)`：Vite 会把这个字面
 * 写法当成静态资源引用特殊处理，命中 public/ 目录约定后被改写成
 * http://localhost:3000/_locales/... 这种 dev-server URL，导致读文件失败。
 * 改用 path.resolve 纯走 Node 文件系统语义，做法与 tests/setup/i18n.ts 一致。
 */
const here = dirname(fileURLToPath(import.meta.url))

function load(locale: Locale): Catalog {
  const path = resolve(here, `../../public/_locales/${locale}/messages.json`)
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog
}

function placeholderNames(catalog: Catalog, key: string): string[] {
  return Object.keys(catalog[key]?.placeholders ?? {}).map((n) => n.toLowerCase()).sort()
}

/** name -> content（如 "$2"），不只比名字集合——否则某个语言把 $1/$2 写反也测不出来。 */
function placeholderContents(catalog: Catalog, key: string): Record<string, string> {
  const declared = catalog[key]?.placeholders ?? {}
  const result: Record<string, string> = {}
  for (const [name, entry] of Object.entries(declared)) result[name.toLowerCase()] = entry.content
  return result
}

const catalogs = new Map(LOCALES.map((locale) => [locale, load(locale)]))

describe('_locales 一致性', () => {
  it('每个受支持的语言都有词条文件', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(catalogs.get(locale)!).length).toBeGreaterThan(0)
    }
  })

  it('两个语言的键集合完全一致——挡住只往一边加词条', () => {
    const [first, ...rest] = LOCALES
    const expected = Object.keys(catalogs.get(first!)!).sort()
    for (const locale of rest) {
      expect(Object.keys(catalogs.get(locale)!).sort()).toEqual(expected)
    }
  })

  it('同名键的占位符名集合一致——否则一种语言会漏掉插值', () => {
    const [first, ...rest] = LOCALES
    for (const key of Object.keys(catalogs.get(first!)!)) {
      const expected = placeholderNames(catalogs.get(first!)!, key)
      for (const locale of rest) {
        expect(placeholderNames(catalogs.get(locale)!, key)).toEqual(expected)
      }
    }
  })

  it('同名键的占位符 content 也要一致——只比名字集合的话，参数顺序被写反（比如 $1/$2 互换）也测不出来', () => {
    const [first, ...rest] = LOCALES
    for (const key of Object.keys(catalogs.get(first!)!)) {
      const expected = placeholderContents(catalogs.get(first!)!, key)
      for (const locale of rest) {
        expect(placeholderContents(catalogs.get(locale)!, key), `${locale} 的 ${key}`).toEqual(expected)
      }
    }
  })

  it('没有空词条——空串在界面上就是一片空白，且不会报错', () => {
    for (const locale of LOCALES) {
      for (const [key, entry] of Object.entries(catalogs.get(locale)!)) {
        expect(entry.message.trim(), `${locale} 的 ${key} 是空的`).not.toBe('')
      }
    }
  })

  it('英文词条里不该出现中文——出现了就是漏译', () => {
    const cjk = /[\u4e00-\u9fff]/
    for (const [key, entry] of Object.entries(catalogs.get('en')!)) {
      expect(cjk.test(entry.message), `en 的 ${key} 里混着中文：${entry.message}`).toBe(false)
    }
  })

  it('声明了占位符的词条，正文里必须真的用到它', () => {
    for (const locale of LOCALES) {
      for (const [key, entry] of Object.entries(catalogs.get(locale)!)) {
        for (const name of Object.keys(entry.placeholders ?? {})) {
          expect(entry.message.toLowerCase(), `${locale} 的 ${key} 没用到 $${name}$`)
            .toContain(`$${name.toLowerCase()}$`)
        }
      }
    }
  })
})

/**
 * 已经删掉的界面元素，不许再有文案指着它。
 *
 * 「推翻现有文件夹结构」那个开关随第 4 项（模式自动判断）一起删了，模式改由产品
 * 每轮现判。此后 errNoTargetFolders 因为指着它被修过一次，而 prefsGroupBody 与
 * reviewEmpty **漏了半年**——用户照着文案去界面上找，找不到。
 *
 * 这条守的不是某一句话的措辞，是「文案指向的东西必须真实存在」。将来再删掉别的
 * 界面元素，把它的名字加进下面这张表。
 */
const REMOVED_UI = [
  { zh: '推翻现有文件夹结构', en: 'Rebuild the folder structure', why: '第 4 项删掉的开关，模式现在自动判' },
]

describe('文案不许指向已删掉的界面元素', () => {
  for (const { zh, en, why } of REMOVED_UI) {
    it(`没有文案再提「${zh}」——${why}`, () => {
      const hits: string[] = []
      for (const locale of LOCALES) {
        const catalog = load(locale)
        for (const [key, entry] of Object.entries(catalog)) {
          if (entry.message.includes(zh) || entry.message.includes(en)) hits.push(`${locale}/${key}`)
        }
      }
      // 空断言防身：这张表本身不能是空的，否则这条用例什么也没查
      expect(REMOVED_UI.length).toBeGreaterThan(0)
      expect(hits).toEqual([])
    })
  }
})
