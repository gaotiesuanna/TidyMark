import { describe, it, expect } from 'vitest'
import { stripNumberPrefix } from '@/core/map'
import { applyStructureEdits, buildStructureView, EMPTY_EDITS } from '@/core/structure'
import type { OrganizePlan } from '@/core/types'
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
    const view = buildStructureView(makePlan(), { renames: {}, removed: ['tmp:4'] }, 'zh_CN')
    expect(view[1]!.children).toEqual([])
  })

  it('改名反映在视图标题上', () => {
    const view = buildStructureView(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [] }, 'zh_CN')
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
    const next = applyStructureEdits(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [] }, 'zh_CN')
    expect(next.candidates.find((c) => c.id === 'tmp:1')!.path).toEqual(['代码仓库'])
  })

  it('父目录改名后子目录的 path 跟着变', () => {
    const next = applyStructureEdits(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [] }, 'zh_CN')
    expect(next.candidates.find((c) => c.id === 'tmp:2')!.path).toEqual(['代码仓库', 'AI 工具'])
  })

  it('create_folder 的标题同步改名', () => {
    const next = applyStructureEdits(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [] }, 'zh_CN')
    const create = next.operations.find((o) => o.type === 'create_folder' && o.temporaryId === 'tmp:1')!
    expect(create.type === 'create_folder' && create.title).toBe('代码仓库')
  })

  it('rows 的 toPath 同步改名', () => {
    const next = applyStructureEdits(makePlan(), { renames: { 'tmp:1': '代码仓库' }, removed: [] }, 'zh_CN')
    expect(next.rows.find((r) => r.bookmarkId === 'g0')!.toPath).toEqual(['代码仓库', 'AI 工具'])
  })
})

describe('applyStructureEdits 删除', () => {
  it('删一级主题目录，书签回落到「其他」', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3'] }, 'zh_CN')
    expect(targetOf(next, 'f0')).toBe('tmp:5')
  })

  it('删一级主题目录时它的子目录一并消失，子目录里的书签也落到「其他」', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3'] }, 'zh_CN')
    expect(next.candidates.some((c) => c.id === 'tmp:4')).toBe(false)
    expect(targetOf(next, 'r0')).toBe('tmp:5')
  })

  it('删二级子目录，书签回落到父目录而非「其他」', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:4'] }, 'zh_CN')
    expect(targetOf(next, 'r0')).toBe('tmp:3')
  })

  it('删聚合目录，书签按 primaryTopic 回落到同名主题目录', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:1'] }, 'zh_CN')
    expect(targetOf(next, 'g0')).toBe('tmp:3') // primaryTopic 为「前端」
  })

  it('删聚合目录时没有同名主题目录的书签落到「其他」', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:1'] }, 'zh_CN')
    expect(targetOf(next, 'g1')).toBe('tmp:5') // primaryTopic 为「冷门」，无同名目录
  })

  it('英文下删聚合目录，没有同名主题目录的书签落到 Other', () => {
    const next = applyStructureEdits(
      makePlanWithEnglishFallback(), { renames: {}, removed: ['tmp:1'] }, 'en',
    )
    expect(targetOf(next, 'g1')).toBe('tmp:5')
  })

  it('被删的目录不再产生 create_folder', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3'] }, 'zh_CN')
    const created = next.operations
      .filter((o) => o.type === 'create_folder')
      .map((o) => (o.type === 'create_folder' ? o.temporaryId : ''))
    expect(created).not.toContain('tmp:3')
    expect(created).not.toContain('tmp:4')
  })

  it('被删的目录从 candidates 里移除', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3', 'tmp:4'] }, 'zh_CN')
    expect(next.candidates.map((c) => c.id)).toEqual(['tmp:1', 'tmp:2', 'tmp:5'])
  })

  it('回落后 rows 的 toPath 指向新目录', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:4'] }, 'zh_CN')
    expect(next.rows.find((r) => r.bookmarkId === 'r0')!.toPath).toEqual(['前端'])
  })

  it('回落到已存在目录时 toTemporaryId 指向该目录', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:4'] }, 'zh_CN')
    const move = next.operations.find((o) => o.type === 'move_bookmark' && o.bookmarkId === 'r0')!
    expect(move.type === 'move_bookmark' && move.toTemporaryId).toBe('tmp:3')
  })

  it('summary 反映删除后的目录数', () => {
    const next = applyStructureEdits(makePlan(), { renames: {}, removed: ['tmp:3', 'tmp:4'] }, 'zh_CN')
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
