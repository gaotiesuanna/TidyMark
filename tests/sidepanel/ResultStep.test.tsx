import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultStep } from '@/sidepanel/steps/ResultStep'
import { useStore } from '@/sidepanel/store'
import type { OrganizePlan } from '@/core/types'
import type { ApplyResult } from '@/engine/apply'
import type { BookmarkNode } from '@/core/ports'

const plan: OrganizePlan = {
  id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
  candidates: [{ id: 'tmp:1', path: ['AI'] }, { id: 'tmp:2', path: ['AI', 'RAG'] }],
  operations: [
    { type: 'create_folder', temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: 'AI' },
    { type: 'create_folder', temporaryId: 'tmp:2', parentId: null, parentTemporaryId: 'tmp:1', title: 'RAG' },
    { type: 'move_bookmark', bookmarkId: '100', fromParentId: '1', originalIndex: 0, toCategoryId: 'tmp:2', toTemporaryId: 'tmp:2', confidence: 1, reason: '' },
    { type: 'move_bookmark', bookmarkId: '101', fromParentId: '1', originalIndex: 1, toCategoryId: 'tmp:1', toTemporaryId: 'tmp:1', confidence: 1, reason: '' },
  ],
  rows: [
    { bookmarkId: '100', title: 'a', url: 'https://a', fromPath: ['书签栏'], toPath: ['AI', 'RAG'], confidence: 1, reason: '' },
    { bookmarkId: '101', title: 'b', url: 'https://b', fromPath: ['书签栏'], toPath: ['AI'], confidence: 1, reason: '' },
  ],
  summary: { totalBookmarks: 2, movedBookmarks: 2, unchangedBookmarks: 0, createdFolders: 2, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0 },
  warnings: [],
  tags: [],
  mergeRoot: null,
}

const applyResult: ApplyResult = {
  status: 'completed', executed: 4, skipped: [], createdFolderIds: ['20', '21'],
  removedFolders: [{ id: '30', title: '杂项', path: ['书签栏'] }],
  sortedFolders: 0, renamedBookmarkIds: [], mergeRootId: null,
  failedAt: null, error: null,
}

// 整理完成后重新读到的真实书签树：'20' 是本次新建的，'21' 里还留着未接受的书签
const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '20', title: '01 AI', children: [
        { id: '100', title: 'a', url: 'https://a' },
        { id: '21', title: '01.1 RAG', children: [
          { id: '101', title: 'b', url: 'https://b' },
        ]},
      ]},
      { id: '22', title: 'fastapi', children: [
        { id: '102', title: 'c', url: 'https://c' },
      ]},
    ]},
  ]},
]

beforeEach(() => {
  useStore.setState({
    plan, accepted: new Set(['100', '101']), applyResult, tree,
    undoResult: null, undoAvailable: true, busy: null, error: null,
  })
})

describe('ResultStep', () => {
  it('按整理后的真实书签树展示结构与书签数', () => {
    render(<ResultStep />)
    const section = screen.getByText('整理后的结构').parentElement!
    expect(within(section).getByText('01 AI')).toBeDefined()
    expect(within(section).getByText('01.1 RAG')).toBeDefined()
    // 书签栏 3 条；01 AI 含子目录 2 条，其中 RAG 1 条；fastapi 1 条
    expect(within(section).getAllByText(/^[0-9]+$/).map((el) => el.textContent))
      .toEqual(['3', '2', '1', '1'])
  })

  it('留有未接受书签的旧目录照样显示，不假装它已经空了', () => {
    render(<ResultStep />)
    const section = screen.getByText('整理后的结构').parentElement!
    expect(within(section).getByText('fastapi')).toBeDefined()
  })

  it('只标出本次新建的目录', () => {
    render(<ResultStep />)
    expect(screen.getAllByText('新建').length).toBe(2)
  })

  it('展示清理掉的空文件夹数量与完整路径', () => {
    render(<ResultStep />)
    expect(screen.getByText('清理空文件夹')).toBeDefined()
    expect(screen.getByText('书签栏 / 杂项')).toBeDefined()
  })

  it('撤销之后展示撤销后的结构', () => {
    useStore.setState({ undoResult: { status: 'completed', restored: 2, removedFolders: 2, skipped: [] } })
    render(<ResultStep />)
    expect(screen.getByText('撤销后的结构')).toBeDefined()
    expect(screen.queryByText('整理后的结构')).toBeNull()
  })
})

describe('ResultStep 结束整理', () => {
  it('点击后关闭侧栏', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    useStore.setState({ applyResult, plan, tree, undoResult: null, undoAvailable: true, busy: null })
    render(<ResultStep />)
    await userEvent.click(screen.getByRole('button', { name: '结束整理' }))
    expect(close).toHaveBeenCalledOnce()
    close.mockRestore()
  })

  it('三个动作都在，撤销与再整理不受影响', () => {
    useStore.setState({ applyResult, plan, tree, undoResult: null, undoAvailable: true, busy: null })
    render(<ResultStep />)
    expect(screen.getByRole('button', { name: '撤销本次整理' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '再整理一次' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '结束整理' })).toBeTruthy()
  })
})

describe('ResultStep 合并结果', () => {
  // 合并后源根 '10' / '11' 已被删除，合并出来的 '20' 不在 scopeRootIds 里
  const mergedTree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '20', title: 'AI 学习', children: [
          { id: '21', title: '01 前端', children: [
            { id: '100', title: 'a', url: 'https://a' },
          ]},
        ]},
      ]},
    ]},
  ]

  const mergedPlan: OrganizePlan = {
    ...plan,
    scopeRootIds: ['10', '11'],
    mergeRoot: {
      temporaryId: 'tmp:0', title: 'AI 学习',
      sourceRootIds: ['10', '11'], sourceTitles: ['NiceG', 'b_llm'],
    },
  }

  it('结果树包含新建的合并目录', () => {
    useStore.setState({
      plan: mergedPlan, tree: mergedTree,
      applyResult: { ...applyResult, mergeRootId: '20', createdFolderIds: ['20', '21'] },
      undoResult: null, undoAvailable: true, busy: null, error: null,
    })
    render(<ResultStep />)
    expect(screen.getByText('AI 学习')).toBeTruthy()
    expect(screen.getByText('01 前端')).toBeTruthy()
  })

  it('显示合并说明，个数取源目录数而不是级联勾选数', () => {
    useStore.setState({
      // scopeRootIds 故意比 sourceTitles 长，模拟级联勾选把子目录也算进去的情况
      plan: { ...mergedPlan, scopeRootIds: ['10', '11', '12', '13'] },
      tree: mergedTree,
      applyResult: { ...applyResult, mergeRootId: '20', createdFolderIds: ['20', '21'] },
      undoResult: null, undoAvailable: true, busy: null, error: null,
    })
    render(<ResultStep />)
    expect(screen.getByText('2 个文件夹已合并为「AI 学习」')).toBeTruthy()
  })

  it('非合并模式不显示合并说明', () => {
    render(<ResultStep />)   // beforeEach 注入的是非合并 plan
    expect(screen.queryByText(/个文件夹已合并为/)).toBeNull()
  })
})

describe('ResultStep 合并结果——清理统计不能把被合并的源目录算作空文件夹', () => {
  // 源根 '10'/'11' 是合并流程本身删掉的，不是「清理空文件夹」清出来的；
  // '40' 才是真正因为整理后变空而被清理掉的目录。
  const mergedPlan: OrganizePlan = {
    ...plan,
    scopeRootIds: ['10', '11'],
    mergeRoot: {
      temporaryId: 'tmp:0', title: 'AI 学习',
      sourceRootIds: ['10', '11'], sourceTitles: ['NiceG', 'b_llm'],
    },
  }
  const mergedTree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '20', title: 'AI 学习', children: [
          { id: '21', title: '01 前端', children: [
            { id: '100', title: 'a', url: 'https://a' },
          ]},
        ]},
      ]},
    ]},
  ]

  it('数量与展开列表只统计真正清空的目录，不含被合并走的源目录，且源目录名不会出现在清理列表里', () => {
    useStore.setState({
      plan: mergedPlan,
      tree: mergedTree,
      applyResult: {
        ...applyResult,
        mergeRootId: '20',
        createdFolderIds: ['20', '21'],
        removedFolders: [
          { id: '10', title: 'NiceG', path: ['书签栏'] },
          { id: '11', title: 'b_llm', path: ['书签栏'] },
          { id: '40', title: '杂项', path: ['书签栏'] },
        ],
      },
      undoResult: null, undoAvailable: true, busy: null, error: null,
    })
    render(<ResultStep />)

    // 统计数字只算真正清空的那 1 个，不含 2 个被合并走的源根
    expect(screen.getByText('清理空文件夹').nextElementSibling?.textContent).toBe('1')

    // 展开列表里只有真正被清理的目录，源目录名不出现在这个标签下
    const details = screen.getByText('查看被清理的空文件夹').closest('details')!
    expect(within(details).getByText('书签栏 / 杂项')).toBeTruthy()
    expect(within(details).queryByText(/NiceG/)).toBeNull()
    expect(within(details).queryByText(/b_llm/)).toBeNull()

    // 源目录去哪儿了不能语焉不详——合并说明里要点名，并明确写出「已删除」
    expect(screen.getByText(/NiceG/)).toBeTruthy()
    expect(screen.getByText(/b_llm/)).toBeTruthy()
  })

  it('清理数量为零时，行为与今天「什么都没清理」时一致——不新造一种空状态', () => {
    useStore.setState({
      plan: mergedPlan,
      tree: mergedTree,
      applyResult: {
        ...applyResult,
        mergeRootId: '20',
        createdFolderIds: ['20', '21'],
        removedFolders: [
          { id: '10', title: 'NiceG', path: ['书签栏'] },
          { id: '11', title: 'b_llm', path: ['书签栏'] },
        ],
      },
      undoResult: null, undoAvailable: true, busy: null, error: null,
    })
    render(<ResultStep />)
    expect(screen.getByText('清理空文件夹').nextElementSibling?.textContent).toBe('0')
    expect(screen.queryByText('查看被清理的空文件夹')).toBeNull()
  })
})
