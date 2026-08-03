import { describe, it, expect } from 'vitest'
import { buildPlan, filterAccepted, renumberPlan, summarize, LOW_CONFIDENCE } from '@/core/plan'
import type { BookmarkItem, BookmarkOperation, CategoryCandidate, Classification } from '@/core/types'

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
      lowConfidenceItems: 1,
    })
  })

  it('置信度低于阈值的计入 lowConfidenceItems', () => {
    expect(LOW_CONFIDENCE).toBe(0.7)
    expect(plan().rows.filter((r) => r.confidence < LOW_CONFIDENCE)).toHaveLength(1)
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

  it('本次没派上用场的已有目录不会被改名', () => {
    const base = buildPlan({
      id: 'p', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
      items: items3, candidates: candidates3, classifications: classifications3,
      newFolders: [],
      renameFolders: [
        { folderId: 'tmp:4', oldTitle: '学习', newTitle: '03 学习' },
        { folderId: 'tmp:3', oldTitle: '开发', newTitle: '02 开发' },
      ],
    })
    const renames = renumberPlan(base, allAccepted).operations.filter((o) => o.type === 'rename_folder')
    // 学习没收到书签、名字也没有编号，是用户自己的目录，不该动
    expect(renames.some((o) => o.type === 'rename_folder' && o.folderId === 'tmp:4')).toBe(false)
    expect(renames).toContainEqual(
      { type: 'rename_folder', folderId: 'tmp:3', oldTitle: '开发', newTitle: '02 开发' },
    )
    // 金融是已有目录且带着旧编号，重排后号码变了就必须真的改名，否则磁盘上会留着 04
    expect(renames).toContainEqual(
      { type: 'rename_folder', folderId: 'tmp:5', oldTitle: '04 金融', newTitle: '03 金融' },
    )
  })

  it('非推翻模式原样返回，不动用户自己的目录名', () => {
    const untouched = plan()
    expect(renumberPlan(untouched, new Set(['100']))).toBe(untouched)
  })
})

/**
 * 多轮整理场景：上一轮留下的编号目录本轮没被设计到，
 * 如果不管它们，就会和本轮的新号撞车（04 金融 与 04 其他并存）。
 */
describe('renumberPlan 重排上一轮遗留的编号目录', () => {
  const scopeFolders = [
    { id: '1', parentId: '0', title: '书签栏' },
    { id: 'f-github', parentId: '1', title: '01 GitHub' },
    { id: 'f-ai', parentId: '1', title: '02 AI' },
    { id: 'f-dify', parentId: 'f-ai', title: '02.1 dify' },
    { id: 'f-avatar', parentId: 'f-ai', title: '01.6 数字人' },
    { id: 'f-finance', parentId: '1', title: '03 金融' },
    { id: 'f-fastapi', parentId: '1', title: 'fastapi' },
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

  it('没带编号的用户自建目录不参与重排，也不被改名', () => {
    const ops = renumberPlan(multiRoundPlan(), new Set(['200', '201']), scopeFolders).operations
    expect(titleOf(ops, 'f-fastapi')).toBeUndefined()
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
