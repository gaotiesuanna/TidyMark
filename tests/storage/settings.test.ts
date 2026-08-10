import { describe, it, expect } from 'vitest'
import { SETTINGS_KEY, loadSettings, saveSettings, loadCache, saveCache, DEFAULT_SETTINGS } from '@/storage/settings'
import { MAX_SIBLINGS } from '@/core/tree'
import { createFakeStorage } from '../fakes/fake-storage'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import type { Classification } from '@/core/types'

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

  it('默认一级目录上限等于 MAX_SIBLINGS，默认允许二级目录', async () => {
    const settings = await loadSettings(ports())
    expect(settings.maxTopFolders).toBe(MAX_SIBLINGS)
    expect(settings.allowSubfolders).toBe(true)
  })

  // 老用户存储里没有这两个键，缺字段必须回落默认值而不是 undefined，
  // 否则 MAX_SIBLINGS 会变成 undefined 一路传到 slice(0, undefined)
  it('旧数据缺这两个字段时回落默认值，已有字段不受影响', async () => {
    const p = ports()
    await p.storage.set(SETTINGS_KEY, { rebuildStructure: true })
    const settings = await loadSettings(p)
    expect(settings.maxTopFolders).toBe(MAX_SIBLINGS)
    expect(settings.allowSubfolders).toBe(true)
    expect(settings.rebuildStructure).toBe(true)
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
  const entry: Classification = {
    bookmarkId: '1', targetCategoryId: '10', confidence: 0.9, reason: 'r', source: 'llm',
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
