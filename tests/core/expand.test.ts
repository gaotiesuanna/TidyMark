import { describe, it, expect } from 'vitest'
import { createTemporaryIdFactory, deepenReason, expandFolder } from '@/core/audit'
import type { CategoryCandidate, Classification, TagResult } from '@/core/types'

const parent: CategoryCandidate = { id: 'tmp:7', path: ['01 软件工程'] }

function tag(bookmarkId: string, primaryTopic: string): TagResult {
  return { bookmarkId, primaryTopic, secondaryTopic: null }
}
function classified(bookmarkId: string, targetCategoryId: string | null): Classification {
  return { bookmarkId, targetCategoryId, confidence: 0.9, reason: '模型判断', source: 'llm' }
}
function expand(tags: TagResult[], classifications: Classification[]) {
  return expandFolder({
    parent, tags, classifications,
    nextTemporaryId: createTemporaryIdFactory([{ temporaryId: 'tmp:7', parentId: 'root', parentTemporaryId: null, title: '01 软件工程' }]),
    count: 63, maxLeaf: 20, locale: 'zh_CN',
  })
}

describe('expandFolder', () => {
  it('按标签切出子目录，编号从 01 起，path 接在父目录后面', () => {
    const result = expand(
      [tag('a', '构建工具'), tag('b', '构建工具'), tag('c', '测试框架')],
      [classified('a', 'tmp:7'), classified('b', 'tmp:7'), classified('c', 'tmp:7')],
    )
    expect(result.createdCount).toBe(2)
    expect(result.newFolders.map((f) => f.title)).toEqual(['01 构建工具', '02 测试框架'])
    expect(result.newFolders.every((f) => f.parentTemporaryId === 'tmp:7' && f.parentId === null)).toBe(true)
    expect(result.candidates.map((c) => c.path)).toEqual([
      ['01 软件工程', '01 构建工具'],
      ['01 软件工程', '02 测试框架'],
    ])
  })

  it('子目录按装的条数从多到少排', () => {
    const result = expand(
      [tag('a', '少'), tag('b', '多'), tag('c', '多')],
      [classified('a', 'tmp:7'), classified('b', 'tmp:7'), classified('c', 'tmp:7')],
    )
    expect(result.newFolders.map((f) => f.title)).toEqual(['01 多', '02 少'])
  })

  it('书签改指子目录，理由说明的是「原来那个目录太撑」', () => {
    const result = expand(
      [tag('a', '构建工具'), tag('b', '测试框架')],
      [classified('a', 'tmp:7'), classified('b', 'tmp:7')],
    )
    const moved = result.classifications.find((c) => c.bookmarkId === 'a')!
    expect(moved.targetCategoryId).toBe(result.newFolders[0]?.temporaryId)
    expect(moved.reason).toBe('「软件工程」装了 63 个书签，超过单目录 20 个的上限，按主题再分一层')
  })

  it('没被映射到的书签留在父目录里', () => {
    const result = expand(
      [tag('a', '构建工具'), tag('b', '测试框架'), tag('c', '')],
      [classified('a', 'tmp:7'), classified('b', 'tmp:7'), classified('c', 'tmp:7')],
    )
    expect(result.createdCount).toBe(2)
    expect(result.classifications.find((c) => c.bookmarkId === 'c')?.targetCategoryId).toBe('tmp:7')
  })

  it('不属于这个父目录的书签一个字都不改', () => {
    const other = classified('z', 'tmp:9')
    const result = expand(
      [tag('a', '构建工具'), tag('b', '测试框架')],
      [classified('a', 'tmp:7'), classified('b', 'tmp:7'), other],
    )
    expect(result.createdCount).toBe(2)
    expect(result.classifications.find((c) => c.bookmarkId === 'z')).toEqual(other)
  })

  it('只切得出一个子目录时不切——那一层不承载任何区分度', () => {
    const result = expand(
      [tag('a', '构建工具'), tag('b', '构建工具')],
      [classified('a', 'tmp:7'), classified('b', 'tmp:7')],
    )
    expect(result.createdCount).toBe(0)
    expect(result.newFolders).toEqual([])
    expect(result.classifications.find((c) => c.bookmarkId === 'a')?.targetCategoryId).toBe('tmp:7')
  })

  it('新临时 id 续在已有 tmp:N 之后，不与建树阶段撞号', () => {
    const next = createTemporaryIdFactory([
      { temporaryId: 'tmp:3', parentId: 'root', parentTemporaryId: null, title: 'a' },
      { temporaryId: 'tmp:11', parentId: 'root', parentTemporaryId: null, title: 'b' },
    ])
    expect(next()).toBe('tmp:12')
    expect(next()).toBe('tmp:13')
  })
})

describe('deepenReason', () => {
  it('英文文案', () => {
    expect(deepenReason('en', '软件工程', 63, 20))
      .toBe('"软件工程" holds 63 bookmarks, over the per-folder limit of 20, so it was split by topic')
  })
})
