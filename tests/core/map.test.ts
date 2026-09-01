import { describe, it, expect } from 'vitest'
import { buildCandidatesFromFolders, normalizeName, resolveByRules } from '@/core/map'
import type { RuleResult } from '@/core/rules'
import type { BookmarkItem, FolderItem } from '@/core/types'

const folders: FolderItem[] = [
  { id: '1', title: '书签栏', parentId: '0', index: 0, path: [], depth: 0, level: 0 },
  { id: '10', title: 'react', parentId: '1', index: 0, path: ['书签栏'], depth: 1, level: 1 },
  { id: '11', title: 'GitHub 项目', parentId: '1', index: 1, path: ['书签栏'], depth: 1, level: 1 },
  { id: '12', title: '论文', parentId: '1', index: 2, path: ['书签栏'], depth: 1, level: 1 },
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

  it('同父同名的目录只留一个候选——模型眼里它们是同一行，发几遍只会让它随机挑', () => {
    const folders = [
      { id: '10', title: '01 GitHub', parentId: '1', index: 0, path: [], depth: 1, level: 1 },
      { id: '11', title: '01 GitHub', parentId: '1', index: 1, path: [], depth: 1, level: 1 },
      { id: '12', title: '05 GitHub', parentId: '1', index: 2, path: [], depth: 1, level: 1 },
    ]
    const candidates = buildCandidatesFromFolders(folders, ['1'])
    expect(candidates).toHaveLength(1)
    // 树序第一个胜出——与 core/tree.ts 复用已有目录的规则同源
    expect(candidates[0]!.id).toBe('10')
  })

  it('不同父目录下的同名目录都留着——路径不同，模型分得清', () => {
    const folders = [
      { id: '100', title: '工具', parentId: '10', index: 0, path: ['前端'], depth: 2, level: 2 },
      { id: '110', title: '工具', parentId: '11', index: 0, path: ['后端'], depth: 2, level: 2 },
    ]
    expect(buildCandidatesFromFolders(folders, ['1'])).toHaveLength(2)
  })

  it('范围根照旧排除', () => {
    const folders = [
      { id: '1', title: '书签栏', parentId: '0', index: 0, path: [], depth: 0, level: 1 },
      { id: '10', title: 'GitHub', parentId: '1', index: 0, path: [], depth: 1, level: 1 },
    ]
    const candidates = buildCandidatesFromFolders(folders, ['1'])
    expect(candidates.map((c) => c.id)).toEqual(['10'])
  })
})

describe('resolveByRules', () => {
  const candidates = buildCandidatesFromFolders(folders, ['1'])

  /** 只有 placement 参与判定，tags 是给展示与建树用的，两者有意不同。 */
  const rule = (placement: string[], reason = 'r'): RuleResult =>
    ({ tags: placement, placement, resourceType: 'paper', reason, semantic: true })

  it('规则 tag 与候选叶子名归一化后相等时直接命中', () => {
    const result = resolveByRules(item(), rule(['论文']), candidates)!
    expect(result.targetCategoryId).toBe('12')
    expect(result.source).toBe('rule')
    expect(result.confidence).toBe(1)
  })

  it('多个 tag 时优先匹配更靠后的（更具体的）tag', () => {
    const result = resolveByRules(item(), rule(['GitHub 项目', 'react']), candidates)!
    expect(result.targetCategoryId).toBe('10')
  })

  it('多个叶子目录匹配同一规则 tag 时不确定归属', () => {
    const duplicateLeaves = [
      { id: '20', title: 'react', parentId: '2', index: 0, path: ['工作'], depth: 1, level: 1 },
      { id: '21', title: 'react', parentId: '3', index: 0, path: ['个人'], depth: 1, level: 1 },
    ]
    expect(resolveByRules(item(), rule(['react']), duplicateLeaves)).toBeNull()
  })

  it('没有任何候选匹配时返回 null，交给 LLM', () => {
    expect(resolveByRules(item(), rule(['视频']), candidates)).toBeNull()
  })

  it('命中时保留规则给出的原因', () => {
    const result = resolveByRules(item(), rule(['论文'], '域名规则 arxiv.org'), candidates)!
    expect(result.reason).toContain('arxiv.org')
  })

  /**
   * 平台名退让的落点：tags 里有「GitHub」、候选里也有个叫 GitHub 的目录，
   * 但它不在 placement 里，所以判不出归属，这条书签要交给模型。
   */
  it('只在 tags 里、不在 placement 里的名字不参与判定', () => {
    const ghFolders = [{ id: '30', path: ['17 GitHub'] }]
    const platformOnly: RuleResult = {
      tags: ['GitHub', 'facebook', 'react'],
      placement: ['facebook', 'react'],
      resourceType: 'repository',
      reason: 'r',
      semantic: false,
    }
    expect(resolveByRules(item(), platformOnly, ghFolders)).toBeNull()
  })
})
