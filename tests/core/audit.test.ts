import { describe, it, expect } from 'vitest'
import { collapseSameNameFolders } from '@/core/audit'
import type { CollapseInput } from '@/core/audit'
import type { NewFolderSpec } from '@/core/plan'
import type { CategoryCandidate, Classification } from '@/core/types'

const rootId = 'root'
/** 范围根自己就叫「01 GitHub」——用户截图里的那一格。 */
const existingFolders = [{ id: rootId, title: '01 GitHub' }]

function cand(id: string, path: string[], domainGroup?: string): CategoryCandidate {
  return domainGroup === undefined ? { id, path } : { id, path, domainGroup }
}
function top(temporaryId: string, title: string): NewFolderSpec {
  return { temporaryId, parentId: rootId, parentTemporaryId: null, title }
}
function child(temporaryId: string, parentTemporaryId: string, title: string): NewFolderSpec {
  return { temporaryId, parentId: null, parentTemporaryId, title }
}
function into(targetCategoryId: string | null, n: number): Classification[] {
  return Array.from({ length: n }, (_, i) => ({
    bookmarkId: `${targetCategoryId}#${i}`,
    targetCategoryId,
    confidence: 0.9,
    reason: '模型判断',
    source: 'llm' as const,
  }))
}
function collapse(input: Partial<CollapseInput> & Pick<CollapseInput, 'candidates' | 'newFolders'>) {
  return collapseSameNameFolders({
    classifications: [],
    existingFolders,
    mergeRootTemporaryId: null,
    ...input,
  })
}

describe('collapseSameNameFolders', () => {
  it('范围根叫 GitHub 时，组目录「01 GitHub」被塌掉，子目录上提并重编号', () => {
    const result = collapse({
      candidates: [
        cand('tmp:1', ['01 GitHub'], 'github'),
        cand('tmp:2', ['01 GitHub', '01 软件工程'], 'github'),
        cand('tmp:3', ['01 GitHub', '02 大模型'], 'github'),
      ],
      newFolders: [top('tmp:1', '01 GitHub'), child('tmp:2', 'tmp:1', '01 软件工程'), child('tmp:3', 'tmp:1', '02 大模型')],
      classifications: [...into('tmp:1', 2), ...into('tmp:2', 5)],
    })

    expect(result.collapsedTitles).toEqual(['01 GitHub'])
    expect(result.newFolders.map((f) => f.title)).toEqual(['01 软件工程', '02 大模型'])
    // 子目录改挂范围根这个真实目录
    expect(result.newFolders.every((f) => f.parentId === rootId && f.parentTemporaryId === null)).toBe(true)
    // path 摘掉被塌掉的那一节
    expect(result.candidates.map((c) => c.path)).toEqual([['01 软件工程'], ['02 大模型']])
    // 原本挂在组根上的书签改指范围根
    expect(result.classifications.filter((c) => c.targetCategoryId === rootId)).toHaveLength(2)
    expect(result.classifications.filter((c) => c.targetCategoryId === 'tmp:2')).toHaveLength(5)
  })

  it('编号不同但基名相同照样算同名', () => {
    const result = collapse({
      candidates: [cand('tmp:1', ['07 GitHub'])],
      newFolders: [top('tmp:1', '07 GitHub')],
    })
    expect(result.collapsedTitles).toEqual(['07 GitHub'])
  })

  it('父子不同名时原样返回', () => {
    const result = collapse({
      candidates: [cand('tmp:1', ['01 前端'])],
      newFolders: [top('tmp:1', '01 前端')],
    })
    expect(result.collapsedTitles).toEqual([])
    expect(result.newFolders.map((f) => f.title)).toEqual(['01 前端'])
  })

  it('用户已有的同名目录不动——它不在 newFolders 里', () => {
    const result = collapseSameNameFolders({
      candidates: [cand('real-1', ['01 GitHub'])],
      newFolders: [],
      classifications: [],
      existingFolders: [...existingFolders, { id: 'real-1', title: '01 GitHub' }],
      mergeRootTemporaryId: null,
    })
    expect(result.collapsedTitles).toEqual([])
    expect(result.candidates).toHaveLength(1)
  })

  it('合并模式的容器目录不动', () => {
    const result = collapse({
      candidates: [cand('tmp:1', ['01 GitHub'])],
      newFolders: [top('tmp:1', '01 GitHub')],
      mergeRootTemporaryId: 'tmp:1',
    })
    expect(result.collapsedTitles).toEqual([])
  })

  it('连续两层同名迭代到不动点', () => {
    const result = collapse({
      candidates: [
        cand('tmp:1', ['01 GitHub']),
        cand('tmp:2', ['01 GitHub', '01 GitHub']),
        cand('tmp:3', ['01 GitHub', '01 GitHub', '01 软件工程']),
      ],
      newFolders: [
        top('tmp:1', '01 GitHub'),
        child('tmp:2', 'tmp:1', '01 GitHub'),
        child('tmp:3', 'tmp:2', '01 软件工程'),
      ],
    })
    expect(result.collapsedTitles).toEqual(['01 GitHub', '01 GitHub'])
    expect(result.newFolders.map((f) => f.title)).toEqual(['01 软件工程'])
    expect(result.candidates.map((c) => c.path)).toEqual([['01 软件工程']])
  })

  it('domainGroup 标记由子目录继承', () => {
    const result = collapse({
      candidates: [cand('tmp:1', ['01 GitHub'], 'github'), cand('tmp:2', ['01 GitHub', '01 软件工程'])],
      newFolders: [top('tmp:1', '01 GitHub'), child('tmp:2', 'tmp:1', '01 软件工程')],
    })
    expect(result.candidates[0]?.domainGroup).toBe('github')
  })
})
