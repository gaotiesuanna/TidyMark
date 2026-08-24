import { describe, it, expect } from 'vitest'
import { promoteFallbackChildren, promotedReason } from '@/core/audit'
import type { NewFolderSpec } from '@/core/plan'
import type { CategoryCandidate, Classification } from '@/core/types'

const rootId = 'root'

function cand(id: string, path: string[]): CategoryCandidate {
  return { id, path }
}
function spec(temporaryId: string, parent: { id?: string; tmp?: string }, title: string): NewFolderSpec {
  return {
    temporaryId,
    parentId: parent.id ?? null,
    parentTemporaryId: parent.tmp ?? null,
    title,
  }
}
function into(targetCategoryId: string, n: number): Classification[] {
  return Array.from({ length: n }, (_, i) => ({
    bookmarkId: `${targetCategoryId}#${i}`,
    targetCategoryId,
    confidence: 0.9,
    reason: '原来的理由',
    source: 'llm' as const,
  }))
}

/**
 * 「05 其他」下面切出两个够格的族（量化交易 5 条、Zotero 4 条），
 * 外加 3 条真零碎留在「其他」自己身上。
 */
function fixture() {
  return {
    locale: 'zh_CN' as const,
    candidates: [
      cand('tmp:1', ['01 甲']),
      cand('tmp:9', ['05 其他']),
      cand('tmp:10', ['05 其他', '01 量化交易']),
      cand('tmp:11', ['05 其他', '02 Zotero']),
    ],
    newFolders: [
      spec('tmp:1', { id: rootId }, '01 甲'),
      spec('tmp:9', { id: rootId }, '05 其他'),
      spec('tmp:10', { tmp: 'tmp:9' }, '01 量化交易'),
      spec('tmp:11', { tmp: 'tmp:9' }, '02 Zotero'),
    ],
    classifications: [
      ...into('tmp:1', 6), ...into('tmp:9', 3), ...into('tmp:10', 5), ...into('tmp:11', 4),
    ],
  }
}

describe('promoteFallbackChildren', () => {
  it('「其他」的子目录被提到一级，深度从 2 变 1', () => {
    const r = promoteFallbackChildren(fixture())
    const promoted = r.candidates.filter((c) => c.id === 'tmp:10' || c.id === 'tmp:11')
    expect(promoted.map((c) => c.path.length)).toEqual([1, 1])
    expect(promoted.map((c) => c.path[0])).toEqual(['01 量化交易', '02 Zotero'])
  })

  it('提上来的目录改挂「其他」原来的父，不再挂在「其他」下面', () => {
    const r = promoteFallbackChildren(fixture())
    for (const id of ['tmp:10', 'tmp:11']) {
      const f = r.newFolders.find((x) => x.temporaryId === id)!
      expect(f.parentTemporaryId).toBeNull()
      expect(f.parentId).toBe(rootId)
    }
  })

  it('提上来的排在「其他」前面——收容所留在最后一位才读得通', () => {
    const r = promoteFallbackChildren(fixture())
    const topIds = r.candidates.filter((c) => c.path.length === 1).map((c) => c.id)
    expect(topIds.indexOf('tmp:10')).toBeLessThan(topIds.indexOf('tmp:9'))
    expect(topIds.indexOf('tmp:11')).toBeLessThan(topIds.indexOf('tmp:9'))
    expect(topIds.at(-1)).toBe('tmp:9')
  })

  it('书签的理由改写成「本来要落进其他」，并带上这一族的条数', () => {
    const r = promoteFallbackChildren(fixture())
    const reason = r.classifications.find((c) => c.targetCategoryId === 'tmp:10')!.reason
    expect(reason).toContain('其他')
    expect(reason).toContain('5')
    // 没被提升的书签理由一个字都不改
    expect(r.classifications.find((c) => c.targetCategoryId === 'tmp:1')!.reason).toBe('原来的理由')
  })

  it('「其他」自己留在原地，装着没被映射上的那几条', () => {
    const r = promoteFallbackChildren(fixture())
    expect(r.candidates.some((c) => c.id === 'tmp:9')).toBe(true)
    expect(r.classifications.filter((c) => c.targetCategoryId === 'tmp:9')).toHaveLength(3)
  })

  it('报出提了哪几族、各多少条——A3 的警告要靠它说数字', () => {
    const r = promoteFallbackChildren(fixture())
    expect(r.promoted).toEqual([
      { title: '量化交易', count: 5 },
      { title: 'Zotero', count: 4 },
    ])
  })

  it('装不满 MIN_FOLDER_BOOKMARKS 的族不提，留在「其他」底下', () => {
    const base = fixture()
    const r = promoteFallbackChildren({
      ...base,
      classifications: [...into('tmp:1', 6), ...into('tmp:9', 3), ...into('tmp:10', 5), ...into('tmp:11', 2)],
    })
    expect(r.promoted.map((p) => p.title)).toEqual(['量化交易'])
    expect(r.candidates.find((c) => c.id === 'tmp:11')!.path).toEqual(['05 其他', '02 Zotero'])
  })

  it('没有「其他」时原样返回', () => {
    const base = fixture()
    const input = {
      ...base,
      candidates: [cand('tmp:1', ['01 甲'])],
      newFolders: [spec('tmp:1', { id: rootId }, '01 甲')],
      classifications: into('tmp:1', 6),
    }
    const r = promoteFallbackChildren(input)
    expect(r.promoted).toEqual([])
    expect(r.candidates).toEqual(input.candidates)
  })

  it('孙目录的 path 跟着上提一层', () => {
    const base = fixture()
    const r = promoteFallbackChildren({
      ...base,
      candidates: [...base.candidates, cand('tmp:12', ['05 其他', '01 量化交易', '01 A股'])],
      newFolders: [...base.newFolders, spec('tmp:12', { tmp: 'tmp:10' }, '01 A股')],
    })
    expect(r.candidates.find((c) => c.id === 'tmp:12')!.path).toEqual(['01 量化交易', '01 A股'])
  })
})

describe('promotedReason', () => {
  it('双语同源，都带条数', () => {
    expect(promotedReason('zh_CN', 12)).toContain('12')
    expect(promotedReason('zh_CN', 12)).toContain('其他')
    expect(promotedReason('en', 12)).toContain('12')
    expect(promotedReason('en', 12)).toContain('Other')
  })
})
