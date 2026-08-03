import { describe, it, expect } from 'vitest'
import { buildCategoryTree, stripNumberPrefix, MIN_FOLDER_SIZE, MAX_SIBLINGS } from '@/core/tree'
import type { ExistingFolder } from '@/core/tree'
import type { BookmarkItem, TagResult } from '@/core/types'
import { DOMAIN_GROUPS } from '@/core/domainGroups'

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
      .toEqual({ candidates: [], newFolders: [], renameFolders: [], pinned: [] })
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

function items(spec: Array<[string, string]>): BookmarkItem[] {
  return spec.map(([id, url]) => ({
    id, title: `书签 ${id}`, url, parentId: '0', index: 0, currentPath: [],
  }))
}

/** 造 n 个 github 书签，id 为 g0…g(n-1)，主题统一为 topic。 */
function githubFixture(n: number, topic: string, offset = 0): {
  tags: TagResult[]
  bookmarks: BookmarkItem[]
} {
  const spec = Array.from({ length: n }, (_, i) => `g${offset + i}`)
  return {
    tags: spec.map((id) => ({ bookmarkId: id, primaryTopic: topic, secondaryTopic: null })),
    bookmarks: items(spec.map((id) => [id, `https://github.com/owner/${id}`])),
  }
}

describe('buildCategoryTree 域名聚合', () => {
  it('不传 domainGroups 时行为与聚合前完全一致', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), '前端', null] as [string, string, null])
    const withoutGroups = buildCategoryTree({ tags: tags(many), rootId, existingFolders: [] })
    const withEmptyGroups = buildCategoryTree({
      tags: tags(many), rootId, existingFolders: [],
      bookmarks: items(many.map(([id]) => [id, `https://github.com/o/${id}`])),
      domainGroups: [],
    })
    expect(withEmptyGroups).toEqual(withoutGroups)
    expect(withoutGroups.pinned).toEqual([])
  })

  it('只有 2 条也建聚合目录——不受 MIN_FOLDER_SIZE 限制', () => {
    const gh = githubFixture(2, '工具')
    const { candidates } = buildCategoryTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    expect(candidates.map((c) => base(c.path[0]!))).toContain('GitHub')
  })

  it('聚合目录排在主题目录之前，占最小的编号', () => {
    const gh = githubFixture(2, '工具')
    const topic = Array.from({ length: 6 }, (_, i) => ['t' + i, '前端', null] as [string, string, null])
    const { candidates } = buildCategoryTree({
      tags: [...gh.tags, ...tags(topic)], rootId, existingFolders: [],
      bookmarks: [...gh.bookmarks, ...items(topic.map(([id]) => [id, `https://example.com/${id}`]))],
      domainGroups: ['github'],
    })
    const tops = candidates.filter((c) => c.path.length === 1).map((c) => c.path[0]!)
    expect(tops[0]).toBe('01 GitHub')
    expect(tops).toContain('02 前端')
  })

  it('多个聚合组按 DOMAIN_GROUPS 声明顺序排列，与勾选顺序无关', () => {
    const gh = githubFixture(2, '工具')
    const papers = {
      tags: ['p0', 'p1'].map((id) => ({ bookmarkId: id, primaryTopic: '研究', secondaryTopic: null })),
      bookmarks: items([['p0', 'https://arxiv.org/abs/1'], ['p1', 'https://arxiv.org/abs/2']]),
    }
    const build = (domainGroups: string[]): string[] =>
      buildCategoryTree({
        tags: [...gh.tags, ...papers.tags], rootId, existingFolders: [],
        bookmarks: [...gh.bookmarks, ...papers.bookmarks], domainGroups,
      }).candidates.filter((c) => c.path.length === 1).map((c) => base(c.path[0]!))

    expect(build(['github', 'paper']).slice(0, 2)).toEqual(['GitHub', '论文'])
    expect(build(['paper', 'github']).slice(0, 2)).toEqual(['GitHub', '论文'])
  })

  it('没有命中书签的组不建目录', () => {
    const gh = githubFixture(2, '工具')
    const { candidates } = buildCategoryTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github', 'paper'],
    })
    expect(candidates.map((c) => base(c.path[0]!))).not.toContain('论文')
  })

  it('聚合目录不占主题目录的 MAX_SIBLINGS 名额', () => {
    const gh = githubFixture(2, '工具')
    const topicSpec = Array.from({ length: (MAX_SIBLINGS + 4) * MIN_FOLDER_SIZE }, (_, i) => [
      't' + i, `主题${Math.floor(i / MIN_FOLDER_SIZE)}`, null,
    ] as [string, string, null])
    const { candidates } = buildCategoryTree({
      tags: [...gh.tags, ...tags(topicSpec)], rootId, existingFolders: [],
      bookmarks: [...gh.bookmarks, ...items(topicSpec.map(([id]) => [id, `https://example.com/${id}`]))],
      domainGroups: ['github'],
    })
    const tops = candidates.filter((c) => c.path.length === 1)
    const topicTops = tops.filter((c) => c.domainGroup === undefined)
    expect(topicTops).toHaveLength(MAX_SIBLINGS)
    expect(tops).toHaveLength(MAX_SIBLINGS + 1)
  })

  it('组内主题达到 MIN_FOLDER_SIZE 时生成二级目录', () => {
    const gh = githubFixture(MIN_FOLDER_SIZE, 'AI 工具')
    const { candidates } = buildCategoryTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    expect(candidates.map((c) => c.path.map(base).join('/'))).toContain('GitHub/AI 工具')
  })

  it('组内主题不足 MIN_FOLDER_SIZE 时平铺在组根，不建「其他」子目录', () => {
    const gh = githubFixture(MIN_FOLDER_SIZE - 1, 'AI 工具')
    const { candidates, pinned } = buildCategoryTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    const githubTop = candidates.find((c) => base(c.path[0]!) === 'GitHub' && c.path.length === 1)!
    expect(candidates.filter((c) => c.path.length === 2 && base(c.path[0]!) === 'GitHub')).toEqual([])
    expect(pinned.every((p) => p.targetCategoryId === githubTop.id)).toBe(true)
  })

  it('pinned 覆盖全部命中书签，且指向二级目录', () => {
    const gh = githubFixture(MIN_FOLDER_SIZE, 'AI 工具')
    const { candidates, pinned } = buildCategoryTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    const child = candidates.find((c) => c.path.length === 2)!
    expect(pinned).toHaveLength(MIN_FOLDER_SIZE)
    expect(pinned.map((p) => p.bookmarkId).sort()).toEqual(gh.bookmarks.map((b) => b.id).sort())
    expect(pinned.every((p) => p.targetCategoryId === child.id)).toBe(true)
    expect(pinned.every((p) => p.confidence === 1 && p.source === 'rule')).toBe(true)
    expect(pinned[0]!.reason).toContain('github.com')
    expect(pinned[0]!.reason).toContain('GitHub')
  })

  it('聚合目录的 candidate 带 domainGroup 标记，主题目录不带', () => {
    const gh = githubFixture(2, '工具')
    const topic = Array.from({ length: 6 }, (_, i) => ['t' + i, '前端', null] as [string, string, null])
    const { candidates } = buildCategoryTree({
      tags: [...gh.tags, ...tags(topic)], rootId, existingFolders: [],
      bookmarks: [...gh.bookmarks, ...items(topic.map(([id]) => [id, `https://example.com/${id}`]))],
      domainGroups: ['github'],
    })
    expect(candidates.find((c) => base(c.path[0]!) === 'GitHub')!.domainGroup).toBe('github')
    expect(candidates.find((c) => base(c.path[0]!) === '前端')!.domainGroup).toBeUndefined()
  })

  it('命中聚合组的书签不再参与主题分组', () => {
    const gh = githubFixture(MIN_FOLDER_SIZE + 1, '前端')
    const { candidates } = buildCategoryTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    const tops = candidates.filter((c) => c.path.length === 1).map((c) => base(c.path[0]!))
    expect(tops).toContain('GitHub')
    expect(tops).not.toContain('前端')
  })

  it('范围根下已有同名目录时聚合目录也复用它', () => {
    const gh = githubFixture(2, '工具')
    const { candidates, newFolders, renameFolders } = buildCategoryTree({
      tags: gh.tags, rootId, existingFolders: [folder('70', 'GitHub')],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    expect(newFolders.some((f) => base(f.title) === 'GitHub')).toBe(false)
    expect(candidates.find((c) => base(c.path[0]!) === 'GitHub')?.id).toBe('70')
    expect(renameFolders).toContainEqual({ folderId: '70', oldTitle: 'GitHub', newTitle: '01 GitHub' })
  })

  it('DOMAIN_GROUPS 的每个组都能建出目录', () => {
    for (const group of DOMAIN_GROUPS) {
      const url = { github: 'https://github.com/a/b', gitlab: 'https://gitlab.com/a/b',
        video: 'https://youtube.com/watch', paper: 'https://arxiv.org/abs/1',
        qa: 'https://stackoverflow.com/q/1', docs: 'https://docs.python.org/3/' }[group.key]!
      const { candidates } = buildCategoryTree({
        tags: [{ bookmarkId: 'x', primaryTopic: '主题', secondaryTopic: null }],
        rootId, existingFolders: [],
        bookmarks: items([['x', url]]), domainGroups: [group.key],
      })
      expect(candidates.map((c) => base(c.path[0]!))).toContain(group.folderTitle)
    }
  })
})
