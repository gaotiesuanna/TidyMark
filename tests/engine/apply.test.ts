import { describe, it, expect, vi } from 'vitest'
import { applyPlan, PROGRESS_KEY } from '@/engine/apply'
import { loadSnapshot } from '@/engine/snapshot'
import { undoLast } from '@/engine/undo'
import { buildPlan } from '@/core/plan'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeStorage } from '../fakes/fake-storage'
import type { BookmarkItem, CategoryCandidate, Classification } from '@/core/types'
import type { BookmarksApi } from '@/core/ports'

const initial = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: 'react', children: [] },
      { id: '11', title: '杂项', children: [
        { id: '100', title: 'React 文档', url: 'https://react.dev' },
        { id: '101', title: 'Router', url: 'https://reactrouter.com' },
      ]},
    ]},
  ]},
]

const items: BookmarkItem[] = [
  { id: '100', title: 'React 文档', url: 'https://react.dev', parentId: '11', index: 0, currentPath: ['书签栏', '杂项'] },
  { id: '101', title: 'Router', url: 'https://reactrouter.com', parentId: '11', index: 1, currentPath: ['书签栏', '杂项'] },
]
const candidates: CategoryCandidate[] = [{ id: '10', path: ['书签栏', 'react'] }]
const classifications: Classification[] = [
  { bookmarkId: '100', targetCategoryId: '10', confidence: 0.9, reason: 'r', source: 'llm' },
  { bookmarkId: '101', targetCategoryId: '10', confidence: 0.9, reason: 'r', source: 'llm' },
]

function makePlan(newFolders: Parameters<typeof buildPlan>[0]['newFolders'] = [], cands = candidates, cls = classifications) {
  return buildPlan({
    id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
    items, candidates: cands, classifications: cls, newFolders,
  })
}

function setup(api?: Partial<BookmarksApi>) {
  const fake = createFakeBookmarks(initial)
  const storage = createFakeStorage()
  return { fake, storage, ports: { bookmarks: { ...fake.api, ...api }, storage } }
}

describe('applyPlan', () => {
  it('执行前保存快照', async () => {
    const { ports } = setup()
    await applyPlan(ports, makePlan(), new Set(['100', '101']))
    const snapshot = await loadSnapshot(ports)
    expect(snapshot!.planId).toBe('p1')
    expect(snapshot!.nodes.find((n) => n.id === '100')!.parentId).toBe('11')
  })

  it('把书签移到目标目录', async () => {
    const { ports, fake } = setup()
    const result = await applyPlan(ports, makePlan(), new Set(['100', '101']))
    expect(result.status).toBe('completed')
    expect(result.executed).toBe(2)
    expect(fake.structure()).toContain('书签栏/react/React 文档')
    expect(fake.structure()).not.toContain('书签栏/杂项/React 文档')
  })

  it('只执行被接受的条目', async () => {
    const { ports, fake } = setup()
    await applyPlan(ports, makePlan(), new Set(['100']))
    expect(fake.structure()).toContain('书签栏/杂项/Router')
  })

  it('新建文件夹并把临时 id 解析成真实 id', async () => {
    const plan = makePlan(
      [{ temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '前端' }],
      [{ id: 'tmp:1', path: ['书签栏', '前端'] }],
      [{ bookmarkId: '100', targetCategoryId: 'tmp:1', confidence: 0.9, reason: 'r', source: 'llm' }],
    )
    const { ports, fake } = setup()
    const result = await applyPlan(ports, plan, new Set(['100']))
    expect(result.createdFolderIds).toHaveLength(1)
    expect(fake.structure()).toContain('书签栏/前端/React 文档')
  })

  it('嵌套新建文件夹按父先子后的顺序创建', async () => {
    const plan = makePlan(
      [
        { temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '开发' },
        { temporaryId: 'tmp:2', parentId: null, parentTemporaryId: 'tmp:1', title: '前端' },
      ],
      [{ id: 'tmp:2', path: ['书签栏', '开发', '前端'] }],
      [{ bookmarkId: '100', targetCategoryId: 'tmp:2', confidence: 0.9, reason: 'r', source: 'llm' }],
    )
    const { ports, fake } = setup()
    await applyPlan(ports, plan, new Set(['100']))
    expect(fake.structure()).toContain('书签栏/开发/前端/React 文档')
  })

  it('新建的文件夹 id 写回快照，供撤销清理', async () => {
    const plan = makePlan(
      [{ temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: '前端' }],
      [{ id: 'tmp:1', path: ['书签栏', '前端'] }],
      [{ bookmarkId: '100', targetCategoryId: 'tmp:1', confidence: 0.9, reason: 'r', source: 'llm' }],
    )
    const { ports } = setup()
    const result = await applyPlan(ports, plan, new Set(['100']))
    expect((await loadSnapshot(ports))!.createdFolderIds).toEqual(result.createdFolderIds)
  })

  it('目标书签已不存在时跳过并记录', async () => {
    const { ports, fake } = setup()
    await fake.api.remove('100')
    const result = await applyPlan(ports, makePlan(), new Set(['100', '101']))
    expect(result.status).toBe('completed')
    expect(result.executed).toBe(1)
    expect(result.skipped).toEqual([{ bookmarkId: '100', reason: '书签已不存在' }])
  })

  it('写操作失败时立即停止，不执行后续操作', async () => {
    const fake = createFakeBookmarks(initial)
    let calls = 0
    const move: BookmarksApi['move'] = async (id, dest) => {
      calls++
      if (calls === 2) throw new Error('模拟失败')
      return fake.api.move(id, dest)
    }
    const ports = { bookmarks: { ...fake.api, move }, storage: createFakeStorage() }
    const result = await applyPlan(ports, makePlan(), new Set(['100', '101']))
    expect(result.status).toBe('failed')
    expect(result.executed).toBe(1)
    expect(result.failedAt).toBe(1)
    expect(result.error).toContain('模拟失败')
    expect(calls).toBe(2)
  })

  it('顺序执行，绝不并发', async () => {
    const fake = createFakeBookmarks(initial)
    let inFlight = 0
    let maxInFlight = 0
    const move: BookmarksApi['move'] = async (id, dest) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      const result = await fake.api.move(id, dest)
      inFlight--
      return result
    }
    const ports = { bookmarks: { ...fake.api, move }, storage: createFakeStorage() }
    await applyPlan(ports, makePlan(), new Set(['100', '101']))
    expect(maxInFlight).toBe(1)
  })

  it('每执行一步就把进度写入存储，供 service worker 休眠后恢复', async () => {
    const { ports, storage } = setup()
    const seen: number[] = []
    const originalSet = storage.set.bind(storage)
    ports.storage = {
      ...storage,
      async set(key, value) {
        if (key === PROGRESS_KEY) seen.push((value as { executed: number }).executed)
        return originalSet(key, value)
      },
    }
    await applyPlan(ports, makePlan(), new Set(['100', '101']))
    expect(seen).toEqual([0, 1, 2])
  })

  it('完成后清除进度记录', async () => {
    const { ports, storage } = setup()
    await applyPlan(ports, makePlan(), new Set(['100', '101']))
    expect(storage.dump()[PROGRESS_KEY]).toBeUndefined()
  })

  it('回报进度', async () => {
    const { ports } = setup()
    const onProgress = vi.fn()
    await applyPlan(ports, makePlan(), new Set(['100', '101']), { onProgress })
    expect(onProgress).toHaveBeenLastCalledWith(2, 2)
  })
})

describe('applyPlan 清理空文件夹', () => {
  it('开启时删掉被搬空的目录', async () => {
    const { ports, fake } = setup()
    const result = await applyPlan(ports, makePlan(), new Set(['100', '101']), {
      removeEmptyFolders: true,
    })
    expect(result.removedFolders.map((f) => f.title)).toEqual(['杂项'])
    expect(fake.structure()).not.toContain('杂项')
  })

  it('默认不清理', async () => {
    const { ports, fake } = setup()
    const result = await applyPlan(ports, makePlan(), new Set(['100', '101']))
    expect(result.removedFolders).toEqual([])
    expect(fake.structure()).toContain('杂项')
  })

  it('还有书签的目录不删', async () => {
    const { ports, fake } = setup()
    await applyPlan(ports, makePlan(), new Set(['100']), { removeEmptyFolders: true })
    expect(fake.structure()).toContain('书签栏/杂项/Router')
  })

  it('删除失败不影响整体结果，记进 skipped', async () => {
    const { ports } = setup({ remove: async () => { throw new Error('boom') } })
    const result = await applyPlan(ports, makePlan(), new Set(['100', '101']), {
      removeEmptyFolders: true,
    })
    expect(result.status).toBe('completed')
    expect(result.removedFolders).toEqual([])
    expect(result.skipped.some((s) => s.reason.includes('boom'))).toBe(true)
  })

  it('整理中途失败时不做清理', async () => {
    const { ports, fake } = setup({
      move: async () => { throw new Error('move 挂了') },
    })
    const result = await applyPlan(ports, makePlan(), new Set(['100', '101']), {
      removeEmptyFolders: true,
    })
    expect(result.status).toBe('failed')
    expect(result.removedFolders).toEqual([])
    expect(fake.structure()).toContain('书签栏/react')
  })
})

describe('applyPlan 按编号排列目录', () => {
  // 编号顺序与实际排列不一致：01 在最后，未编号的在最前
  const messy = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: 'f-fastapi', title: 'fastapi', children: [] },
        { id: 'f-ai', title: '02 AI', children: [
          { id: 'f-rag', title: '02 RAG', children: [] },
          { id: 'f-dify', title: '01 dify', children: [] },
        ]},
        { id: 'f-github', title: '01 GitHub', children: [
          { id: '100', title: 'React 文档', url: 'https://react.dev' },
        ]},
      ]},
    ]},
  ]

  function messyPlan(rebuildStructure: boolean) {
    return buildPlan({
      id: 'p-order', createdAt: 1, scopeRootIds: ['1'], rebuildStructure,
      items: [{
        id: '100', title: 'React 文档', url: 'https://react.dev',
        parentId: 'f-github', index: 0, currentPath: ['书签栏', '01 GitHub'],
      }],
      candidates: [{ id: 'f-ai', path: ['书签栏', '02 AI'] }],
      classifications: [
        { bookmarkId: '100', targetCategoryId: 'f-ai', confidence: 1, reason: 'r', source: 'llm' },
      ],
      newFolders: [],
    })
  }

  /** get() 不返回 children，只能从整棵树里找。 */
  const childTitles = async (ports: { bookmarks: BookmarksApi }, id: string): Promise<string[]> => {
    const stack = [...(await ports.bookmarks.getTree())]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.id === id) return (node.children ?? []).map((c) => c.title)
      for (const child of node.children ?? []) stack.push(child)
    }
    throw new Error(`找不到目录 ${id}`)
  }

  it('推翻模式下带编号的目录按编号升序排到最前', async () => {
    const fake = createFakeBookmarks(messy)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await applyPlan(ports, messyPlan(true), new Set(['100']))
    expect(await childTitles(ports, '1')).toEqual(['01 GitHub', '02 AI', 'fastapi'])
  })

  it('子目录同样按编号排列', async () => {
    const fake = createFakeBookmarks(messy)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await applyPlan(ports, messyPlan(true), new Set(['100']))
    expect(await childTitles(ports, 'f-ai')).toEqual(['01 dify', '02 RAG', 'React 文档'])
  })

  it('结果里记录排序过的目录数量', async () => {
    const fake = createFakeBookmarks(messy)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const result = await applyPlan(ports, messyPlan(true), new Set(['100']))
    expect(result.sortedFolders).toBe(4)
  })

  it('非推翻模式不动用户自己的排列', async () => {
    const fake = createFakeBookmarks(messy)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const result = await applyPlan(ports, messyPlan(false), new Set(['100']))
    expect(result.sortedFolders).toBe(0)
    expect(await childTitles(ports, '1')).toEqual(['fastapi', '02 AI', '01 GitHub'])
  })

  it('撤销后目录顺序还原', async () => {
    const fake = createFakeBookmarks(messy)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await applyPlan(ports, messyPlan(true), new Set(['100']))
    await undoLast(ports)
    expect(await childTitles(ports, '1')).toEqual(['fastapi', '02 AI', '01 GitHub'])
    expect(await childTitles(ports, 'f-ai')).toEqual(['02 RAG', '01 dify'])
  })
})

describe('applyPlan 统一书签标题', () => {
  const ghTree = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '收件箱', children: [
          { id: '100', title: 'GitHub - sst/opencode: The AI coding agent', url: 'https://github.com/sst/opencode' },
          { id: '101', title: '手动改过的名字', url: 'https://example.com/x' },
        ]},
      ]},
    ]},
  ]

  function renamePlan() {
    return buildPlan({
      id: 'p-title', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: false,
      items: [], candidates: [], classifications: [], newFolders: [],
      titleRewrites: [
        { bookmarkId: '100', oldTitle: 'GitHub - sst/opencode: The AI coding agent', newTitle: 'opencode (sst)' },
      ],
    })
  }

  const titleOf = async (ports: { bookmarks: BookmarksApi }, id: string): Promise<string> =>
    (await ports.bookmarks.get(id))!.title

  it('改名落地到书签栏', async () => {
    const fake = createFakeBookmarks(ghTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await applyPlan(ports, renamePlan(), new Set())
    expect(await titleOf(ports, '100')).toBe('opencode (sst)')
  })

  it('一条移动建议都没勾选时改名照样执行——它由设置开关决定', async () => {
    const fake = createFakeBookmarks(ghTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    const result = await applyPlan(ports, renamePlan(), new Set())
    expect(result.renamedBookmarkIds).toEqual(['100'])
  })

  it('撤销后标题还原', async () => {
    const fake = createFakeBookmarks(ghTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await applyPlan(ports, renamePlan(), new Set())
    await undoLast(ports)
    expect(await titleOf(ports, '100')).toBe('GitHub - sst/opencode: The AI coding agent')
  })

  it('用户自己改过的书签标题，撤销时仍然不覆盖', async () => {
    const fake = createFakeBookmarks(ghTree)
    const ports = { bookmarks: fake.api, storage: createFakeStorage() }
    await applyPlan(ports, renamePlan(), new Set())
    // 应用之后用户自己动了另一个书签的名字
    await ports.bookmarks.update('101', { title: '用户新起的名字' })
    await undoLast(ports)
    expect(await titleOf(ports, '101')).toBe('用户新起的名字')
  })
})
