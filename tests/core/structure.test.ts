import { describe, it, expect } from 'vitest'
import { stripNumberPrefix } from '@/core/map'
import { applyStructureEdits, buildStructureView, EMPTY_EDITS } from '@/core/structure'
import type { BookmarkOperation, OrganizePlan, PlanRow } from '@/core/types'
import { makePlan } from '../fakes/plan'

/** 某个书签最终落到哪个 candidate id。 */
function targetOf(plan: OrganizePlan, bookmarkId: string): string | null {
  const move = plan.operations.find(
    (o) => o.type === 'move_bookmark' && o.bookmarkId === bookmarkId,
  )
  return move === undefined || move.type !== 'move_bookmark' ? null : move.toCategoryId
}

/** 把 makePlan() 里兜底目录的名字换成英文，用于验证 locale='en' 时的判定。 */
function makePlanWithEnglishFallback(): OrganizePlan {
  const plan = makePlan()
  return {
    ...plan,
    candidates: plan.candidates.map((c) => (c.id === 'tmp:5' ? { ...c, path: ['03 Other'] } : c)),
  }
}

describe('buildStructureView', () => {
  it('产出两层结构，标题不含编号前缀', () => {
    const view = buildStructureView(makePlan(), EMPTY_EDITS, 'zh_CN')
    expect(view.map((n) => n.title)).toEqual(['GitHub', '前端', '其他'])
    expect(view[0]!.children.map((n) => n.title)).toEqual(['AI 工具'])
    expect(view[1]!.children.map((n) => n.title)).toEqual(['React'])
  })

  it('count 统计本节点与子节点将移入的书签数', () => {
    const view = buildStructureView(makePlan(), EMPTY_EDITS, 'zh_CN')
    expect(view[0]!.count).toBe(2)
    expect(view[1]!.count).toBe(2)
    expect(view[1]!.children[0]!.count).toBe(1)
  })

  it('「其他」不可删，其余可删', () => {
    const view = buildStructureView(makePlan(), EMPTY_EDITS, 'zh_CN')
    expect(view.find((n) => n.title === '其他')!.removable).toBe(false)
    expect(view.find((n) => n.title === 'GitHub')!.removable).toBe(true)
    expect(view[1]!.children[0]!.removable).toBe(true)
  })

  it('已删除的节点不出现在视图里', () => {
    const view = buildStructureView(makePlan(), { renames: {}, removed: ['tmp:4'], mergedInto: {} }, 'zh_CN')
    expect(view[1]!.children).toEqual([])
  })

  it('改名反映在视图标题上', () => {
    const view = buildStructureView(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [], mergedInto: {} }, 'zh_CN')
    expect(view[0]!.title).toBe('代码仓库')
  })

  it('英文下「Other」被判定为不可删的兜底目录', () => {
    const view = buildStructureView(makePlanWithEnglishFallback(), EMPTY_EDITS, 'en')
    expect(view.find((n) => n.title === 'Other')!.removable).toBe(false)
    expect(view.find((n) => n.title === 'GitHub')!.removable).toBe(true)
  })
})

describe('applyStructureEdits 改名', () => {
  it('写回裸名字，不带编号前缀', () => {
    const next = applyStructureEdits(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [], mergedInto: {} }, 'zh_CN')
    expect(next.candidates.find((c) => c.id === 'tmp:1')!.path).toEqual(['代码仓库'])
  })

  it('父目录改名后子目录的 path 跟着变', () => {
    const next = applyStructureEdits(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [], mergedInto: {} }, 'zh_CN')
    expect(next.candidates.find((c) => c.id === 'tmp:2')!.path).toEqual(['代码仓库', 'AI 工具'])
  })

  it('create_folder 的标题同步改名', () => {
    const next = applyStructureEdits(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [], mergedInto: {} }, 'zh_CN')
    const create = next.operations.find((o) => o.type === 'create_folder' && o.temporaryId === 'tmp:1')!
    expect(create.type === 'create_folder' && create.title).toBe('代码仓库')
  })

  it('rows 的 toPath 同步改名', () => {
    const next = applyStructureEdits(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [], mergedInto: {} }, 'zh_CN')
    expect(next.rows.find((r) => r.bookmarkId === 'g0')!.toPath).toEqual(['代码仓库', 'AI 工具'])
  })
})

describe('applyStructureEdits 删除', () => {
  it('删一级主题目录，书签回落到「其他」', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3'], mergedInto: {} }, 'zh_CN')
    expect(targetOf(next, 'f0')).toBe('tmp:5')
  })

  it('删一级主题目录时它的子目录一并消失，子目录里的书签也落到「其他」', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3'], mergedInto: {} }, 'zh_CN')
    expect(next.candidates.some((c) => c.id === 'tmp:4')).toBe(false)
    expect(targetOf(next, 'r0')).toBe('tmp:5')
  })

  it('删二级子目录，书签回落到父目录而非「其他」', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:4'], mergedInto: {} }, 'zh_CN')
    expect(targetOf(next, 'r0')).toBe('tmp:3')
  })

  it('删聚合目录，书签按 primaryTopic 回落到同名主题目录', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:1'], mergedInto: {} }, 'zh_CN')
    expect(targetOf(next, 'g0')).toBe('tmp:3') // primaryTopic 为「前端」
  })

  it('删聚合目录时没有同名主题目录的书签落到「其他」', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:1'], mergedInto: {} }, 'zh_CN')
    expect(targetOf(next, 'g1')).toBe('tmp:5') // primaryTopic 为「冷门」，无同名目录
  })

  it('英文下删聚合目录，没有同名主题目录的书签落到 Other', () => {
    const next = applyStructureEdits(
      makePlanWithEnglishFallback(), { renames: {}, removed: ['tmp:1'], mergedInto: {} }, 'en',
    )
    expect(targetOf(next, 'g1')).toBe('tmp:5')
  })

  it('被删的目录不再产生 create_folder', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3'], mergedInto: {} }, 'zh_CN')
    const created = next.operations
      .filter((o) => o.type === 'create_folder')
      .map((o) => (o.type === 'create_folder' ? o.temporaryId : ''))
    expect(created).not.toContain('tmp:3')
    expect(created).not.toContain('tmp:4')
  })

  it('被删的目录从 candidates 里移除', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3', 'tmp:4'], mergedInto: {} }, 'zh_CN')
    expect(next.candidates.map((c) => c.id)).toEqual(['tmp:1', 'tmp:2', 'tmp:5'])
  })

  it('回落后 rows 的 toPath 指向新目录', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:4'], mergedInto: {} }, 'zh_CN')
    expect(next.rows.find((r) => r.bookmarkId === 'r0')!.toPath).toEqual(['前端'])
  })

  it('回落到已存在目录时 toTemporaryId 指向该目录', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:4'], mergedInto: {} }, 'zh_CN')
    const move = next.operations.find((o) => o.type === 'move_bookmark' && o.bookmarkId === 'r0')!
    expect(move.type === 'move_bookmark' && move.toTemporaryId).toBe('tmp:3')
  })

  it('summary 反映删除后的目录数', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3', 'tmp:4'], mergedInto: {} }, 'zh_CN')
    expect(next.summary.createdFolders).toBe(3)
    expect(next.summary.movedBookmarks).toBe(5)
  })

  it('空编辑返回内容等价的 plan', () => {
    const plan = makePlan()
    const next = applyStructureEdits(plan, EMPTY_EDITS, 'zh_CN')
    // 写回的一律是裸名字，编号由 renumberPlan 统一重排，故只比较去掉编号后的内容
    expect(next.rows).toEqual(
      plan.rows.map((r) => ({ ...r, toPath: r.toPath.map(stripNumberPrefix) })),
    )
    expect(next.candidates.map((c) => c.id)).toEqual(plan.candidates.map((c) => c.id))
  })
})

/**
 * I1：删掉一个目录之后，resolve() 找不到任何回落点（没有兜底目录，或兜底目录自己也被删）时，
 * 早先的实现直接把这条书签从 rows 里丢弃、也不放进 unchanged——「rows 与 unchanged 互斥且完备」
 * 这条不变式出了 buildPlan 就被破坏，复核页上这条书签会一个字都不出现（评审 I1）。
 */
describe('applyStructureEdits 删除后无处可去', () => {
  /** 只有一个一级目录、没有任何「其他」兜底目录的最简 plan。 */
  function orphanPlan(): OrganizePlan {
    return {
      id: 'p', createdAt: 0, scopeRootIds: ['1'], rebuildStructure: true,
      candidates: [{ id: 'tmp:1', path: ['前端'] }],
      operations: [
        { type: 'create_folder', temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '前端' },
        {
          type: 'move_bookmark', bookmarkId: 'a', fromParentId: '9', originalIndex: 0,
          toCategoryId: 'tmp:1', toTemporaryId: 'tmp:1', confidence: 1, reason: 'r',
        },
      ],
      rows: [{
        bookmarkId: 'a', title: '书签 a', url: 'https://a.dev', fromPath: ['收件箱'],
        toPath: ['前端'], toCategoryId: 'tmp:1', confidence: 1, reason: 'r', source: 'llm',
      }],
      unchanged: [], warnings: [], tags: [], mergeRoot: null,
      summary: {
        totalBookmarks: 1, movedBookmarks: 1, unchangedBookmarks: 0,
        createdFolders: 1, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0,
      },
    }
  }

  it('不再从 rows 里凭空消失，而是补进 unchanged，记为 noTarget', () => {
    const next = applyStructureEdits(orphanPlan(), { renames: {}, removed: ['tmp:1'], mergedInto: {} }, 'zh_CN')

    expect(next.rows).toEqual([])
    expect(next.unchanged).toHaveLength(1)
    expect(next.unchanged[0]).toMatchObject({
      bookmarkId: 'a', title: '书签 a', url: 'https://a.dev', currentPath: ['收件箱'], kind: 'noTarget',
    })
    // 理由要说清楚这不是模型判的「没有合适目录」，是用户自己删的
    expect(next.unchanged[0]!.reason).not.toBe('')
  })

  it('summary.unchangedBookmarks 与实际列出的条数一致，不再自相矛盾', () => {
    const next = applyStructureEdits(orphanPlan(), { renames: {}, removed: ['tmp:1'], mergedInto: {} }, 'zh_CN')
    expect(next.summary.unchangedBookmarks).toBe(next.unchanged.length)
    expect(next.summary.unchangedBookmarks).toBe(1)
  })

  it('原有的 unchanged 条目不受影响，新条目追加在后面', () => {
    const plan = orphanPlan()
    const original = {
      bookmarkId: 'b', title: '书签 b', url: 'https://b.dev', currentPath: ['收件箱'],
      kind: 'inPlace' as const, reason: '',
    }
    const next = applyStructureEdits(
      { ...plan, unchanged: [original] }, { renames: {}, removed: ['tmp:1'], mergedInto: {} }, 'zh_CN',
    )
    expect(next.unchanged).toEqual([original, expect.objectContaining({ bookmarkId: 'a', kind: 'noTarget' })])
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

function mergeRootTitle(plan: OrganizePlan): string | undefined {
  const op = plan.operations.find((o) => o.type === 'create_folder' && o.temporaryId === 'tmp:0')
  return op === undefined || op.type !== 'create_folder' ? undefined : op.title
}

describe('applyStructureEdits 合并根', () => {
  it('用户改名写回 create_folder', () => {
    const next = applyStructureEdits(
      makeMergePlan(), { renames: { 'tmp:0': '大模型' }, removed: [], mergedInto: {} }, 'zh_CN',
    )
    expect(mergeRootTitle(next)).toBe('大模型')
  })

  it('rows 的 toPath 首段跟着改名', () => {
    const next = applyStructureEdits(
      makeMergePlan(), { renames: { 'tmp:0': '大模型' }, removed: [], mergedInto: {} }, 'zh_CN',
    )
    for (const row of next.rows) expect(row.toPath[0]).toBe('大模型')
  })

  it('改成空白时退回原名', () => {
    const next = applyStructureEdits(
      makeMergePlan(), { renames: { 'tmp:0': '   ' }, removed: [], mergedInto: {} }, 'zh_CN',
    )
    expect(mergeRootTitle(next)).toBe('AI 学习')
    expect(next.rows[0]!.toPath[0]).toBe('AI 学习')
  })

  it('合并根不会被删除', () => {
    const next = applyStructureEdits(
      makeMergePlan(), { renames: {}, removed: ['tmp:0'], mergedInto: {} }, 'zh_CN',
    )
    expect(mergeRootTitle(next)).toBe('AI 学习')
  })

  it('非合并模式的 rows 不带前缀', () => {
    const next = applyStructureEdits(makePlan(), EMPTY_EDITS, 'zh_CN')
    expect(next.rows[0]!.toPath[0]).not.toBe('AI 学习')
  })
})

/** 造一份最小 plan，只有本 describe 关心的字段有意义。 */
function planWith(
  candidates: Array<{ id: string; path: string[] }>,
  moves: Array<{ bookmarkId: string; target: string }>,
): OrganizePlan {
  const operations: BookmarkOperation[] = [
    ...candidates.map((c) => ({
      type: 'create_folder' as const,
      temporaryId: c.id,
      parentId: c.path.length === 1 ? '1' : null,
      parentTemporaryId:
        c.path.length === 1
          ? null
          : candidates.find((p) => p.path.length === 1 && p.path[0] === c.path[0])!.id,
      title: c.path.at(-1)!,
    })),
    ...moves.map((m) => ({
      type: 'move_bookmark' as const,
      bookmarkId: m.bookmarkId, fromParentId: '9', originalIndex: 0,
      toCategoryId: m.target, toTemporaryId: m.target, confidence: 1, reason: 'r',
    })),
  ]
  const rows: PlanRow[] = moves.map((m) => ({
    bookmarkId: m.bookmarkId, title: m.bookmarkId, url: `https://x/${m.bookmarkId}`,
    fromPath: ['旧'], toPath: candidates.find((c) => c.id === m.target)!.path, toCategoryId: m.target,
    confidence: 1, reason: 'r', source: 'llm',
  }))
  return {
    id: 'p', createdAt: 0, scopeRootIds: ['1'], rebuildStructure: true,
    candidates, operations, rows, unchanged: [], warnings: [], tags: [], mergeRoot: null,
    summary: {
      totalBookmarks: moves.length, movedBookmarks: moves.length, unchangedBookmarks: 0,
      createdFolders: candidates.length, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0,
    },
  }
}

describe('applyStructureEdits 的合并', () => {
  it('被合并的目录里的书签改投到接收方', () => {
    const plan = planWith([
      { id: 'tmp:1', path: ['前端'] },
      { id: 'tmp:2', path: ['后端'] },
    ], [{ bookmarkId: 'a', target: 'tmp:1' }])

    const next = applyStructureEdits(plan, {
      renames: {}, removed: ['tmp:1'], mergedInto: { 'tmp:1': 'tmp:2' },
    }, 'zh_CN')

    expect(next.rows[0]!.toCategoryId).toBe('tmp:2')
    expect(next.candidates.map((c) => c.id)).toEqual(['tmp:2'])
  })

  it('合并的去处优先于父目录回落——用户指定的比默认的算数', () => {
    // tmp:2 是 tmp:1 的子目录；把它合并到另一个一级目录 tmp:3，
    // 而不是按默认回落链落回父目录 tmp:1
    const plan = planWith([
      { id: 'tmp:1', path: ['前端'] },
      { id: 'tmp:2', path: ['前端', '构建工具'] },
      { id: 'tmp:3', path: ['工具链'] },
    ], [{ bookmarkId: 'a', target: 'tmp:2' }])

    const next = applyStructureEdits(plan, {
      renames: {}, removed: ['tmp:2'], mergedInto: { 'tmp:2': 'tmp:3' },
    }, 'zh_CN')

    expect(next.rows[0]!.toCategoryId).toBe('tmp:3')
  })

  it('接收方自己也被合并时继续往下走', () => {
    const plan = planWith([
      { id: 'tmp:1', path: ['A'] }, { id: 'tmp:2', path: ['B'] }, { id: 'tmp:3', path: ['C'] },
    ], [{ bookmarkId: 'a', target: 'tmp:1' }])

    const next = applyStructureEdits(plan, {
      renames: {}, removed: ['tmp:1', 'tmp:2'],
      mergedInto: { 'tmp:1': 'tmp:2', 'tmp:2': 'tmp:3' },
    }, 'zh_CN')

    expect(next.rows[0]!.toCategoryId).toBe('tmp:3')
  })

  it('合并成环时不死循环——防环的 seen 已经在链条里', () => {
    const plan = planWith([
      { id: 'tmp:1', path: ['A'] }, { id: 'tmp:2', path: ['B'] },
    ], [{ bookmarkId: 'a', target: 'tmp:1' }])

    const next = applyStructureEdits(plan, {
      renames: {}, removed: ['tmp:1', 'tmp:2'],
      mergedInto: { 'tmp:1': 'tmp:2', 'tmp:2': 'tmp:1' },
    }, 'zh_CN')

    // 两个都没了，书签无处可去——进未变动区，而不是转圈
    expect(next.rows).toHaveLength(0)
    expect(next.unchanged.some((u) => u.bookmarkId === 'a')).toBe(true)
  })
})
