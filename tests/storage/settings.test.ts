import { describe, it, expect } from 'vitest'
import { SETTINGS_KEY, loadSettings, saveSettings, loadCache, saveCache, DEFAULT_SETTINGS } from '@/storage/settings'
import { createFakeStorage } from '../fakes/fake-storage'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import type { CachedClassification } from '@/core/types'

function ports() {
  return { bookmarks: createFakeBookmarks([]).api, storage: createFakeStorage() }
}

describe('设置存取', () => {
  it('无设置时返回默认值', async () => {
    const settings = await loadSettings(ports())
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings.llm.apiKey).toBe('')
  })

  // 存量存储里可能躺着四代旧旋钮：maxTopFolders / maxFolderDepth 是被「按书签数推导形状」
  // 取代的（第 12 项删掉），allowSubfolders 是更早被 maxFolderDepth 取代的，
  // rebuildStructure 是被「每次现判走哪条路」取代的。四个键一律读都不读——
  // 认任何一个都等于把删掉的旋钮偷偷留着。
  it('存量存储里的四个旧键一个都不读进来', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, {
      maxTopFolders: 6,
      maxFolderDepth: 1,
      allowSubfolders: false,
      rebuildStructure: true,
    })
    const settings = await loadSettings(p)
    expect(settings).not.toHaveProperty('maxTopFolders')
    expect(settings).not.toHaveProperty('maxFolderDepth')
    expect(settings).not.toHaveProperty('allowSubfolders')
    expect(settings).not.toHaveProperty('rebuildStructure')
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
  })

  it('默认开启整理后清理空文件夹', async () => {
    expect((await loadSettings(ports())).removeEmptyFolders).toBe(true)
  })

  // 原来验的是这两个旋钮的默认值（MAX_SIBLINGS 与 2）。旋钮删掉后默认值无从谈起，
  // 但「默认设置里不该再冒出这两个键」这件事必须钉住：只要有人手滑把它们写回
  // DEFAULT_SETTINGS，旋钮就会连同默认值一起复活
  it('默认设置里不再有同层上限与嵌套层数这两个旋钮', async () => {
    const settings = await loadSettings(ports())
    expect(settings).not.toHaveProperty('maxTopFolders')
    expect(settings).not.toHaveProperty('maxFolderDepth')
    expect(DEFAULT_SETTINGS).not.toHaveProperty('maxTopFolders')
    expect(DEFAULT_SETTINGS).not.toHaveProperty('maxFolderDepth')
  })

  // 原来验的是「老用户存储里缺这两个键时回落默认值，而不是 undefined 一路传到
  // slice(0, undefined)」。字段没了，但那条用例真正在防的事没变：存量记录只要形状
  // 不全，读出来的设置就必须仍是一份完整可用的设置。toEqual 同时兜住两头——
  // 少一个字段会漏，多冒出一个旧键也会漏
  it('存量记录是个空对象时，读出来仍是一份完整的默认设置', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, {})
    expect(await loadSettings(p)).toEqual(DEFAULT_SETTINGS)
  })

  // 下面三条问的还是同一件事：**存量存储里躺着旧值时，产品的行为是什么。**
  // 答案变了——从「翻译成 maxFolderDepth」变成「读都不读」，但问题没变，所以断言
  // 跟着改口径而不是消失。对照组用同一份空存量：只要旧键还能改动读出来的任何一个
  // 字段，两边就不相等。层数现在由书签量说了算，验在这一层的是 handlers 那两条

  it('存量里的 allowSubfolders=false 不再改变任何设置——跟没这个键时一模一样', async () => {
    const legacy = ports()
    await legacy.storage.set(SETTINGS_KEY, { allowSubfolders: false })
    const clean = ports()
    await clean.storage.set(SETTINGS_KEY, {})
    expect(await loadSettings(legacy)).toEqual(await loadSettings(clean))
  })

  // 这一条在旧实现下本来就是绿的（true 从来只走 undefined 分支、不改任何字段），
  // 它守的是反向：哪天有人给 true 补一条映射，这里会红
  it('存量里的 allowSubfolders=true 同样没有落点，读出来仍是默认设置', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { allowSubfolders: true })
    expect(await loadSettings(p)).toEqual(DEFAULT_SETTINGS)
  })

  // 原来验的是「新键在场时压过旧键，否则用户改不动设置」。现在这两个键都不是设置了，
  // 谁也压不过谁——一起躺在存量里也一起被丢掉
  it('两代旧键同时躺在存量里，也都进不来', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { allowSubfolders: false, maxFolderDepth: 3 })
    expect(await loadSettings(p)).toEqual(DEFAULT_SETTINGS)
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
    await p.storage.set(SETTINGS_KEY, {})
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
      removeEmptyFolders: false,
    })
    const settings = await loadSettings(p)
    expect(settings.llm.model).toBe('deepseek-chat')
    expect(settings.removeEmptyFolders).toBe(false)
  })

  it('部分字段缺失时用默认值补齐', async () => {
    const p = ports()
    await p.storage.set('tidymark:settings', { llm: { apiKey: 'sk-y' } })
    const settings = await loadSettings(p)
    expect(settings.llm.apiKey).toBe('sk-y')
    expect(settings.llm.baseUrl).toBe(DEFAULT_SETTINGS.llm.baseUrl)
  })

  // rebuildStructure 这个旧开关被自动判断（core/mode.ts）取代了：走哪条路现判，
  // 不再是设置项。这是刻意的决定——存量数据里躺着这个旧键必须一个字段都不影响，
  // loadSettings 逐字段构造返回对象，漏不回来，但这条刻意的决定得有测试守着，
  // 不然是下一个人可能"好心"想给它接回去的地方
  it('存量的 rebuildStructure 旧键有意不认，loadSettings 原样返回默认设置', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { rebuildStructure: true })
    expect(await loadSettings(p)).toEqual(DEFAULT_SETTINGS)
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

  it('带 topic 的条目往返保持一致', async () => {
    const p = ports()
    const withTopic: CachedClassification = {
      targetPath: null, url: 'https://weird.site/x', confidence: 0, reason: '无合适目录', topic: '语音合成',
    }
    await saveCache(p, new Map([['k1', withTopic]]))
    expect((await loadCache(p)).get('k1')).toEqual(withTopic)
  })

  it('topic 不是字符串的条目丢弃', async () => {
    const p = ports()
    await p.storage.set('tidymark:classify-cache', [
      ['bad', { targetPath: null, url: 'https://x.dev', confidence: 0, reason: 'r', topic: 42 }],
    ])
    expect((await loadCache(p)).size).toBe(0)
  })
})

describe('domainGroups 设置', () => {
  it('默认为空数组', async () => {
    expect((await loadSettings(ports())).domainGroups).toEqual([])
  })

  it('旧版本存档缺少该字段时补上默认值', async () => {
    const p = ports()
    await p.storage.set('tidymark:settings', {})
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
    await p.storage.set(SETTINGS_KEY, {})
    expect((await loadSettings(p)).uiLocale).toBe('auto')
  })

  it('存过的显式语言读得回来', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { uiLocale: 'en' })
    expect((await loadSettings(p)).uiLocale).toBe('en')
  })
})
