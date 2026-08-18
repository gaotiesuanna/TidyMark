import { describe, it, expect } from 'vitest'
import { SETTINGS_KEY, loadSettings, saveSettings, loadCache, saveCache, DEFAULT_SETTINGS } from '@/storage/settings'
import { MAX_SIBLINGS } from '@/core/tree'
import { createFakeStorage } from '../fakes/fake-storage'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import type { CachedClassification } from '@/core/types'

function ports() {
  return { bookmarks: createFakeBookmarks([]).api, storage: createFakeStorage() }
}

describe('设置存取', () => {
  it('无设置时返回默认值，且默认不推翻结构', async () => {
    const settings = await loadSettings(ports())
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings.rebuildStructure).toBe(false)
    expect(settings.llm.apiKey).toBe('')
  })

  it('默认开启整理后清理空文件夹', async () => {
    expect((await loadSettings(ports())).removeEmptyFolders).toBe(true)
  })

  it('默认同层目录上限等于 MAX_SIBLINGS，默认最深两层', async () => {
    const settings = await loadSettings(ports())
    expect(settings.maxTopFolders).toBe(MAX_SIBLINGS)
    expect(settings.maxFolderDepth).toBe(2)
  })

  // 老用户存储里没有这两个键，缺字段必须回落默认值而不是 undefined，
  // 否则 MAX_SIBLINGS 会变成 undefined 一路传到 slice(0, undefined)
  it('旧数据缺这两个字段时回落默认值，已有字段不受影响', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { rebuildStructure: true })
    const settings = await loadSettings(p)
    expect(settings.maxTopFolders).toBe(MAX_SIBLINGS)
    expect(settings.maxFolderDepth).toBe(2)
    expect(settings.rebuildStructure).toBe(true)
  })

  // allowSubfolders 这个布尔开关被 maxFolderDepth 取代了。上周关掉过它的人，
  // 存储里躺着 false；不认这个旧键就等于把他的选择静默翻回默认，
  // 而这是「会不会给我建二级目录」这种看得见的行为
  it('旧的 allowSubfolders=false 认成最深一层', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { allowSubfolders: false })
    expect((await loadSettings(p)).maxFolderDepth).toBe(1)
  })

  it('旧的 allowSubfolders=true 认成默认的两层', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { allowSubfolders: true })
    expect((await loadSettings(p)).maxFolderDepth).toBe(2)
  })

  // 新键存在时它说了算，不再看旧键——否则改不动设置
  it('新键存在时压过旧键', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { allowSubfolders: false, maxFolderDepth: 3 })
    expect((await loadSettings(p)).maxFolderDepth).toBe(3)
  })

  // 目录太小是这个功能要防的东西（一个目录里只躺一个链接），所以默认就开着
  it('默认开启目录下限，阈值 3', async () => {
    const settings = await loadSettings(ports())
    expect(settings.enforceMinFolderSize).toBe(true)
    expect(settings.minFolderSize).toBe(3)
  })

  // 旧存储里没有这两个键，回落默认值——也就是老用户下次整理会吃到这个新行为。
  // 这是「默认开」的必然结果，不是遗漏
  it('旧数据缺目录下限字段时回落默认值', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { rebuildStructure: true })
    const settings = await loadSettings(p)
    expect(settings.enforceMinFolderSize).toBe(true)
    expect(settings.minFolderSize).toBe(3)
  })

  it('显式关掉的目录下限读得回来，不被默认值翻回去', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { enforceMinFolderSize: false, minFolderSize: 5 })
    const settings = await loadSettings(p)
    expect(settings.enforceMinFolderSize).toBe(false)
    expect(settings.minFolderSize).toBe(5)
  })

  it('保存后能读回', async () => {
    const p = ports()
    await saveSettings(p, {
      ...DEFAULT_SETTINGS,
      llm: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: 'deepseek-chat' },
      rebuildStructure: true,
      removeEmptyFolders: false,
    })
    const settings = await loadSettings(p)
    expect(settings.llm.model).toBe('deepseek-chat')
    expect(settings.rebuildStructure).toBe(true)
  })

  it('部分字段缺失时用默认值补齐', async () => {
    const p = ports()
    await p.storage.set('tidymark:settings', { llm: { apiKey: 'sk-y' } })
    const settings = await loadSettings(p)
    expect(settings.llm.apiKey).toBe('sk-y')
    expect(settings.llm.baseUrl).toBe(DEFAULT_SETTINGS.llm.baseUrl)
    expect(settings.rebuildStructure).toBe(false)
  })
})

describe('分类缓存存取', () => {
  const entry: CachedClassification = {
    targetPath: ['书签栏', 'react'], url: 'https://react.dev', confidence: 0.9, reason: 'r',
  }

  it('无缓存时返回空 Map', async () => {
    expect((await loadCache(ports())).size).toBe(0)
  })

  it('往返保持一致', async () => {
    const p = ports()
    await saveCache(p, new Map([['k1', entry]]))
    const cache = await loadCache(p)
    expect(cache.get('k1')).toEqual(entry)
  })

  it('模型判「无合适目录」的 null 也能往返', async () => {
    const p = ports()
    const none: CachedClassification = {
      targetPath: null, url: 'https://weird.site/x', confidence: 0, reason: '没有合适的目录',
    }
    await saveCache(p, new Map([['k1', none]]))
    expect((await loadCache(p)).get('k1')).toEqual(none)
  })

  it('旧格式的存量条目一律丢弃，包括缺 url 字段的上一版（1b0a95b）写的条目', async () => {
    const p = ports()
    // 换 key 格式本身已经让旧条目不再命中，但它们的形状也不兼容，
    // 读出来会是个没有 targetPath / url 的对象——宁可当没缓存。
    // 'no-url' 模拟的是加 url 字段之前那版代码写下的条目：形状里没有 url，
    // 现在也一并当脏数据丢弃——同样是全量失效，不必单独兼容。
    await p.storage.set('tidymark:classify-cache', [
      ['old', { bookmarkId: '1', targetCategoryId: '10', confidence: 0.9, reason: 'r', source: 'llm' }],
      ['no-url', { targetPath: ['书签栏', 'react'], confidence: 0.9, reason: 'r' }],
      ['new', entry],
    ])
    const cache = await loadCache(p)
    expect(cache.has('old')).toBe(false)
    expect(cache.has('no-url')).toBe(false)
    expect(cache.get('new')).toEqual(entry)
  })

  it('存储里躺着完全不是数组的东西时不炸', async () => {
    const p = ports()
    await p.storage.set('tidymark:classify-cache', { junk: true })
    expect((await loadCache(p)).size).toBe(0)
  })
})

describe('domainGroups 设置', () => {
  it('默认为空数组', async () => {
    expect((await loadSettings(ports())).domainGroups).toEqual([])
  })

  it('旧版本存档缺少该字段时补上默认值', async () => {
    const p = ports()
    await p.storage.set('tidymark:settings', { rebuildStructure: true })
    expect((await loadSettings(p)).domainGroups).toEqual([])
  })

  it('保存后能读回', async () => {
    const p = ports()
    await saveSettings(p, { ...DEFAULT_SETTINGS, domainGroups: ['github', 'paper'] })
    expect((await loadSettings(p)).domainGroups).toEqual(['github', 'paper'])
  })
})

describe('uiLocale', () => {
  it('默认跟随浏览器', () => {
    expect(DEFAULT_SETTINGS.uiLocale).toBe('auto')
  })

  it('旧数据里没有这个字段时兜底成 auto——不需要迁移代码', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { rebuildStructure: true })
    expect((await loadSettings(p)).uiLocale).toBe('auto')
  })

  it('存过的显式语言读得回来', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { uiLocale: 'en' })
    expect((await loadSettings(p)).uiLocale).toBe('en')
  })
})
