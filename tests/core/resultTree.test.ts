import { describe, it, expect } from 'vitest'
import { buildPlan } from '@/core/plan'
import { buildResultTree } from '@/core/resultTree'
import type { BookmarkItem, CategoryCandidate, Classification, OrganizePlan } from '@/core/types'

const candidates: CategoryCandidate[] = [
  { id: 'tmp:1', path: ['AI'] },
  { id: 'tmp:2', path: ['AI', 'RAG'] },
  { id: '20', path: ['书签栏', '前端'] },
]

const items: BookmarkItem[] = [
  { id: '100', title: 'a', url: 'https://a', parentId: '1', index: 0, currentPath: ['书签栏'] },
  { id: '101', title: 'b', url: 'https://b', parentId: '1', index: 1, currentPath: ['书签栏'] },
  { id: '102', title: 'c', url: 'https://c', parentId: '1', index: 2, currentPath: ['书签栏'] },
  { id: '103', title: 'd', url: 'https://d', parentId: '1', index: 3, currentPath: ['书签栏'] },
]

const classifications: Classification[] = [
  { bookmarkId: '100', targetCategoryId: 'tmp:2', confidence: 1, reason: '', source: 'llm' },
  { bookmarkId: '101', targetCategoryId: 'tmp:2', confidence: 1, reason: '', source: 'llm' },
  { bookmarkId: '102', targetCategoryId: 'tmp:1', confidence: 1, reason: '', source: 'llm' },
  { bookmarkId: '103', targetCategoryId: '20', confidence: 1, reason: '', source: 'llm' },
]

function plan(): OrganizePlan {
  return buildPlan({
    id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
    items, candidates, classifications,
    newFolders: [
      { temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: 'AI' },
      { temporaryId: 'tmp:2', parentId: null, parentTemporaryId: 'tmp:1', title: 'RAG' },
    ],
  })
}

const all = new Set(['100', '101', '102', '103'])

describe('buildResultTree', () => {
  it('按路径还原层级并统计书签数', () => {
    const [ai] = buildResultTree(plan(), all)
    expect(ai?.title).toBe('AI')
    expect(ai?.count).toBe(1)
    expect(ai?.total).toBe(3)
    expect(ai?.children.map((c) => [c.title, c.total])).toEqual([['RAG', 2]])
  })

  it('标记本次新建的目录，已有目录不标记', () => {
    const roots = buildResultTree(plan(), all)
    const ai = roots.find((r) => r.title === 'AI')
    expect(ai?.isNew).toBe(true)
    expect(ai?.children[0]?.isNew).toBe(true)
    const bar = roots.find((r) => r.title === '书签栏')
    expect(bar?.isNew).toBe(false)
    expect(bar?.children[0]?.isNew).toBe(false)
  })

  it('未接受的书签不计入，空目录不出现', () => {
    const roots = buildResultTree(plan(), new Set(['103']))
    expect(roots.map((r) => r.title)).toEqual(['书签栏'])
    expect(roots[0]?.children.map((c) => c.total)).toEqual([1])
  })

  it('按书签总数从多到少排序', () => {
    const roots = buildResultTree(plan(), all)
    expect(roots.map((r) => r.title)).toEqual(['AI', '书签栏'])
  })
})
