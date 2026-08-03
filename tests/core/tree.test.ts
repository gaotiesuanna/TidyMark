import { describe, it, expect } from 'vitest'
import { buildCategoryTree, MIN_FOLDER_SIZE, MAX_SIBLINGS } from '@/core/tree'
import type { TagResult } from '@/core/types'

function tags(spec: Array<[string, string, string | null]>): TagResult[] {
  return spec.map(([bookmarkId, primaryTopic, secondaryTopic]) => ({
    bookmarkId, primaryTopic, secondaryTopic,
  }))
}

const rootId = '1'

describe('buildCategoryTree', () => {
  it('数量达标的主题生成独立一级目录', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), '前端', null] as [string, string, null])
    const { candidates, newFolders } = buildCategoryTree({ tags: tags(many), rootId, existingFolders: [] })
    expect(newFolders.some((f) => f.title === '前端')).toBe(true)
    expect(candidates.some((c) => c.path.at(-1) === '前端')).toBe(true)
  })

  it('数量不足的主题合并进「其他」', () => {
    const { newFolders } = buildCategoryTree({
      tags: tags([['1', '冷门主题', null], ['2', '另一个冷门', null]]),
      rootId, existingFolders: [],
    })
    expect(newFolders.map((f) => f.title)).toContain('其他')
    expect(newFolders.some((f) => f.title === '冷门主题')).toBe(false)
  })

  it('二级主题数量达标时生成子目录', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 6 }, (_, i) => ['a' + i, '前端', 'React'] as [string, string, string]),
      ...Array.from({ length: 6 }, (_, i) => ['b' + i, '前端', 'Vue'] as [string, string, string]),
    ]
    const { candidates } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    expect(candidates.some((c) => c.path.join('/') === '前端/React')).toBe(true)
    expect(candidates.some((c) => c.path.join('/') === '前端/Vue')).toBe(true)
  })

  it('同义主题名归一化后合并', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 3 }, (_, i) => ['a' + i, 'LLM', null] as [string, string, null]),
      ...Array.from({ length: 3 }, (_, i) => ['b' + i, 'l l m', null] as [string, string, null]),
    ]
    const { newFolders } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    expect(newFolders.filter((f) => f.parentTemporaryId === null && f.title !== '其他')).toHaveLength(1)
  })

  it('复用同名的现有文件夹标题，而不是另起名字', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), 'llm', null] as [string, string, null])
    const { newFolders } = buildCategoryTree({
      tags: tags(many), rootId, existingFolders: ['LLM 学习'],
    })
    expect(newFolders.some((f) => f.title === 'LLM 学习')).toBe(false)
    expect(newFolders.some((f) => f.title === 'llm')).toBe(true)
  })

  it('同一层目录数量不超过上限，超出部分并入「其他」', () => {
    const spec = Array.from({ length: (MAX_SIBLINGS + 4) * MIN_FOLDER_SIZE }, (_, i) => [
      String(i), `主题${Math.floor(i / MIN_FOLDER_SIZE)}`, null,
    ] as [string, string, null])
    const { newFolders } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    const topLevel = newFolders.filter((f) => f.parentTemporaryId === null)
    expect(topLevel.length).toBeLessThanOrEqual(MAX_SIBLINGS)
  })

  it('一级目录挂在指定的范围根下', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), '前端', null] as [string, string, null])
    const { newFolders } = buildCategoryTree({ tags: tags(many), rootId, existingFolders: [] })
    expect(newFolders.every((f) => f.parentTemporaryId !== null || f.parentId === rootId)).toBe(true)
  })

  it('临时 id 唯一且格式为 tmp:N', () => {
    const spec = Array.from({ length: 12 }, (_, i) => [
      String(i), i < 6 ? '前端' : '后端', null,
    ] as [string, string, null])
    const { newFolders } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    const ids = newFolders.map((f) => f.temporaryId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^tmp:\d+$/.test(id))).toBe(true)
  })

  it('无标签输入时返回空结果', () => {
    expect(buildCategoryTree({ tags: [], rootId, existingFolders: [] }))
      .toEqual({ candidates: [], newFolders: [] })
  })
})
