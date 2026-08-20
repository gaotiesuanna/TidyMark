import { describe, it, expect } from 'vitest'
import { buildPlan, filterAccepted, renumberPlan, retargetRow, summarize, MARK_CONFIDENCE } from '@/core/plan'
import type { BookmarkItem, BookmarkOperation, CategoryCandidate, Classification, OrganizePlan } from '@/core/types'
import { makePlan } from '../fakes/plan'

const candidates: CategoryCandidate[] = [
  { id: '10', path: ['书签栏', 'react'] },
  { id: '11', path: ['书签栏', '论文'] },
]

const items: BookmarkItem[] = [
  { id: '100', title: 'React 文档', url: 'https://react.dev', parentId: '11', index: 3, currentPath: ['书签栏', '论文'] },
  { id: '101', title: '某论文', url: 'https://arxiv.org/abs/1', parentId: '11', index: 4, currentPath: ['书签栏', '论文'] },
  { id: '102', title: '不确定的', url: 'https://x.dev', parentId: '11', index: 5, currentPath: ['书签栏', '论文'] },
  { id: '103', title: '没归属', url: 'https://y.dev', parentId: '11', index: 6, currentPath: ['书签栏', '论文'] },
]

const classifications: Classification[] = [
  { bookmarkId: '100', targetCategoryId: '10', confidence: 0.95, reason: 'React 官网', source: 'llm' },
  { bookmarkId: '101', targetCategoryId: '11', confidence: 1, reason: '论文站', source: 'rule' },
  { bookmarkId: '102', targetCategoryId: '10', confidence: 0.4, reason: '可能相关', source: 'llm' },
  { bookmarkId: '103', targetCategoryId: null, confidence: 0, reason: '无合适目录', source: 'none' },
]

function plan() {
  return buildPlan({
    id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
    items, candidates, classifications, newFolders: [],
  })
}

describe('buildPlan', () => {
  it('只为真正改变位置的书签生成 move 操作', () => {
    const moves = plan().operations.filter((o) => o.type === 'move_bookmark')
    expect(moves.map((o) => (o as { bookmarkId: string }).bookmarkId)).toEqual(['100', '102'])
  })

  it('已在目标目录的书签不产生操作', () => {
    const moves = plan().operations.filter(
      (o) => o.type === 'move_bookmark' && o.bookmarkId === '101',
    )
    expect(moves).toHaveLength(0)
  })

  it('无归属的书签不产生操作', () => {
    const moves = plan().operations.filter(
      (o) => o.type === 'move_bookmark' && o.bookmarkId === '103',
    )
    expect(moves).toHaveLength(0)
  })

  it('move 操作记录原 parent 与原 index，供撤销使用', () => {
    const move = plan().operations.find(
      (o) => o.type === 'move_bookmark' && o.bookmarkId === '100',
    ) as Extract<import('@/core/types').BookmarkOperation, { type: 'move_bookmark' }>
    expect(move.fromParentId).toBe('11')
    expect(move.originalIndex).toBe(3)
  })

  it('rows 给出可读的前后路径对比', () => {
    const row = plan().rows.find((r) => r.bookmarkId === '100')!
    expect(row.fromPath).toEqual(['书签栏', '论文'])
    expect(row.toPath).toEqual(['书签栏', 'react'])
    expect(row.reason).toBe('React 官网')
  })

  it('summary 统计正确', () => {
    expect(plan().summary).toEqual({
      totalBookmarks: 4,
      movedBookmarks: 2,
      unchangedBookmarks: 2,
      createdFolders: 0,
      renamedFolders: 0,
      renamedBookmarks: 0,
      lowConfidenceItems: 1,
    })
  })

  it('置信度低于阈值的计入 lowConfidenceItems', () => {
    expect(MARK_CONFIDENCE).toBe(0.85)
    expect(plan().rows.filter((r) => r.confidence < MARK_CONFIDENCE)).toHaveLength(1)
  })

  it('新建文件夹时 create_folder 操作排在 move 之前', () => {
    const p = buildPlan({
      id: 'p2', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [items[0]!], candidates: [{ id: 'tmp:1', path: ['书签栏', '前端'] }],
      classifications: [{ bookmarkId: '100', targetCategoryId: 'tmp:1', confidence: 0.9, reason: 'r', source: 'llm' }],
      newFolders: [{ temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '前端' }],
    })
    expect(p.operations[0]!.type).toBe('create_folder')
    expect(p.operations[1]!.type).toBe('move_bookmark')
    expect(p.summary.createdFolders).toBe(1)
  })

  it('指向临时目录的 move 记录 toTemporaryId', () => {
    const p = buildPlan({
      id: 'p3', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [items[0]!], candidates: [{ id: 'tmp:1', path: ['书签栏', '前端'] }],
      classifications: [{ bookmarkId: '100', targetCategoryId: 'tmp:1', confidence: 0.9, reason: 'r', source: 'llm' }],
      newFolders: [{ temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '前端' }],
    })
    const move = p.operations[1]! as Extract<import('@/core/types').BookmarkOperation, { type: 'move_bookmark' }>
    expect(move.toTemporaryId).toBe('tmp:1')
  })
})

describe('filterAccepted', () => {
  it('剔除未被接受的 move', () => {
    const ops = filterAccepted(plan(), new Set(['100']))
    expect(ops.filter((o) => o.type === 'move_bookmark')).toHaveLength(1)
  })

  it('剔除没有任何书签使用的 create_folder', () => {
    const p = buildPlan({
      id: 'p4', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [items[0]!], candidates: [{ id: 'tmp:1', path: ['书签栏', '前端'] }],
      classifications: [{ bookmarkId: '100', targetCategoryId: 'tmp:1', confidence: 0.9, reason: 'r', source: 'llm' }],
      newFolders: [{ temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '前端' }],
    })
    expect(filterAccepted(p, new Set())).toHaveLength(0)
  })

  it('保留被使用的 create_folder 及其祖先', () => {
    const p = buildPlan({
      id: 'p5', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [items[0]!], candidates: [{ id: 'tmp:2', path: ['书签栏', '开发', '前端'] }],
      classifications: [{ bookmarkId: '100', targetCategoryId: 'tmp:2', confidence: 0.9, reason: 'r', source: 'llm' }],
      newFolders: [
        { temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '开发' },
        { temporaryId: 'tmp:2', parentId: null, parentTemporaryId: 'tmp:1', title: '前端' },
      ],
    })
    const ops = filterAccepted(p, new Set(['100']))
    expect(ops.filter((o) => o.type === 'create_folder')).toHaveLength(2)
    expect(ops[0]!.type).toBe('create_folder')
  })
})

describe('summarize', () => {
  it('按已接受的集合重新统计', () => {
    expect(summarize(plan(), new Set(['100'])).movedBookmarks).toBe(1)
    expect(summarize(plan(), new Set(['100'])).unchangedBookmarks).toBe(3)
  })
})

describe('renumberPlan', () => {
  const candidates3: CategoryCandidate[] = [
    { id: 'tmp:1', path: ['01 AI'] },
    { id: 'tmp:2', path: ['01 AI', '01 rag'] },
    { id: 'tmp:3', path: ['02 开发'] },
    { id: 'tmp:4', path: ['03 学习'] },
    { id: 'tmp:5', path: ['04 金融'] },
  ]
  const items3: BookmarkItem[] = ['100', '101', '102'].map((id, i) => ({
    id, title: `T${i}`, url: `https://s${i}.dev`, parentId: '1', index: i, currentPath: ['书签栏'],
  }))
  // 没有任何书签被分到「03 学习」
  const classifications3: Classification[] = [
    { bookmarkId: '100', targetCategoryId: 'tmp:2', confidence: 1, reason: '', source: 'llm' },
    { bookmarkId: '101', targetCategoryId: 'tmp:3', confidence: 1, reason: '', source: 'llm' },
    { bookmarkId: '102', targetCategoryId: 'tmp:5', confidence: 1, reason: '', source: 'llm' },
  ]

  function rebuildPlan() {
    return buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
      items: items3, candidates: candidates3, classifications: classifications3,
      newFolders: candidates3.map((c) => ({
        temporaryId: c.id, parentId: '1', parentTemporaryId: null, title: c.path.at(-1)!,
      })),
    })
  }

  const allAccepted = new Set(['100', '101', '102'])

  it('没收到书签的目录不占号，编号保持连续', () => {
    const plan = renumberPlan(rebuildPlan(), allAccepted)
    const tops = plan.candidates.filter((c) => c.path.length === 1).map((c) => c.path[0])
    // 学习没收到书签，不参与编号，也不再顶着一个不会存在的号码
    expect(tops).toEqual(['01 AI', '02 开发', '学习', '03 金融'])
  })

  it('子目录跟着父级前缀一起重排', () => {
    const plan = renumberPlan(rebuildPlan(), allAccepted)
    expect(plan.candidates.find((c) => c.id === 'tmp:2')!.path).toEqual(['01 AI', '01 rag'])
  })

  it('取消勾选导致某个目录空掉时，后面的目录顶上来', () => {
    const plan = renumberPlan(rebuildPlan(), new Set(['101', '102']))
    const numbered = plan.candidates
      .filter((c) => c.path.length === 1 && /^\d/.test(c.path[0]!))
      .map((c) => c.path[0])
    expect(numbered).toEqual(['01 开发', '02 金融'])
  })

  it('create_folder 的标题与候选目录同步更新', () => {
    const plan = renumberPlan(rebuildPlan(), new Set(['102']))
    const created = plan.operations.find((o) => o.type === 'create_folder' && o.temporaryId === 'tmp:5')
    expect((created as { title: string }).title).toBe('01 金融')
  })

  it('rows 的目标路径同步更新，预览与最终一致', () => {
    const plan = renumberPlan(rebuildPlan(), allAccepted)
    expect(plan.rows.find((r) => r.bookmarkId === '102')!.toPath).toEqual(['03 金融'])
  })

  it('一级目录一律编号，本轮没收到书签的已有目录也不例外', () => {
    const base = buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
      items: items3, candidates: candidates3, classifications: classifications3,
      newFolders: [],
      renameFolders: [
        { folderId: 'tmp:4', oldTitle: '学习', newTitle: '03 学习' },
        { folderId: 'tmp:3', oldTitle: '开发', newTitle: '02 开发' },
      ],
    })
    const renumbered = renumberPlan(base, allAccepted)
    const tops = renumbered.candidates.filter((c) => c.path.length === 1).map((c) => c.path[0])
    // 学习没收到书签，但它是范围内真实存在的一级目录，照样占号
    expect(tops).toEqual(['01 AI', '02 开发', '03 学习', '04 金融'])
    expect(renumbered.operations).toContainEqual(
      { type: 'rename_folder', folderId: 'tmp:4', oldTitle: '学习', newTitle: '03 学习' },
    )
  })

  it('非推翻模式原样返回，不动用户自己的目录名', () => {
    const untouched = plan()
    expect(renumberPlan(untouched, new Set(['100']))).toBe(untouched)
  })
})

/**
 * 「这一行显示什么路径」与「哪些目录会被创建」是两件事：
 * 取消勾选一行不该让它的目标目录编号凭空消失，只要那个目录因为别的行仍会被建出来。
 */
describe('renumberPlan 未勾选的行仍显示目标目录编号', () => {
  const twoIntoOne = (): OrganizePlan =>
    buildPlan({
      id: 'p-strand', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
      items: ['a', 'b'].map((id, i) => ({
        id, title: `T${id}`, url: `https://${id}.dev`, parentId: '1', index: i, currentPath: ['书签栏'],
      })),
      candidates: [{ id: 'tmp:1', path: ['前端'] }],
      classifications: ['a', 'b'].map((id) => ({
        bookmarkId: id, targetCategoryId: 'tmp:1', confidence: 1, reason: '', source: 'llm' as const,
      })),
      newFolders: [{ temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '前端' }],
    })

  it('目录因别的行仍会被创建时，未勾选的行照样显示编号', () => {
    const next = renumberPlan(twoIntoOne(), new Set(['b']), [])
    expect(next.rows.find((r) => r.bookmarkId === 'a')!.toPath).toEqual(['01 前端'])
  })

  it('一条都没接受、目录根本不会被创建时，显示裸名字', () => {
    const next = renumberPlan(twoIntoOne(), new Set(), [])
    expect(next.rows.find((r) => r.bookmarkId === 'a')!.toPath).toEqual(['前端'])
  })
})

/**
 * 多轮整理场景：上一轮留下的编号目录本轮没被设计到，
 * 如果不管它们，就会和本轮的新号撞车（04 金融 与 04 其他并存）。
 */
describe('renumberPlan 重排上一轮遗留的编号目录', () => {
  const scopeFolders = [
    { id: '1', parentId: '0', title: '书签栏', depth: 0 },
    { id: 'f-github', parentId: '1', title: '01 GitHub', depth: 1 },
    { id: 'f-ai', parentId: '1', title: '02 AI', depth: 1 },
    { id: 'f-dify', parentId: 'f-ai', title: '02.1 dify', depth: 2 },
    { id: 'f-avatar', parentId: 'f-ai', title: '01.6 数字人', depth: 2 },
    { id: 'f-finance', parentId: '1', title: '03 金融', depth: 1 },
    { id: 'f-fastapi', parentId: '1', title: 'fastapi', depth: 1 },
    { id: 'f-notes', parentId: 'f-ai', title: '我的笔记', depth: 2 },
  ]

  // 本轮只设计了 GitHub、AI（含子目录 dify）和兜底的「其他」
  const designed: CategoryCandidate[] = [
    { id: 'f-github', path: ['01 GitHub'] },
    { id: 'f-ai', path: ['02 AI'] },
    { id: 'f-dify', path: ['02 AI', '01 dify'] },
    { id: 'tmp:1', path: ['03 其他'] },
  ]

  function multiRoundPlan() {
    return buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
      items: [
        { id: '200', title: 'dify 文档', url: 'https://dify.ai', parentId: '1', index: 0, currentPath: ['书签栏'] },
        { id: '201', title: '杂项', url: 'https://misc.dev', parentId: '1', index: 1, currentPath: ['书签栏'] },
      ],
      candidates: designed,
      classifications: [
        { bookmarkId: '200', targetCategoryId: 'f-dify', confidence: 1, reason: '', source: 'llm' },
        { bookmarkId: '201', targetCategoryId: 'tmp:1', confidence: 1, reason: '', source: 'llm' },
      ],
      newFolders: [{ temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '03 其他' }],
      renameFolders: [{ folderId: 'f-dify', oldTitle: '02.1 dify', newTitle: '01 dify' }],
    })
  }

  const titleOf = (ops: BookmarkOperation[], folderId: string): string | undefined =>
    ops.flatMap((o) => (o.type === 'rename_folder' && o.folderId === folderId ? [o.newTitle] : []))[0]

  it('本轮没设计到但带编号的顶级目录接在后面重排，不再撞号', () => {
    const ops = renumberPlan(multiRoundPlan(), new Set(['200', '201']), scopeFolders).operations
    // 设计的三个占 01-03，遗留的金融顺延到 04
    expect(titleOf(ops, 'f-finance')).toBe('04 金融')
  })

  it('本轮没设计到但带编号的子目录跟着父级一起重排', () => {
    const ops = renumberPlan(multiRoundPlan(), new Set(['200', '201']), scopeFolders).operations
    // dify 是本轮设计的子目录占 01，遗留的数字人顺延到 02
    expect(titleOf(ops, 'f-dify')).toBe('01 dify')
    expect(titleOf(ops, 'f-avatar')).toBe('02 数字人')
  })

  it('用户自建的一级目录也必须编号', () => {
    const ops = renumberPlan(multiRoundPlan(), new Set(['200', '201']), scopeFolders).operations
    // 设计的三个占 01-03，遗留的金融 04，用户自建的 fastapi 顺延到 05
    expect(titleOf(ops, 'f-fastapi')).toBe('05 fastapi')
  })

  it('二级里用户自建的目录不编号，保持原样', () => {
    const ops = renumberPlan(multiRoundPlan(), new Set(['200', '201']), scopeFolders).operations
    expect(titleOf(ops, 'f-notes')).toBeUndefined()
  })

  it('勾选是级联的，scopeRootIds 里装着全部子目录也不影响重排', () => {
    // 用户勾一个文件夹，ScopeStep 会连它的所有子文件夹一起勾上，
    // 于是 scopeRootIds 里几乎装着范围内的每个目录。层级只能靠 depth 判断。
    const cascaded = { ...multiRoundPlan(), scopeRootIds: scopeFolders.map((f) => f.id) }
    const ops = renumberPlan(cascaded, new Set(['200', '201']), scopeFolders).operations
    expect(titleOf(ops, 'f-fastapi')).toBe('05 fastapi')
    expect(titleOf(ops, 'f-avatar')).toBe('02 数字人')
  })

  it('范围根本身不参与编号', () => {
    const ops = renumberPlan(multiRoundPlan(), new Set(['200', '201']), scopeFolders).operations
    expect(titleOf(ops, '1')).toBeUndefined()
  })

  it('给编号已经正确的目录不产生多余的改名操作', () => {
    const ops = renumberPlan(multiRoundPlan(), new Set(['200', '201']), scopeFolders).operations
    // GitHub 本来就是 01，AI 本来就是 02，不必改名
    expect(titleOf(ops, 'f-github')).toBeUndefined()
    expect(titleOf(ops, 'f-ai')).toBeUndefined()
  })

  it('不传 scopeFolders 时行为与改动前一致，只重排候选目录', () => {
    const ops = renumberPlan(multiRoundPlan(), new Set(['200', '201'])).operations
    expect(titleOf(ops, 'f-finance')).toBeUndefined()
    expect(titleOf(ops, 'f-avatar')).toBeUndefined()
    expect(titleOf(ops, 'f-dify')).toBe('01 dify')
  })
})

/** 把 makePlan() 改造成合并模式：所有一级目录挂在新建的容器 tmp:0 下。 */
function makeMergePlan(): OrganizePlan {
  const plan = makePlan()
  const mergeRoot = {
    temporaryId: 'tmp:0', title: 'AI 学习',
    sourceRootIds: ['8', '9'], sourceTitles: ['NiceG', 'b_llm'],
  }
  return {
    ...plan,
    scopeRootIds: ['8', '9'],
    mergeRoot,
    operations: [
      {
        type: 'create_folder' as const,
        temporaryId: 'tmp:0', parentId: '1', parentTemporaryId: null, title: 'AI 学习',
      },
      ...plan.operations.map((o) =>
        o.type === 'create_folder' && o.parentId === '1'
          ? { ...o, parentId: null, parentTemporaryId: 'tmp:0' }
          : o,
      ),
    ],
    rows: plan.rows.map((r) => ({ ...r, toPath: [mergeRoot.title, ...r.toPath] })),
  }
}

describe('renumberPlan 合并模式', () => {
  const all = (plan: OrganizePlan): Set<string> => new Set(plan.rows.map((r) => r.bookmarkId))

  it('合并根不参与编号，标题原样保留', () => {
    const plan = makeMergePlan()
    const next = renumberPlan(plan, all(plan), [])
    const create = next.operations.find(
      (o) => o.type === 'create_folder' && o.temporaryId === 'tmp:0',
    )
    expect(create).toMatchObject({ title: 'AI 学习' })
  })

  it('rows 的 toPath 仍带合并根前缀', () => {
    const plan = makeMergePlan()
    const next = renumberPlan(plan, all(plan), [])
    for (const row of next.rows) expect(row.toPath[0]).toBe('AI 学习')
    expect(next.rows.find((r) => r.bookmarkId === 'r0')!.toPath).toHaveLength(3)
  })

  it('合并模式下不给范围内的遗留目录改名', () => {
    const plan = makeMergePlan()
    const scopeFolders = [
      { id: '80', parentId: '8', title: '旧的子目录', depth: 1 },
      { id: '90', parentId: '9', title: '01 另一个旧的', depth: 1 },
    ]
    const next = renumberPlan(plan, all(plan), scopeFolders)
    expect(next.operations.filter((o) => o.type === 'rename_folder')).toEqual([])
  })

  it('非合并模式仍然给遗留目录改名', () => {
    const plan = makePlan()
    const scopeFolders = [{ id: '80', parentId: '1', title: '旧的子目录', depth: 1 }]
    const next = renumberPlan(plan, all(plan), scopeFolders)
    expect(next.operations.some((o) => o.type === 'rename_folder' && o.folderId === '80')).toBe(true)
  })
})

describe('buildPlan 合并模式', () => {
  const input = {
    id: 'p', createdAt: 0, scopeRootIds: ['10', '11'], rebuildStructure: true,
    items: [{
      id: 'b1', title: 'React', url: 'https://react.dev',
      parentId: '10', index: 0, currentPath: ['NiceG'],
    }],
    candidates: [{ id: 'tmp:2', path: ['01 前端'] }],
    classifications: [{
      bookmarkId: 'b1', targetCategoryId: 'tmp:2', confidence: 1, reason: 'r', source: 'llm' as const,
    }],
    newFolders: [
      { temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: 'AI 学习' },
      { temporaryId: 'tmp:2', parentId: null, parentTemporaryId: 'tmp:1', title: '01 前端' },
    ],
  }

  const mergeRoot = {
    temporaryId: 'tmp:1', title: 'AI 学习',
    sourceRootIds: ['10', '11'], sourceTitles: ['NiceG', 'b_llm'],
  }

  it('rows 的 toPath 前置合并根名字', () => {
    const plan = buildPlan({ ...input, mergeRoot })
    expect(plan.rows[0]!.toPath).toEqual(['AI 学习', '01 前端'])
  })

  it('plan.mergeRoot 被透传', () => {
    const plan = buildPlan({ ...input, mergeRoot })
    expect(plan.mergeRoot).toEqual(mergeRoot)
  })

  it('非合并模式 toPath 不变、mergeRoot 为 null', () => {
    const plan = buildPlan(input)
    expect(plan.rows[0]!.toPath).toEqual(['01 前端'])
    expect(plan.mergeRoot).toBeNull()
  })
})

describe('buildPlan 的未变动区', () => {
  const item = (id: string, parentId: string) => ({
    id, title: `书签 ${id}`, url: `https://x.dev/${id}`, parentId, index: 0, currentPath: ['收件箱'],
  })

  it('已经在目标目录里的书签进未变动区，记为「已在正确位置」', () => {
    const plan = buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [item('a', '10')],
      candidates: [{ id: '10', path: ['前端'] }],
      classifications: [
        { bookmarkId: 'a', targetCategoryId: '10', confidence: 0.9, reason: 'r', source: 'llm' },
      ],
      newFolders: [], renameFolders: [], warnings: [], tags: [], titleRewrites: [],
    })

    expect(plan.rows).toHaveLength(0)
    expect(plan.unchanged).toEqual([
      expect.objectContaining({ bookmarkId: 'a', kind: 'inPlace' }),
    ])
  })

  it('模型判「没有合适目录」的进未变动区，记为 noTarget，并带上它的理由', () => {
    const plan = buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [item('a', '99')],
      candidates: [{ id: '10', path: ['前端'] }],
      classifications: [
        { bookmarkId: 'a', targetCategoryId: null, confidence: 0, reason: '无合适目录', source: 'llm' },
      ],
      newFolders: [], renameFolders: [], warnings: [], tags: [], titleRewrites: [],
    })

    expect(plan.unchanged).toEqual([
      expect.objectContaining({ bookmarkId: 'a', kind: 'noTarget', reason: '无合适目录' }),
    ])
  })

  it('分类失败的记为 failed——它与「没有合适目录」是两件事，不能混在一起', () => {
    const plan = buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [item('a', '99')],
      candidates: [{ id: '10', path: ['前端'] }],
      classifications: [
        { bookmarkId: 'a', targetCategoryId: null, confidence: 0, reason: '分类失败：超时', source: 'none' },
      ],
      newFolders: [], renameFolders: [], warnings: [], tags: [], titleRewrites: [],
    })

    expect(plan.unchanged[0]!.kind).toBe('failed')
  })

  it('压根没被分类过的也算 failed——它同样是「这次没盖到」', () => {
    const plan = buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [item('a', '99')],
      candidates: [{ id: '10', path: ['前端'] }],
      classifications: [],
      newFolders: [], renameFolders: [], warnings: [], tags: [], titleRewrites: [],
    })

    expect(plan.unchanged[0]!.kind).toBe('failed')
  })

  it('真的要移动的书签照旧只进 rows，不进未变动区', () => {
    const plan = buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [item('a', '99')],
      candidates: [{ id: '10', path: ['前端'] }],
      classifications: [
        { bookmarkId: 'a', targetCategoryId: '10', confidence: 0.9, reason: 'r', source: 'rule' },
      ],
      newFolders: [], renameFolders: [], warnings: [], tags: [], titleRewrites: [],
    })

    expect(plan.unchanged).toEqual([])
    expect(plan.rows).toHaveLength(1)
    // source 一路带到行上——复核页要靠它把规则命中的组整组折叠
    expect(plan.rows[0]!.source).toBe('rule')
  })
})

describe('MARK_CONFIDENCE', () => {
  it('阈值是 0.85——0.7 在真实数据上 110 条里只筛出 1 条，形同虚设', () => {
    expect(MARK_CONFIDENCE).toBe(0.85)
  })
})

describe('retargetRow', () => {
  const base = () => buildPlan({
    id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
    items: [{ id: 'a', title: 'A', url: 'https://a.dev', parentId: '99', index: 0, currentPath: ['收件箱'] }],
    candidates: [{ id: 'tmp:1', path: ['前端'] }, { id: 'tmp:2', path: ['后端'] }],
    classifications: [
      { bookmarkId: 'a', targetCategoryId: 'tmp:1', confidence: 0.9, reason: 'r', source: 'llm' },
    ],
    newFolders: [
      { temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '前端' },
      { temporaryId: 'tmp:2', parentId: '1', parentTemporaryId: null, title: '后端' },
    ],
    renameFolders: [], warnings: [], tags: [], titleRewrites: [],
  })

  it('改目标之后，行与移动操作都指向新目录', () => {
    const next = retargetRow(base(), 'a', 'tmp:2')

    expect(next.rows[0]!.toPath).toEqual(['后端'])
    // row 自己也要记住新目标 id——下拉的当前值直接读它，不再拿 toPath 反查候选（见 I2）
    expect(next.rows[0]!.toCategoryId).toBe('tmp:2')
    const move = next.operations.find((o) => o.type === 'move_bookmark')!
    expect(move).toMatchObject({ toCategoryId: 'tmp:2', toTemporaryId: 'tmp:2' })
  })

  // I3：buildPlan（plan.ts:134）与 applyStructureEdits（structure.ts:197）写 toPath 时都带着
  // 合并根前缀，retargetRow 早先漏了这一处，合并模式下改投会丢掉前缀、跟同一份列表里
  // 别的行（都带着前缀）对不上，还会因此自成一组。
  it('合并模式下改投，toPath 仍带着合并根前缀——与 buildPlan、applyStructureEdits 两处写法一致', () => {
    const plan = {
      ...base(),
      mergeRoot: {
        temporaryId: 'tmp:0', title: '合并根',
        sourceRootIds: ['8', '9'], sourceTitles: ['旧a', '旧b'],
      },
    }
    const next = retargetRow(plan, 'a', 'tmp:2')

    expect(next.rows[0]!.toPath).toEqual(['合并根', '后端'])
    expect(next.rows[0]!.toCategoryId).toBe('tmp:2')
  })

  it('改成已有目录时 toTemporaryId 为 null——它不是本轮新建的', () => {
    const plan = { ...base(), candidates: [...base().candidates, { id: '77', path: ['已有目录'] }] }
    const next = retargetRow(plan, 'a', '77')

    const move = next.operations.find((o) => o.type === 'move_bookmark')!
    expect(move).toMatchObject({ toCategoryId: '77', toTemporaryId: null })
  })

  it('目标不存在时原样返回，不产出一个指向空目录的方案', () => {
    const plan = base()
    expect(retargetRow(plan, 'a', '不存在')).toBe(plan)
  })

  it('不改动别的行', () => {
    const plan = base()
    const next = retargetRow(plan, '不存在的书签', 'tmp:2')
    expect(next).toBe(plan)
  })
})
