import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCALES, type Locale } from '@/core/locale'
import type { Catalog } from '../setup/fake-i18n'

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

  it('没有空词条——空串在界面上就是一片空白，且不会报错', () => {
    for (const locale of LOCALES) {
      for (const [key, entry] of Object.entries(catalogs.get(locale)!)) {
        expect(entry.message.trim(), `${locale} 的 ${key} 是空的`).not.toBe('')
      }
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
