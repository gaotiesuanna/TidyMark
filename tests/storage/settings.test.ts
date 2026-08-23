import { describe, it, expect } from 'vitest'
import {
  SETTINGS_KEY, loadSettings, saveSettings, loadCache, saveCache, DEFAULT_SETTINGS,
  MAX_CACHE_ENTRIES, PRESETS, endpointKey, activeLlm, type Endpoint, type Settings,
} from '@/storage/settings'
import { isLocalBaseUrl, isModelConfigured } from '@/llm/config'
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
    expect(settings.endpoints[0]!.apiKey).toBe('')
  })

  // 存量存储里可能躺着几代旧旋钮：maxTopFolders / maxFolderDepth 是被「按书签数推导形状」
  // 取代的（第 12 项删掉），allowSubfolders 是更早被 maxFolderDepth 取代的，
  // rebuildStructure 是被「每次现判走哪条路」取代的，enforceMinFolderSize / minFolderSize
  // 是被 core 里的内部常量 MIN_FOLDER_BOOKMARKS 取代的。一律读都不读——
  // 认任何一个都等于把删掉的旋钮偷偷留着。
  it('存量存储里的六个旧键一个都不读进来', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, {
      maxTopFolders: 6,
      maxFolderDepth: 1,
      allowSubfolders: false,
      rebuildStructure: true,
      enforceMinFolderSize: false,
      minFolderSize: 5,
    })
    const settings = await loadSettings(p)
    expect(settings).not.toHaveProperty('maxTopFolders')
    expect(settings).not.toHaveProperty('maxFolderDepth')
    expect(settings).not.toHaveProperty('allowSubfolders')
    expect(settings).not.toHaveProperty('rebuildStructure')
    expect(settings).not.toHaveProperty('enforceMinFolderSize')
    expect(settings).not.toHaveProperty('minFolderSize')
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

  // 原来验的是这两个旋钮的默认值（开着、3）。旋钮删掉后默认值无从谈起——下限退成
  // core 里的内部常量 MIN_FOLDER_BOOKMARKS，一律生效。但「默认设置里不该再冒出这两个键」
  // 这件事必须钉住：只要有人手滑把它们写回 DEFAULT_SETTINGS，旋钮就会连同默认值一起复活
  it('默认设置里不再有目录下限那两个键', async () => {
    const settings = await loadSettings(ports())
    expect(settings).not.toHaveProperty('enforceMinFolderSize')
    expect(settings).not.toHaveProperty('minFolderSize')
    expect(DEFAULT_SETTINGS).not.toHaveProperty('enforceMinFolderSize')
    expect(DEFAULT_SETTINGS).not.toHaveProperty('minFolderSize')
  })

  // 反向的那一半：上一条盯的是「关掉过的开关」，这一条盯的是「拧到别的数的阈值」。
  // 哪天有人给 minFolderSize 补一条映射，这里会红
  it('存量里单独躺着 minFolderSize=5 同样没有落点，读出来仍是默认设置', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { minFolderSize: 5 })
    expect(await loadSettings(p)).toEqual(DEFAULT_SETTINGS)
  })

  // 原来验的是「显式关掉的目录下限读得回来，不被默认值翻回去」。那个开关已经删掉——
  // 目录下限退成 core 里的内部常量，一律生效。问的仍是同一件事：**存量存储里躺着
  // 旧值时，产品的行为是什么。** 答案变了（从「读回来照办」变成「读都不读」），
  // 所以断言跟着改口径而不是消失。对照组用同一份空存量兜住两头
  it('存量里显式关掉的目录下限读都不读——跟没这两个键时一模一样', async () => {
    const legacy = ports()
    await legacy.storage.set(SETTINGS_KEY, { enforceMinFolderSize: false, minFolderSize: 5 })
    const clean = ports()
    await clean.storage.set(SETTINGS_KEY, {})
    const settings = await loadSettings(legacy)
    expect(settings).not.toHaveProperty('enforceMinFolderSize')
    expect(settings).not.toHaveProperty('minFolderSize')
    expect(settings).toEqual(await loadSettings(clean))
  })

  it('保存后能读回', async () => {
    const p = ports()
    await saveSettings(p, {
      ...DEFAULT_SETTINGS,
      endpoints: [{ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', models: ['deepseek-chat'] }],
      active: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      removeEmptyFolders: false,
    })
    const settings = await loadSettings(p)
    expect(settings.active.model).toBe('deepseek-chat')
    expect(settings.removeEmptyFolders).toBe(false)
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

describe('分类缓存条数上限', () => {
  const entryAt = (i: number): CachedClassification => ({
    targetPath: ['书签栏', 'react'], url: `https://example.com/${i}`, confidence: 0.9, reason: 'r',
  })

  /** 按 k0、k1…的顺序写入 count 条——Map 保插入顺序，这个顺序就是淘汰依据。 */
  function cacheOf(count: number): Map<string, CachedClassification> {
    const cache = new Map<string, CachedClassification>()
    for (let i = 0; i < count; i++) cache.set(`k${i}`, entryAt(i))
    return cache
  }

  it('超过上限时落盘条数恰好是 MAX_CACHE_ENTRIES', async () => {
    const p = ports()
    await saveCache(p, cacheOf(MAX_CACHE_ENTRIES + 5))
    expect((await loadCache(p)).size).toBe(MAX_CACHE_ENTRIES)
  })

  // 只断言条数的话，一个「留下最早那批」的实现照样绿——这条钉的是淘汰的方向。
  it('留下的是后写入的那批：最早的 5 条读不回来，最后写入的那条读得回来', async () => {
    const p = ports()
    await saveCache(p, cacheOf(MAX_CACHE_ENTRIES + 5))
    const cache = await loadCache(p)
    // 先证明这个查询本身有效：紧挨着被淘汰那 5 条的第 6 条必须还在，
    // 不然下面那串 has === false 在一个「什么都没存下」的实现里也全绿。
    expect(cache.get('k5')).toEqual(entryAt(5))
    for (let i = 0; i < 5; i++) expect(cache.has(`k${i}`)).toBe(false)
    expect(cache.get(`k${MAX_CACHE_ENTRIES + 4}`)).toEqual(entryAt(MAX_CACHE_ENTRIES + 4))
  })

  it('恰好等于上限时一条都不淘汰', async () => {
    const p = ports()
    await saveCache(p, cacheOf(MAX_CACHE_ENTRIES))
    const cache = await loadCache(p)
    expect(cache.size).toBe(MAX_CACHE_ENTRIES)
    expect(cache.has('k0')).toBe(true)
  })

  it('不足上限时一条不少，且写入顺序原样保留（顺序就是淘汰依据，乱了淘汰就错了）', async () => {
    const p = ports()
    await saveCache(p, cacheOf(3))
    const cache = await loadCache(p)
    expect([...cache.keys()]).toEqual(['k0', 'k1', 'k2'])
  })

  // 同一轮里 classifyBookmarks 还拿着这个 Map 在用，落盘时就地删条目
  // 等于在别人手里抽东西——截断只能截落盘的那一份。
  it('截断不动调用方传进来的那个 Map', async () => {
    const p = ports()
    const cache = cacheOf(MAX_CACHE_ENTRIES + 5)
    await saveCache(p, cache)
    expect(cache.size).toBe(MAX_CACHE_ENTRIES + 5)
    expect(cache.has('k0')).toBe(true)
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

/**
 * 预设填进去的是 baseUrl，不是完整端点——`src/llm/client.ts` 会自己接上
 * `/chat/completions`。而各家文档给的往往正是**完整端点**（OpenCode Go 的文档写的就是
 * `https://opencode.ai/zen/go/v1/chat/completions`），照抄粘进来就会拼成两遍，
 * 而那种错只有在真发请求时才暴露——正是这条守卫要提前抓住的。
 */
describe('供应商预设', () => {
  it('baseUrl 是端点前缀，不是完整端点', () => {
    expect(PRESETS.length).toBeGreaterThan(0) // 空断言防身：表空了下面的 for 什么也没验
    for (const preset of PRESETS) {
      expect(preset.baseUrl).not.toContain('/chat/completions')
      expect(preset.baseUrl.endsWith('/')).toBe(false) // 尾斜杠会拼出双斜杠
      expect(() => new URL(preset.baseUrl)).not.toThrow()
    }
  })

  it('每条预设都有非空的模型名——留空等于点了预设还得自己查文档', () => {
    expect(PRESETS.length).toBeGreaterThan(0)
    for (const preset of PRESETS) {
      expect(preset.model.trim()).not.toBe('')
      expect(preset.label.zh_CN.trim()).not.toBe('')
      expect(preset.label.en.trim()).not.toBe('')
    }
  })
})

describe('endpointKey', () => {
  it('末尾斜杠不算另一个端点', () => {
    expect(endpointKey('https://x/v1/')).toBe(endpointKey('https://x/v1'))
  })

  it('前后空白不算另一个端点', () => {
    expect(endpointKey('  https://x/v1  ')).toBe('https://x/v1')
  })
})

describe('activeLlm', () => {
  const base = {
    removeEmptyFolders: true, domainGroups: [], rewriteGithubTitles: false,
    uiLocale: 'auto' as const,
  }
  const withEndpoints = (
    endpoints: Endpoint[], active: { baseUrl: string; model: string },
  ): Settings => ({ ...base, endpoints, active })

  it('取出当前那一对，拼成 LlmConfig', () => {
    const settings = withEndpoints(
      [{ baseUrl: 'https://x/v1', apiKey: 'sk-x', models: ['a', 'b'] }],
      { baseUrl: 'https://x/v1', model: 'b' },
    )
    expect(activeLlm(settings)).toEqual({ baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'b' })
  })

  it('末尾斜杠不影响命中', () => {
    const settings = withEndpoints(
      [{ baseUrl: 'https://x/v1/', apiKey: 'sk-x', models: ['a'] }],
      { baseUrl: 'https://x/v1', model: 'a' },
    )
    expect(activeLlm(settings).apiKey).toBe('sk-x')
  })

  // 坏状态一律收敛成「还没配」：isModelConfigured 会判 false，界面落到已经存在、
  // 已经有用例的那个分支，六个消费方一行防御都不用写
  it('端点被删了时退回空 Key 的默认配置', () => {
    const settings = withEndpoints(
      [{ baseUrl: 'https://x/v1', apiKey: 'sk-x', models: ['a'] }],
      { baseUrl: 'https://gone/v1', model: 'a' },
    )
    expect(activeLlm(settings).apiKey).toBe('')
    expect(isModelConfigured(activeLlm(settings))).toBe(false)
  })

  it('模型不在这条端点的 models 里时同样退回', () => {
    const settings = withEndpoints(
      [{ baseUrl: 'https://x/v1', apiKey: 'sk-x', models: ['a'] }],
      { baseUrl: 'https://x/v1', model: 'gone' },
    )
    expect(activeLlm(settings).apiKey).toBe('')
  })

  it('一个端点都没有时退回', () => {
    expect(activeLlm(withEndpoints([], { baseUrl: '', model: '' })).apiKey).toBe('')
  })

  // 兜底的 baseUrl 若是本机地址，isModelConfigured 会放行空 Key，
  // 于是「端点被删了」会被判成「配好了的本机 Ollama」——那才是真的坏
  it('兜底的 baseUrl 不是本机地址', () => {
    const llm = activeLlm(withEndpoints([], { baseUrl: '', model: '' }))
    expect(isLocalBaseUrl(llm.baseUrl)).toBe(false)
  })
})

describe('从单套配置迁移', () => {
  it('存量的 llm 变成第一个端点、第一个模型，并且就是当前在用的那对', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, {
      llm: { baseUrl: 'https://x/v1', apiKey: 'sk-x', model: 'glm-5.2' },
      removeEmptyFolders: false,
    })
    const settings = await loadSettings(p)
    expect(settings.endpoints).toEqual([
      { baseUrl: 'https://x/v1', apiKey: 'sk-x', models: ['glm-5.2'] },
    ])
    expect(settings.active).toEqual({ baseUrl: 'https://x/v1', model: 'glm-5.2' })
    // 同一份存储里别的设置不受影响
    expect(settings.removeEmptyFolders).toBe(false)
  })

  it('全新安装拿到默认端点', async () => {
    const settings = await loadSettings(ports())
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings.endpoints[0]!.apiKey).toBe('')
  })

  // 迁移过一次之后存储里那个 llm 就是上一代的残留，
  // 再读它会把用户后来在端点表里做的修改盖回去
  it('已经有 endpoints 时不再看存量的 llm', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, {
      llm: { baseUrl: 'https://old/v1', apiKey: 'old', model: 'old' },
      endpoints: [{ baseUrl: 'https://new/v1', apiKey: 'new', models: ['new'] }],
      active: { baseUrl: 'https://new/v1', model: 'new' },
    })
    const settings = await loadSettings(p)
    expect(settings.endpoints).toHaveLength(1)
    expect(settings.endpoints[0]!.baseUrl).toBe('https://new/v1')
  })

  // 这条守的是一条崩溃路径，不是一个默认值：baseUrl 漏补的话，紧接着的
  // endpointKey(undefined) 会在 undefined.trim() 上抛异常，设置页直接打不开
  it('上一代那份 llm 残缺时逐字段补默认值', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { llm: { apiKey: 'sk-y' } })
    const settings = await loadSettings(p)

    expect(settings.endpoints).toEqual([{
      baseUrl: DEFAULT_SETTINGS.endpoints[0]!.baseUrl,
      apiKey: 'sk-y',
      models: [DEFAULT_SETTINGS.active.model],
    }])
    expect(() => activeLlm(settings)).not.toThrow()
    expect(activeLlm(settings).apiKey).toBe('sk-y')
  })

  it('存量的 modelHistory 读都不读', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, {
      modelHistory: [{ baseUrl: 'https://x/v1', model: 'a' }],
    })
    expect(await loadSettings(p)).toEqual(DEFAULT_SETTINGS)
  })
})
