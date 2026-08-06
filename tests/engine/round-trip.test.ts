import { describe, it, expect } from 'vitest'
import { applyPlan } from '@/engine/apply'
import { undoLast } from '@/engine/undo'
import { buildPlan } from '@/core/plan'
import { scanTree } from '@/core/scan'
import { buildCandidatesFromFolders } from '@/core/map'
import { createFakeBookmarks, type TreeSpec } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import type { Classification } from '@/core/types'
import type { BookmarksApi } from '@/core/ports'

const messyTree: TreeSpec[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'React 官网', url: 'https://react.dev' },
        { id: '101', title: '某篇论文', url: 'https://arxiv.org/abs/2301.1' },
      ]},
      { id: '11', title: '论文', children: [
        { id: '110', title: 'Router', url: 'https://reactrouter.com' },
      ]},
      { id: '12', title: 'blogs', children: [
        { id: '120', title: '博客一', url: 'https://blog.a.dev/x' },
        { id: '121', title: '博客二', url: 'https://blog.b.dev/y' },
        { id: '122', title: 'GitHub 仓库', url: 'https://github.com/facebook/react' },
      ]},
      { id: '13', title: '空的', children: [] },
    ]},
    { id: '2', title: '其他书签', children: [
      { id: '200', title: '范围外', url: 'https://outside.dev' },
    ]},
  ]},
]

/** 构造一个把所有书签打散到各处的 Plan。 */
function buildMessyPlan(fakeStructureSource: ReturnType<typeof createFakeBookmarks>) {
  return async () => {
    const tree = await fakeStructureSource.api.getTree()
    const scan = scanTree(tree, ['1'])
    const candidates = buildCandidatesFromFolders(scan.folders, ['1'])
    const targets = ['10', '11', '12', '13']
    const classifications: Classification[] = scan.bookmarks.map((b, i) => ({
      bookmarkId: b.id,
      targetCategoryId: targets[i % targets.length]!,
      confidence: 0.9,
      reason: '测试用',
      source: 'llm',
    }))
    return buildPlan({
      id: 'rt', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: scan.bookmarks, candidates, classifications,
      newFolders: [
        { temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '新目录' },
      ],
    })
  }
}

describe('Apply → Undo 往返一致性', () => {
  it('全部接受后撤销，树结构与初始完全一致', async () => {
    const fake = createFakeBookmarks(messyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const before = fake.structure()

    const plan = await buildMessyPlan(fake)()
    const accepted = new Set(plan.rows.map((r) => r.bookmarkId))
    const applyResult = await applyPlan(ports, plan, accepted, 'zh_CN')
    expect(applyResult.status).toBe('completed')
    expect(fake.structure()).not.toBe(before)

    const undoResult = await undoLast(ports, 'zh_CN')
    expect(undoResult.skipped).toEqual([])
    expect(fake.structure()).toBe(before)
  })

  it('部分接受后撤销，同样完全还原', async () => {
    const fake = createFakeBookmarks(messyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const before = fake.structure()

    const plan = await buildMessyPlan(fake)()
    const accepted = new Set(plan.rows.slice(0, 2).map((r) => r.bookmarkId))
    await applyPlan(ports, plan, accepted, 'zh_CN')
    await undoLast(ports, 'zh_CN')
    expect(fake.structure()).toBe(before)
  })

  it('新建文件夹后撤销，新建的文件夹被清理干净', async () => {
    const fake = createFakeBookmarks(messyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const before = fake.structure()

    const tree = await fake.api.getTree()
    const scan = scanTree(tree, ['1'])
    const plan = buildPlan({
      id: 'rt2', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: scan.bookmarks,
      candidates: [{ id: 'tmp:2', path: ['书签栏', '开发', '前端'] }],
      classifications: scan.bookmarks.map((b) => ({
        bookmarkId: b.id, targetCategoryId: 'tmp:2', confidence: 0.9, reason: 'r', source: 'llm' as const,
      })),
      newFolders: [
        { temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '开发' },
        { temporaryId: 'tmp:2', parentId: null, parentTemporaryId: 'tmp:1', title: '前端' },
      ],
    })
    await applyPlan(ports, plan, new Set(plan.rows.map((r) => r.bookmarkId)), 'zh_CN')
    expect(fake.structure()).toContain('书签栏/开发/前端/')

    const result = await undoLast(ports, 'zh_CN')
    expect(result.removedFolders).toBe(2)
    expect(fake.structure()).toBe(before)
  })

  it('清理空文件夹后撤销，被删的目录连同结构一起还原', async () => {
    const fake = createFakeBookmarks(messyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const before = fake.structure()

    // 全部书签集中到 react，其余目录（含本来就空的「空的」）都会被清理
    const scan = scanTree(await fake.api.getTree(), ['1'])
    const plan = buildPlan({
      id: 'rt3', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: scan.bookmarks,
      candidates: buildCandidatesFromFolders(scan.folders, ['1']),
      classifications: scan.bookmarks.map((b) => ({
        bookmarkId: b.id, targetCategoryId: '10', confidence: 0.9, reason: 'r', source: 'llm' as const,
      })),
      newFolders: [],
    })
    const result = await applyPlan(ports, plan, new Set(plan.rows.map((r) => r.bookmarkId)), 'zh_CN', {
      removeEmptyFolders: true,
    })
    expect(result.removedFolders.length).toBeGreaterThan(0)
    expect(fake.structure()).not.toBe(before)

    const undoResult = await undoLast(ports, 'zh_CN')
    expect(undoResult.skipped).toEqual([])
    expect(fake.structure()).toBe(before)
  })

  it('Apply 中途失败后撤销，已执行的部分被完整回滚', async () => {
    const fake = createFakeBookmarks(messyTree)
    let calls = 0
    const move: BookmarksApi['move'] = async (id, dest) => {
      calls++
      if (calls === 3) throw new Error('模拟中途失败')
      return fake.api.move(id, dest)
    }
    const ports = { bookmarks: { ...fake.api, move }, storage: createFakeStorage() }
    const before = fake.structure()

    const plan = await buildMessyPlan(fake)()
    const applyResult = await applyPlan(ports, plan, new Set(plan.rows.map((r) => r.bookmarkId)), 'zh_CN')
    expect(applyResult.status).toBe('failed')
    expect(fake.structure()).not.toBe(before)

    const undoPorts = { bookmarks: fake.api, storage: ports.storage }
    await undoLast(undoPorts, 'zh_CN')
    expect(fake.structure()).toBe(before)
  })

  it('范围外的书签在 Apply 与 Undo 全程都不被触碰', async () => {
    const fake = createFakeBookmarks(messyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }

    const plan = await buildMessyPlan(fake)()
    await applyPlan(ports, plan, new Set(plan.rows.map((r) => r.bookmarkId)), 'zh_CN')
    expect(fake.structure()).toContain('其他书签/范围外')
    expect((await fake.api.get('200'))!.parentId).toBe('2')

    await undoLast(ports, 'zh_CN')
    expect((await fake.api.get('200'))!.parentId).toBe('2')
  })

  it('用户在 Apply 后手动改动过的书签不被撤销覆盖，其余仍完整还原', async () => {
    const fake = createFakeBookmarks(messyTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }

    const plan = await buildMessyPlan(fake)()
    await applyPlan(ports, plan, new Set(plan.rows.map((r) => r.bookmarkId)), 'zh_CN')
    await fake.api.update('100', { title: '我自己改的名字' })

    const result = await undoLast(ports, 'zh_CN')
    expect(result.skipped.some((s) => s.id === '100')).toBe(true)
    expect((await fake.api.get('100'))!.title).toBe('我自己改的名字')
    // 其余书签仍回到原位
    expect((await fake.api.get('110'))!.parentId).toBe('11')
    expect((await fake.api.get('122'))!.parentId).toBe('12')
  })
})
