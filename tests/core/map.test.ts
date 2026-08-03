import { describe, it, expect } from 'vitest'
import { buildCandidatesFromFolders, normalizeName, resolveByRules } from '@/core/map'
import type { BookmarkItem, FolderItem } from '@/core/types'

const folders: FolderItem[] = [
  { id: '1', title: '书签栏', parentId: '0', index: 0, path: [], depth: 0 },
  { id: '10', title: 'react', parentId: '1', index: 0, path: ['书签栏'], depth: 1 },
  { id: '11', title: 'GitHub 项目', parentId: '1', index: 1, path: ['书签栏'], depth: 1 },
  { id: '12', title: '论文', parentId: '1', index: 2, path: ['书签栏'], depth: 1 },
]

function item(): BookmarkItem {
  return { id: '100', title: 'T', url: 'https://x.dev', parentId: '10', index: 0, currentPath: [] }
}

describe('normalizeName', () => {
  it('忽略大小写、空格、下划线、连字符', () => {
    expect(normalizeName('GitHub 项目')).toBe(normalizeName('github项目'))
    expect(normalizeName('b_llm')).toBe(normalizeName('B-LLM'))
  })
})

describe('buildCandidatesFromFolders', () => {
  it('把范围内的文件夹转成候选，路径含自身标题', () => {
    const candidates = buildCandidatesFromFolders(folders, ['1'])
    expect(candidates).toContainEqual({ id: '10', path: ['书签栏', 'react'] })
  })

  it('排除范围根本身，因为把书签堆到根等于没整理', () => {
    const candidates = buildCandidatesFromFolders(folders, ['1'])
    expect(candidates.some((c) => c.id === '1')).toBe(false)
  })
})

describe('resolveByRules', () => {
  const candidates = buildCandidatesFromFolders(folders, ['1'])

  it('规则 tag 与候选叶子名归一化后相等时直接命中', () => {
    const result = resolveByRules(item(), { tags: ['论文'], resourceType: 'paper', reason: 'r' }, candidates)!
    expect(result.targetCategoryId).toBe('12')
    expect(result.source).toBe('rule')
    expect(result.confidence).toBe(1)
  })

  it('多个 tag 时优先匹配更靠后的（更具体的）tag', () => {
    const result = resolveByRules(
      item(),
      { tags: ['GitHub 项目', 'react'], resourceType: 'repository', reason: 'r' },
      candidates,
    )!
    expect(result.targetCategoryId).toBe('10')
  })

  it('没有任何候选匹配时返回 null，交给 LLM', () => {
    expect(resolveByRules(item(), { tags: ['视频'], resourceType: 'video', reason: 'r' }, candidates))
      .toBeNull()
  })

  it('命中时保留规则给出的原因', () => {
    const result = resolveByRules(item(), { tags: ['论文'], resourceType: 'paper', reason: '域名规则 arxiv.org' }, candidates)!
    expect(result.reason).toContain('arxiv.org')
  })
})
