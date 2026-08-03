import { describe, it, expect } from 'vitest'
import { buildCategoryTree, stripNumberPrefix, MIN_FOLDER_SIZE, MAX_SIBLINGS } from '@/core/tree'
import type { ExistingFolder } from '@/core/tree'
import type { TagResult } from '@/core/types'

function tags(spec: Array<[string, string, string | null]>): TagResult[] {
  return spec.map(([bookmarkId, primaryTopic, secondaryTopic]) => ({
    bookmarkId, primaryTopic, secondaryTopic,
  }))
}

/** 断言时忽略编号前缀，只看目录名本身。 */
const base = (title: string): string => stripNumberPrefix(title)

const rootId = '1'

function folder(id: string, title: string, parentId: string | null = rootId): ExistingFolder {
  return { id, title, parentId }
}

describe('buildCategoryTree', () => {
  it('数量达标的主题生成独立一级目录', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), '前端', null] as [string, string, null])
    const { candidates, newFolders } = buildCategoryTree({ tags: tags(many), rootId, existingFolders: [] })
    expect(newFolders.some((f) => base(f.title) === '前端')).toBe(true)
    expect(candidates.some((c) => base(c.path.at(-1)!) === '前端')).toBe(true)
  })

  it('数量不足的主题合并进「其他」', () => {
    const { newFolders } = buildCategoryTree({
      tags: tags([['1', '冷门主题', null], ['2', '另一个冷门', null]]),
      rootId, existingFolders: [],
    })
    expect(newFolders.map((f) => base(f.title))).toContain('其他')
    expect(newFolders.some((f) => base(f.title) === '冷门主题')).toBe(false)
  })

  it('二级主题数量达标时生成子目录', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 6 }, (_, i) => ['a' + i, '前端', 'React'] as [string, string, string]),
      ...Array.from({ length: 6 }, (_, i) => ['b' + i, '前端', 'Vue'] as [string, string, string]),
    ]
    const { candidates } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    const paths = candidates.map((c) => c.path.map(base).join('/'))
    expect(paths).toContain('前端/React')
    expect(paths).toContain('前端/Vue')
  })

  it('同义主题名归一化后合并', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 3 }, (_, i) => ['a' + i, 'LLM', null] as [string, string, null]),
      ...Array.from({ length: 3 }, (_, i) => ['b' + i, 'l l m', null] as [string, string, null]),
    ]
    const { newFolders } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    expect(newFolders.filter((f) => f.parentTemporaryId === null && base(f.title) !== '其他')).toHaveLength(1)
  })

  it('沿用现有文件夹的写法作为目录名', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), 'llm', null] as [string, string, null])
    const { candidates } = buildCategoryTree({
      tags: tags(many), rootId, existingFolders: [folder('9', 'LLM', '99')],
    })
    expect(candidates.some((c) => base(c.path[0]!) === 'LLM')).toBe(true)
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
      .toEqual({ candidates: [], newFolders: [], renameFolders: [] })
  })
})

describe('buildCategoryTree 复用已有目录', () => {
  const many = Array.from({ length: 6 }, (_, i) => [String(i), 'AI', null] as [string, string, null])

  it('范围根下已有同名目录时复用它，不再新建', () => {
    const { candidates, newFolders, renameFolders } = buildCategoryTree({
      tags: tags(many), rootId, existingFolders: [folder('50', 'AI')],
    })
    expect(newFolders.some((f) => base(f.title) === 'AI')).toBe(false)
    expect(candidates.find((c) => base(c.path[0]!) === 'AI')?.id).toBe('50')
    expect(renameFolders).toContainEqual({ folderId: '50', oldTitle: 'AI', newTitle: '01 AI' })
  })

  it('同名判定忽略大小写与空格', () => {
    const { newFolders } = buildCategoryTree({
      tags: tags(many), rootId, existingFolders: [folder('50', 'a i')],
    })
    expect(newFolders.some((f) => base(f.title).toLowerCase().replace(/\s/g, '') === 'ai')).toBe(false)
  })

  it('已带编号的目录再次整理不叠加编号，也不重复新建', () => {
    const { newFolders, renameFolders } = buildCategoryTree({
      tags: tags(many), rootId, existingFolders: [folder('50', '01 AI')],
    })
    expect(newFolders).toHaveLength(1) // 只有兜底的「其他」
    expect(base(newFolders[0]!.title)).toBe('其他')
    expect(renameFolders).toEqual([]) // 名字已经是 01 AI，无需改名
  })

  it('只复用同一个父目录下的同名目录', () => {
    const { candidates, newFolders } = buildCategoryTree({
      tags: tags(many), rootId, existingFolders: [folder('50', 'AI', '999')],
    })
    expect(newFolders.some((f) => base(f.title) === 'AI')).toBe(true)
    expect(candidates.find((c) => base(c.path[0]!) === 'AI')?.id).toMatch(/^tmp:/)
  })

  it('复用父目录时，它下面的同名子目录也复用', () => {
    const spec = Array.from({ length: 6 }, (_, i) => ['a' + i, 'AI', 'rag'] as [string, string, string])
    const { candidates, newFolders } = buildCategoryTree({
      tags: tags(spec), rootId,
      existingFolders: [folder('50', 'AI'), folder('51', 'rag', '50')],
    })
    expect(newFolders.some((f) => base(f.title) === 'rag')).toBe(false)
    expect(candidates.find((c) => c.path.length === 2)?.id).toBe('51')
  })
})

describe('buildCategoryTree 编号前缀', () => {
  const spec: Array<[string, string, string | null]> = [
    ...Array.from({ length: 8 }, (_, i) => ['a' + i, 'AI', 'rag'] as [string, string, string]),
    ...Array.from({ length: 6 }, (_, i) => ['b' + i, 'AI', 'LLM'] as [string, string, string]),
    ...Array.from({ length: 5 }, (_, i) => ['c' + i, '开发', null] as [string, string, null]),
  ]

  it('顶层按书签数从多到少编号，子目录带父级前缀', () => {
    const { candidates } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    const paths = candidates.map((c) => c.path.join('/'))
    expect(paths).toContain('01 AI')
    expect(paths).toContain('01 AI/01.1 rag')
    expect(paths).toContain('01 AI/01.2 LLM')
    expect(paths).toContain('02 开发')
  })

  it('兜底目录排在最后一个编号', () => {
    const { candidates } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    expect(candidates.map((c) => c.path[0]!)).toContain('03 其他')
  })

  it('stripNumberPrefix 只去掉编号，不动正常名字', () => {
    expect(stripNumberPrefix('01 AI')).toBe('AI')
    expect(stripNumberPrefix('01.2 rag')).toBe('rag')
    expect(stripNumberPrefix('3D 建模')).toBe('3D 建模')
    expect(stripNumberPrefix('AI')).toBe('AI')
  })
})

describe('buildCategoryTree 忽略空主题', () => {
  it('主题为空的书签不参与建树，不会凑出一个假目录', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 6 }, (_, i) => ['a' + i, '', null] as [string, string, null]),
      ...Array.from({ length: 6 }, (_, i) => ['b' + i, '前端', null] as [string, string, null]),
    ]
    const { candidates } = buildCategoryTree({ tags: tags(spec), rootId, existingFolders: [] })
    // 只剩「前端」与兜底的「其他」
    expect(candidates.map((c) => base(c.path[0]!))).toEqual(['前端', '其他'])
  })
})
