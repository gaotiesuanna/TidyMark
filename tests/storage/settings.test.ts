import { describe, it, expect } from 'vitest'
import { loadSettings, saveSettings, loadCache, saveCache, DEFAULT_SETTINGS } from '@/storage/settings'
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

  it('保存后能读回', async () => {
    const p = ports()
    await saveSettings(p, {
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
