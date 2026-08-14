import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOGS } from '@/i18n/messages'
import { LOCALES } from '@/core/locale'

/**
 * 这份测试盯的是「bundle 进来的词条」与「磁盘上的 _locales」是否同一份东西。
 * import 一旦被误改成别的路径、或将来有人另起一张手写表，键数会当场对不上。
 */
const here = dirname(fileURLToPath(import.meta.url))

describe('CATALOGS', () => {
  it('每个受支持语言都有一份非空词条', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(CATALOGS[locale]).length).toBeGreaterThan(0)
    }
  })

  it('内容与 public/_locales 下的文件逐字节一致——import 的就是那份文件', () => {
    for (const locale of LOCALES) {
      const path = resolve(here, `../../public/_locales/${locale}/messages.json`)
      const onDisk: unknown = JSON.parse(readFileSync(path, 'utf8'))
      expect(CATALOGS[locale]).toEqual(onDisk)
    }
  })
})
