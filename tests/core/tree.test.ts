import { describe, it, expect } from 'vitest'
import { buildCategoryTree, stripNumberPrefix, MAX_SIBLINGS } from '@/core/tree'
import type { BuildTreeInput, BuildTreeOutput, ExistingFolder } from '@/core/tree'
import type { BookmarkItem, TagResult } from '@/core/types'
import { DOMAIN_GROUPS, groupFolderTitle } from '@/core/domainGroups'
import { MAX_LEAF, SHAPE_MAX_SIBLINGS } from '@/core/shape'

function tags(spec: Array<[string, string, string | null]>): TagResult[] {
  return spec.map(([bookmarkId, primaryTopic, secondaryTopic]) => ({
    bookmarkId, primaryTopic, secondaryTopic,
  }))
}

/**
 * locale 现在是必填项，但本文件里的用例全部只关心中文分支。
 * 固定传 'zh_CN'，调用点不必逐个重复。
 */
function buildTree(input: Omit<BuildTreeInput, 'locale'>): BuildTreeOutput {
  return buildCategoryTree({ ...input, locale: 'zh_CN' })
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
    const { candidates, newFolders } = buildTree({ tags: tags(many), rootId, existingFolders: [] })
    expect(newFolders.some((f) => base(f.title) === '前端')).toBe(true)
    expect(candidates.some((c) => base(c.path.at(-1)!) === '前端')).toBe(true)
  })

  it('每个主题都建目录，不再按数量筛选', () => {
    const { newFolders } = buildTree({
      tags: tags([['1', '冷门主题', null], ['2', '另一个冷门', null]]),
      rootId, existingFolders: [],
    })
    expect(newFolders.map((f) => base(f.title))).toContain('冷门主题')
    expect(newFolders.map((f) => base(f.title))).toContain('另一个冷门')
    expect(newFolders.map((f) => base(f.title))).toContain('其他')
  })

  it('二级主题数量达标时生成子目录', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 6 }, (_, i) => ['a' + i, '前端', 'React'] as [string, string, string]),
      ...Array.from({ length: 6 }, (_, i) => ['b' + i, '前端', 'Vue'] as [string, string, string]),
    ]
    const { candidates } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
    const paths = candidates.map((c) => c.path.map(base).join('/'))
    expect(paths).toContain('前端/React')
    expect(paths).toContain('前端/Vue')
  })

  it('同义主题名归一化后合并', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 3 }, (_, i) => ['a' + i, 'LLM', null] as [string, string, null]),
      ...Array.from({ length: 3 }, (_, i) => ['b' + i, 'l l m', null] as [string, string, null]),
    ]
    const { newFolders } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
    expect(newFolders.filter((f) => f.parentTemporaryId === null && base(f.title) !== '其他')).toHaveLength(1)
  })

  it('沿用现有文件夹的写法作为目录名', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), 'llm', null] as [string, string, null])
    const { candidates } = buildTree({
      tags: tags(many), rootId, existingFolders: [folder('9', 'LLM', '99')],
    })
    expect(candidates.some((c) => base(c.path[0]!) === 'LLM')).toBe(true)
  })

  it('同一层目录数量不超过上限，超出部分并入「其他」', () => {
    // MAX_SIBLINGS + 4 个各 1 条书签、互不相同的主题：主题目录只取前 MAX_SIBLINGS - 1 个
    // （留一个位置给兜底的「其他」），加上兜底目录本身，顶层目录数恰好等于 MAX_SIBLINGS。
    const spec = Array.from({ length: MAX_SIBLINGS + 4 }, (_, i) => [
      String(i), `主题${i}`, null,
    ] as [string, string, null])
    const { newFolders } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
    const topLevel = newFolders.filter((f) => f.parentTemporaryId === null)
    expect(topLevel.length).toBe(MAX_SIBLINGS)
  })

  it('maxTopFolders 覆盖默认上限', () => {
    // 10 个各 1 条书签、互不相同的主题；上限设 5 时主题目录取前 4 个
    // （留一个位置给兜底的「其他」），加上兜底目录本身，顶层恰好 5 个
    const spec = Array.from({ length: 10 }, (_, i) => [
      String(i), `主题${i}`, null,
    ] as [string, string, null])
    const { newFolders } = buildTree({
      tags: tags(spec), rootId, existingFolders: [], maxTopFolders: 5,
    })
    expect(newFolders.filter((f) => f.parentTemporaryId === null)).toHaveLength(5)
  })

  it('不传 maxTopFolders 时上限仍是 MAX_SIBLINGS', () => {
    const spec = Array.from({ length: MAX_SIBLINGS + 4 }, (_, i) => [
      String(i), `主题${i}`, null,
    ] as [string, string, null])
    const { newFolders } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
    expect(newFolders.filter((f) => f.parentTemporaryId === null)).toHaveLength(MAX_SIBLINGS)
  })

  it('一级目录挂在指定的范围根下', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), '前端', null] as [string, string, null])
    const { newFolders } = buildTree({ tags: tags(many), rootId, existingFolders: [] })
    expect(newFolders.every((f) => f.parentTemporaryId !== null || f.parentId === rootId)).toBe(true)
  })

  it('临时 id 唯一且格式为 tmp:N', () => {
    const spec = Array.from({ length: 12 }, (_, i) => [
      String(i), i < 6 ? '前端' : '后端', null,
    ] as [string, string, null])
    const { newFolders } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
    const ids = newFolders.map((f) => f.temporaryId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^tmp:\d+$/.test(id))).toBe(true)
  })

  it('无标签输入时返回空结果', () => {
    expect(buildTree({ tags: [], rootId, existingFolders: [] }))
      .toEqual({ candidates: [], newFolders: [], renameFolders: [], pinned: [], mergeRootTemporaryId: null })
  })
})

describe('buildCategoryTree 复用已有目录', () => {
  const many = Array.from({ length: 6 }, (_, i) => [String(i), 'AI', null] as [string, string, null])

  it('范围根下已有同名目录时复用它，不再新建', () => {
    const { candidates, newFolders, renameFolders } = buildTree({
      tags: tags(many), rootId, existingFolders: [folder('50', 'AI')],
    })
    expect(newFolders.some((f) => base(f.title) === 'AI')).toBe(false)
    expect(candidates.find((c) => base(c.path[0]!) === 'AI')?.id).toBe('50')
    expect(renameFolders).toContainEqual({ folderId: '50', oldTitle: 'AI', newTitle: '01 AI' })
  })

  it('同名判定忽略大小写与空格', () => {
    const { newFolders } = buildTree({
      tags: tags(many), rootId, existingFolders: [folder('50', 'a i')],
    })
    expect(newFolders.some((f) => base(f.title).toLowerCase().replace(/\s/g, '') === 'ai')).toBe(false)
  })

  it('已带编号的目录再次整理不叠加编号，也不重复新建', () => {
    const { newFolders, renameFolders } = buildTree({
      tags: tags(many), rootId, existingFolders: [folder('50', '01 AI')],
    })
    expect(newFolders).toHaveLength(1) // 只有兜底的「其他」
    expect(base(newFolders[0]!.title)).toBe('其他')
    expect(renameFolders).toEqual([]) // 名字已经是 01 AI，无需改名
  })

  it('只复用同一个父目录下的同名目录', () => {
    const { candidates, newFolders } = buildTree({
      tags: tags(many), rootId, existingFolders: [folder('50', 'AI', '999')],
    })
    expect(newFolders.some((f) => base(f.title) === 'AI')).toBe(true)
    expect(candidates.find((c) => base(c.path[0]!) === 'AI')?.id).toMatch(/^tmp:/)
  })

  it('复用父目录时，它下面的同名子目录也复用', () => {
    const spec = Array.from({ length: 6 }, (_, i) => ['a' + i, 'AI', 'rag'] as [string, string, string])
    const { candidates, newFolders } = buildTree({
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
    const { candidates } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
    const paths = candidates.map((c) => c.path.join('/'))
    expect(paths).toContain('01 AI')
    expect(paths).toContain('01 AI/01 rag')
    expect(paths).toContain('01 AI/02 LLM')
    expect(paths).toContain('02 开发')
  })

  it('兜底目录排在最后一个编号', () => {
    const { candidates } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
    expect(candidates.map((c) => c.path[0]!)).toContain('03 其他')
  })

  it('stripNumberPrefix 只去掉编号，不动正常名字', () => {
    expect(stripNumberPrefix('01 AI')).toBe('AI')
    expect(stripNumberPrefix('01.2 rag')).toBe('rag')
    expect(stripNumberPrefix('3D 建模')).toBe('3D 建模')
    expect(stripNumberPrefix('AI')).toBe('AI')
  })
})

describe('buildCategoryTree 兜底目录名双语化', () => {
  it('英文 locale 下兜底目录名是 Other 而不是「其他」', () => {
    const many = Array.from({ length: 6 }, (_, i) => [String(i), 'React', null] as [string, string, null])
    const { newFolders } = buildCategoryTree({ tags: tags(many), rootId, existingFolders: [], locale: 'en' })
    expect(newFolders.map((f) => base(f.title))).toContain('Other')
    expect(newFolders.map((f) => base(f.title))).not.toContain('其他')
  })
})

describe('buildCategoryTree 忽略空主题', () => {
  it('主题为空的书签不参与建树，不会凑出一个假目录', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 6 }, (_, i) => ['a' + i, '', null] as [string, string, null]),
      ...Array.from({ length: 6 }, (_, i) => ['b' + i, '前端', null] as [string, string, null]),
    ]
    const { candidates } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
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
    const withoutGroups = buildTree({ tags: tags(many), rootId, existingFolders: [] })
    const withEmptyGroups = buildTree({
      tags: tags(many), rootId, existingFolders: [],
      bookmarks: items(many.map(([id]) => [id, `https://github.com/o/${id}`])),
      domainGroups: [],
    })
    expect(withEmptyGroups).toEqual(withoutGroups)
    expect(withoutGroups.pinned).toEqual([])
  })

  it('只有 2 条也建聚合目录', () => {
    const gh = githubFixture(2, '工具')
    const { candidates } = buildTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    expect(candidates.map((c) => base(c.path[0]!))).toContain('GitHub')
  })

  it('聚合目录排在主题目录之前，占最小的编号', () => {
    const gh = githubFixture(2, '工具')
    const topic = Array.from({ length: 6 }, (_, i) => ['t' + i, '前端', null] as [string, string, null])
    const { candidates } = buildTree({
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
      buildTree({
        tags: [...gh.tags, ...papers.tags], rootId, existingFolders: [],
        bookmarks: [...gh.bookmarks, ...papers.bookmarks], domainGroups,
      }).candidates.filter((c) => c.path.length === 1).map((c) => base(c.path[0]!))

    expect(build(['github', 'paper']).slice(0, 2)).toEqual(['GitHub', '论文'])
    expect(build(['paper', 'github']).slice(0, 2)).toEqual(['GitHub', '论文'])
  })

  it('没有命中书签的组不建目录', () => {
    const gh = githubFixture(2, '工具')
    const { candidates } = buildTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github', 'paper'],
    })
    expect(candidates.map((c) => base(c.path[0]!))).not.toContain('论文')
  })

  it('聚合目录不占主题目录的 MAX_SIBLINGS 名额', () => {
    const gh = githubFixture(2, '工具')
    const topicSpec = Array.from({ length: MAX_SIBLINGS + 4 }, (_, i) => [
      't' + i, `主题${i}`, null,
    ] as [string, string, null])
    const { candidates } = buildTree({
      tags: [...gh.tags, ...tags(topicSpec)], rootId, existingFolders: [],
      bookmarks: [...gh.bookmarks, ...items(topicSpec.map(([id]) => [id, `https://example.com/${id}`]))],
      domainGroups: ['github'],
    })
    const tops = candidates.filter((c) => c.path.length === 1)
    const topicTops = tops.filter((c) => c.domainGroup === undefined)
    expect(topicTops).toHaveLength(MAX_SIBLINGS)
    expect(tops).toHaveLength(MAX_SIBLINGS + 1)
  })

  it('组内每个主题都生成二级目录（组内总数超过叶子容量上限，触发聚簇）', () => {
    // 组内形状只决定「要不要分子目录」（票 10 补账第 8 条）：装得下（≤ MAX_LEAF）就整组
    // 平铺，这里要测的是聚簇分支，book 数必须过 MAX_LEAF。
    const gh = githubFixture(MAX_LEAF + 1, 'AI 工具')
    const { candidates } = buildTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    expect(candidates.map((c) => c.path.map(base).join('/'))).toContain('GitHub/AI 工具')
  })

  it('主题为空的组内书签平铺在组根，不建子目录', () => {
    const gh = githubFixture(2, '')
    const { candidates, pinned } = buildTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    const githubTop = candidates.find((c) => base(c.path[0]!) === 'GitHub' && c.path.length === 1)!
    expect(candidates.filter((c) => c.path.length === 2)).toEqual([])
    expect(pinned.every((p) => p.targetCategoryId === githubTop.id)).toBe(true)
  })

  it('组内不同主题数超过上限时，排在后面的主题平铺在组根，不建子目录', () => {
    // SHAPE_MAX_SIBLINGS + 3 个各 1 条书签、互不相同的主题，凑出 MAX_LEAF + 3 条总数——
    // 既过了叶子容量上限（触发聚簇分支），子目录数又过了二级上限：前 SHAPE_MAX_SIBLINGS
    // 个各自拿到子目录，排在后面的 3 个没有子目录名额，书签直接 pin 到组根。
    const n = MAX_LEAF + 3
    const spec = Array.from({ length: n }, (_, i) => [`g${i}`, `主题${i}`, null] as [string, string, null])
    const bookmarks = items(spec.map(([id]) => [id, `https://github.com/o/${id}`]))
    const { candidates, pinned } = buildTree({
      tags: tags(spec), rootId, existingFolders: [],
      bookmarks, domainGroups: ['github'],
    })
    const githubTop = candidates.find((c) => base(c.path[0]!) === 'GitHub' && c.path.length === 1)!
    const children = candidates.filter((c) => c.path.length === 2)
    expect(children).toHaveLength(SHAPE_MAX_SIBLINGS)

    const overflowIds = spec.slice(SHAPE_MAX_SIBLINGS).map(([id]) => id)
    const overflowPins = pinned.filter((p) => overflowIds.includes(p.bookmarkId))
    expect(overflowPins).toHaveLength(overflowIds.length)
    expect(overflowPins.every((p) => p.targetCategoryId === githubTop.id)).toBe(true)
  })

  it('组内书签不超过叶子容量上限时整组平铺，不建子目录', () => {
    const out = buildCategoryTree({
      tags: Array.from({ length: 15 }, (_, i) => (
        { bookmarkId: `g${i}`, primaryTopic: i % 3 === 0 ? '前端' : '后端', secondaryTopic: null }
      )),
      bookmarks: Array.from({ length: 15 }, (_, i) => ({
        id: `g${i}`, title: `T${i}`, url: `https://github.com/o/r${i}`,
        parentId: '1', index: i, currentPath: [],
      })),
      domainGroups: ['github'],
      rootId: '1',
      existingFolders: [],
      locale: 'zh_CN',
    })
    const github = out.newFolders.find((f) => f.title.includes('GitHub'))!
    const children = out.newFolders.filter((f) => f.parentTemporaryId === github.temporaryId)
    expect(children).toHaveLength(0)
    // 15 条全部钉在组根上
    expect(out.pinned.filter((p) => p.targetCategoryId === github.temporaryId)).toHaveLength(15)
  })

  it('超过上限才按主题聚簇', () => {
    const out = buildCategoryTree({
      tags: Array.from({ length: 30 }, (_, i) => (
        { bookmarkId: `g${i}`, primaryTopic: i % 2 === 0 ? '前端' : '后端', secondaryTopic: null }
      )),
      bookmarks: Array.from({ length: 30 }, (_, i) => ({
        id: `g${i}`, title: `T${i}`, url: `https://github.com/o/r${i}`,
        parentId: '1', index: i, currentPath: [],
      })),
      domainGroups: ['github'],
      rootId: '1',
      existingFolders: [],
      locale: 'zh_CN',
    })
    const github = out.newFolders.find((f) => f.title.includes('GitHub'))!
    const children = out.newFolders.filter((f) => f.parentTemporaryId === github.temporaryId)
    expect(children).toHaveLength(2)
  })

  it('pinned 覆盖全部命中书签，且指向二级目录', () => {
    // 组内总数要过 MAX_LEAF 才会分子目录，这个用例测的正是「指向二级目录」这件事。
    const gh = githubFixture(MAX_LEAF + 1, 'AI 工具')
    const { candidates, pinned } = buildTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    const child = candidates.find((c) => c.path.length === 2)!
    expect(pinned).toHaveLength(MAX_LEAF + 1)
    expect(pinned.map((p) => p.bookmarkId).sort()).toEqual(gh.bookmarks.map((b) => b.id).sort())
    expect(pinned.every((p) => p.targetCategoryId === child.id)).toBe(true)
    expect(pinned.every((p) => p.confidence === 1 && p.source === 'rule')).toBe(true)
    expect(pinned[0]!.reason).toContain('github.com')
    expect(pinned[0]!.reason).toContain('GitHub')
  })

  it('英文 locale 下 pinned 的 reason 也是英文', () => {
    const gh = githubFixture(2, 'AI Tools')
    const { pinned } = buildCategoryTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'], locale: 'en',
    })
    expect(pinned[0]!.reason).toContain('github.com')
    expect(pinned[0]!.reason).toContain('GitHub')
    expect(pinned[0]!.reason).not.toContain('域名')
  })

  it('聚合目录的 candidate 带 domainGroup 标记，主题目录不带', () => {
    const gh = githubFixture(2, '工具')
    const topic = Array.from({ length: 6 }, (_, i) => ['t' + i, '前端', null] as [string, string, null])
    const { candidates } = buildTree({
      tags: [...gh.tags, ...tags(topic)], rootId, existingFolders: [],
      bookmarks: [...gh.bookmarks, ...items(topic.map(([id]) => [id, `https://example.com/${id}`]))],
      domainGroups: ['github'],
    })
    expect(candidates.find((c) => base(c.path[0]!) === 'GitHub')!.domainGroup).toBe('github')
    expect(candidates.find((c) => base(c.path[0]!) === '前端')!.domainGroup).toBeUndefined()
  })

  it('命中聚合组的书签不再参与主题分组', () => {
    const gh = githubFixture(2, '前端')
    const { candidates } = buildTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'],
    })
    const tops = candidates.filter((c) => c.path.length === 1).map((c) => base(c.path[0]!))
    expect(tops).toContain('GitHub')
    expect(tops).not.toContain('前端')
  })

  it('范围根下已有同名目录时聚合目录也复用它', () => {
    const gh = githubFixture(2, '工具')
    const { candidates, newFolders, renameFolders } = buildTree({
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
      const { candidates } = buildTree({
        tags: [{ bookmarkId: 'x', primaryTopic: '主题', secondaryTopic: null }],
        rootId, existingFolders: [],
        bookmarks: items([['x', url]]), domainGroups: [group.key],
      })
      // buildTree 固定传 zh_CN（见本文件顶部的封装），断言跟着用中文名
      expect(candidates.map((c) => base(c.path[0]!))).toContain(groupFolderTitle(group, 'zh_CN'))
    }
  })
})

describe('buildCategoryTree 合并模式', () => {
  const merge = { parentId: '1', title: 'AI 学习' }

  it('首条新建目录是合并根，标题不带编号前缀', () => {
    const { newFolders, mergeRootTemporaryId } = buildTree({
      tags: tags([['1', '前端', null], ['2', '后端', null]]),
      rootId: 'unused', existingFolders: [], mergeRoot: merge,
    })
    expect(newFolders[0]).toMatchObject({
      temporaryId: mergeRootTemporaryId, parentId: '1', parentTemporaryId: null, title: 'AI 学习',
    })
    expect(base(newFolders[0]!.title)).toBe('AI 学习')
  })

  it('一级目录挂在合并根的临时 id 下，而不是真实 parentId', () => {
    const { newFolders, mergeRootTemporaryId } = buildTree({
      tags: tags([['1', '前端', null]]),
      rootId: 'unused', existingFolders: [], mergeRoot: merge,
    })
    const top = newFolders.filter((f) => base(f.title) === '前端')
    expect(top).toHaveLength(1)
    expect(top[0]).toMatchObject({ parentId: null, parentTemporaryId: mergeRootTemporaryId })
  })

  it('不复用源目录下的同名子目录', () => {
    // rootId 与 existingFolders 里目录的 parentId 都设成和 merge.parentId 一样的 '1'：
    // 去掉合并模式的旁路判断后，findChild(rootId, '前端') 会命中 '90'，
    // 复用旧目录并产出一条 rename，从而让下面的断言暴露出来。
    const { newFolders, renameFolders } = buildTree({
      tags: tags([['1', '前端', null]]),
      rootId: '1',
      existingFolders: [folder('90', '前端', '1')],
      mergeRoot: merge,
    })
    expect(newFolders.some((f) => base(f.title) === '前端')).toBe(true)
    expect(renameFolders).toEqual([])
  })

  it('仍然沿用用户既有的命名写法', () => {
    const { newFolders } = buildTree({
      tags: tags([['1', 'AI工具', null]]),
      rootId: 'unused',
      existingFolders: [folder('90', 'AI 工具', '9')],
      mergeRoot: merge,
    })
    expect(newFolders.map((f) => base(f.title))).toContain('AI 工具')
  })

  it('不给 mergeRoot 时 mergeRootTemporaryId 为 null，输出与今天一致', () => {
    const { newFolders, mergeRootTemporaryId } = buildTree({
      tags: tags([['1', '前端', null]]), rootId, existingFolders: [],
    })
    expect(mergeRootTemporaryId).toBeNull()
    expect(newFolders.every((f) => f.parentId === rootId || f.parentTemporaryId !== null)).toBe(true)
  })
})

describe('buildCategoryTree 二级目录开关', () => {
  it('allowSubfolders=false 时忽略二级主题，只出一层', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 6 }, (_, i) => ['a' + i, '前端', 'React'] as [string, string, string]),
      ...Array.from({ length: 6 }, (_, i) => ['b' + i, '前端', 'Vue'] as [string, string, string]),
    ]
    const { candidates } = buildTree({
      tags: tags(spec), rootId, existingFolders: [], allowChildren: false,
    })
    const paths = candidates.map((c) => c.path.map(base).join('/'))
    expect(paths).toContain('前端')
    expect(paths.every((p) => !p.includes('/'))).toBe(true)
  })

  it('默认仍然生成二级目录', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 6 }, (_, i) => ['a' + i, '前端', 'React'] as [string, string, string]),
      ...Array.from({ length: 6 }, (_, i) => ['b' + i, '前端', 'Vue'] as [string, string, string]),
    ]
    const { candidates } = buildTree({ tags: tags(spec), rootId, existingFolders: [] })
    expect(candidates.map((c) => c.path.map(base).join('/'))).toContain('前端/React')
  })

  // 聚合组的两层是那个功能本身的定义，用户勾了组就是明确要这个结构
  it('allowChildren=false 不影响域名聚合组内部的细分', () => {
    // 组内总数要过 MAX_LEAF 才会分子目录，这里两个主题各出一半、合计过线。
    const half = Math.ceil((MAX_LEAF + 1) / 2)
    const a = githubFixture(half, 'RAG 检索')
    const b = githubFixture(half, '模型微调', half)
    const { candidates } = buildTree({
      tags: [...a.tags, ...b.tags],
      rootId,
      existingFolders: [],
      bookmarks: [...a.bookmarks, ...b.bookmarks],
      domainGroups: ['github'],
      allowChildren: false,
    })
    const paths = candidates.map((c) => c.path.map(base).join('/'))
    expect(paths).toContain('GitHub/RAG 检索')
    expect(paths).toContain('GitHub/模型微调')
  })
})

/**
 * 目录下限的第二道拦截：模型设计完目录后，标签数就等于该目录能收到的书签数上界。
 * 这里按标签数把撑不起来的目录挡在建树之外，被挡下的书签没有候选目录，
 * 分类阶段会把它们送进「其他」。第三道在 core/prune.ts。
 */
describe('buildCategoryTree 目录下限', () => {
  it('标签数不足下限的主题不建目录', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 4 }, (_, i) => ['a' + i, '前端', null] as [string, string, null]),
      ['b0', '独苗', null],
      ['b1', '两个也不够', null],
      ['b2', '两个也不够', null],
    ]
    const { newFolders } = buildTree({
      tags: tags(spec), rootId, existingFolders: [], minFolderSize: 3,
    })
    const titles = newFolders.map((f) => base(f.title))
    expect(titles).toContain('前端')
    expect(titles).not.toContain('独苗')
    expect(titles).not.toContain('两个也不够')
  })

  it('不传 minFolderSize 时行为与改造前完全一致', () => {
    const spec: Array<[string, string, string | null]> = [['b0', '独苗', null]]
    expect(buildTree({ tags: tags(spec), rootId, existingFolders: [] }))
      .toEqual(buildTree({ tags: tags(spec), rootId, existingFolders: [], minFolderSize: 1 }))
  })

  // 「其他」是收容所，本身没有标签数可言。把它一起筛掉，被挡下的书签就无处可去了
  it('「其他」兜底目录不受下限影响', () => {
    const { newFolders } = buildTree({
      tags: tags([['b0', '独苗', null]]), rootId, existingFolders: [], minFolderSize: 3,
    })
    expect(newFolders.map((f) => base(f.title))).toEqual(['其他'])
  })

  it('二级主题标签数不足下限时不建子目录，一级目录照建', () => {
    const spec: Array<[string, string, string | null]> = [
      ...Array.from({ length: 4 }, (_, i) => ['a' + i, '前端', 'React'] as [string, string, string]),
      ['a9', '前端', 'Svelte'],
    ]
    const { candidates } = buildTree({
      tags: tags(spec), rootId, existingFolders: [], minFolderSize: 3,
    })
    const paths = candidates.map((c) => c.path.map(base).join('/'))
    expect(paths).toContain('前端/React')
    expect(paths).not.toContain('前端/Svelte')
  })

  // 组内的独苗子目录同样难看，但组目录自己是用户勾出来的，不能因为人少就撤掉
  it('聚合组内不足下限的子目录不建，书签平铺在组根', () => {
    // 组内总数要过 MAX_LEAF 才会分子目录，big 单独就顶到上限，small 紧跟在后面。
    const big = githubFixture(MAX_LEAF, 'RAG 检索')
    const small = githubFixture(1, '语音合成', MAX_LEAF)
    const { candidates, pinned } = buildTree({
      tags: [...big.tags, ...small.tags], rootId, existingFolders: [],
      bookmarks: [...big.bookmarks, ...small.bookmarks],
      domainGroups: ['github'], minFolderSize: 3,
    })
    const paths = candidates.map((c) => c.path.map(base).join('/'))
    expect(paths).toContain('GitHub/RAG 检索')
    expect(paths).not.toContain('GitHub/语音合成')
    const groupRoot = candidates.find((c) => c.path.length === 1 && base(c.path[0]!) === 'GitHub')!
    expect(pinned.find((p) => p.bookmarkId === `g${MAX_LEAF}`)!.targetCategoryId).toBe(groupRoot.id)
  })

  it('聚合组目录本身不受下限影响——用户勾了这个组就是要它', () => {
    const gh = githubFixture(1, '工具')
    const { candidates } = buildTree({
      tags: gh.tags, rootId, existingFolders: [],
      bookmarks: gh.bookmarks, domainGroups: ['github'], minFolderSize: 3,
    })
    expect(candidates.map((c) => base(c.path[0]!))).toContain('GitHub')
  })
})
