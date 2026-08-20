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
    { bookmarkId: '100', title: 'a', url: 'https://a', fromPath: ['书签栏'], toPath: ['AI', 'RAG'], toCategoryId: 'tmp:2', confidence: 1, reason: '', source: 'llm' },
    { bookmarkId: '101', title: 'b', url: 'https://b', fromPath: ['书签栏'], toPath: ['AI'], toCategoryId: 'tmp:1', confidence: 1, reason: '', source: 'llm' },
  ],
  unchanged: [],
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

  // 这一页自称展示「整理后的结构」，拿到的又正是整理后重新读回的真实树，那就照原样显示。
  // 连推翻模式也不例外：排序 move 失败（sortedFolders 为 0）、撤销之后，书签栏里带编号的
  // 目录就是排在没编号的后面，这时按编号重排一遍，这一页就是在说谎。
  it('一律按书签栏里的真实先后展示，不把带编号的目录提到最前', () => {
    const flatTree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '40', title: '杂项', children: [{ id: '400', title: 'x', url: 'https://x' }] },
          { id: '41', title: '01 工作', children: [{ id: '401', title: 'y', url: 'https://y' }] },
        ]},
      ]},
    ]
    useStore.setState({
      // 推翻模式（plan.rebuildStructure 为 true）下也照样不排
      plan,
      tree: flatTree,
      applyResult: { ...applyResult, createdFolderIds: [] },
    })
    render(<ResultStep />)
    const section = screen.getByText('整理后的结构').parentElement!
    expect(within(section).getAllByText(/^(杂项|01 工作)$/).map((el) => el.textContent))
      .toEqual(['杂项', '01 工作'])
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
    useStore.setState({ undoResult: { status: 'completed', restored: 2, removedFolders: 2, skipped: [], rebuiltRootIds: [] } })
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

describe('ResultStep 合并结果——"已删除"名单只能报真被删掉的源目录', () => {
  // sourceTitles 是「打算合并谁」，取消勾选会让某个源目录整棵子树都留有书签，
  // findEmptyFolders 找不到空子树，它就不会进 removedFolders——但它仍然在
  // sourceTitles 里。这组用例专门盯这个落差，防止"已删除"文案说了假话。
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
        // NiceG 没被删掉：用户在复核页取消勾选，里面还留着书签，源目录原样健在
        { id: '10', title: 'NiceG', children: [
          { id: '103', title: 'd', url: 'https://d' },
        ]},
      ]},
    ]},
  ]

  it('部分合并：只有真被删掉的源目录上"已删除"名单，留存的那个不上榜', () => {
    useStore.setState({
      plan: mergedPlan,
      tree: mergedTree,
      applyResult: {
        ...applyResult,
        mergeRootId: '20',
        createdFolderIds: ['20', '21'],
        // 只有 b_llm（'11'）真的被清空删除了，NiceG（'10'）没进这个列表
        removedFolders: [{ id: '11', title: 'b_llm', path: ['书签栏'] }],
      },
      undoResult: null, undoAvailable: true, busy: null, error: null,
    })
    render(<ResultStep />)
    // "已删除" 这行只报真被删掉的 b_llm，NiceG 不上这个名单
    const deletionLine = screen.getByText(/已删除/)
    expect(deletionLine.textContent).toContain('b_llm')
    expect(deletionLine.textContent).not.toContain('NiceG')
    // NiceG 同时作为结果树里活着的目录出现——它没被删，画面不能说反话
    expect(screen.getByText('NiceG')).toBeTruthy()
  })

  it('全部源目录都没被删：整条"已删除"说明不渲染，不能说半句空话', () => {
    useStore.setState({
      plan: mergedPlan,
      tree: mergedTree,
      applyResult: {
        ...applyResult,
        mergeRootId: '20',
        createdFolderIds: ['20', '21'],
        // 两个源目录都还留着书签，removedFolders 里一个源根都没有
        removedFolders: [],
      },
      undoResult: null, undoAvailable: true, busy: null, error: null,
    })
    render(<ResultStep />)
    // 合并本身仍然发生了，"2 个文件夹已合并为「AI 学习」" 这句还在
    expect(screen.getByText('2 个文件夹已合并为「AI 学习」')).toBeTruthy()
    // 但没有任何源目录真的被删，"已删除" 这行不该出现
    expect(screen.queryByText(/已删除/)).toBeNull()
  })

  it('撤销之后：合并说明与"已删除"名单一起消失，撤销结果区接管叙事', () => {
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
      undoResult: { status: 'completed', restored: 2, removedFolders: 2, skipped: [], rebuiltRootIds: [] },
      undoAvailable: false, busy: null, error: null,
    })
    render(<ResultStep />)
    expect(screen.queryByText(/个文件夹已合并为/)).toBeNull()
    expect(screen.queryByText(/已删除/)).toBeNull()
  })

  it('撤销之后仍然画得出结构树——用撤销回报的新根 id，不是手里那批死 id', () => {
    // 撤销把 NiceG / b_llm 用新 id（'30' / '31'）重建了出来，合并根 '20' 被删掉。
    // plan.scopeRootIds 与 applyResult.mergeRootId 此刻全指向不存在的节点，
    // 「撤销后的结构」会整块消失——偏偏是刚被删过文件夹的人最想看它还在的时候。
    const restoredTree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children: [
          { id: '30', title: 'NiceG', children: [
            { id: '100', title: 'a', url: 'https://a' },
          ]},
          { id: '31', title: 'b_llm', children: [
            { id: '101', title: 'b', url: 'https://b' },
          ]},
        ]},
      ]},
    ]
    useStore.setState({
      plan: mergedPlan,
      tree: restoredTree,
      applyResult: { ...applyResult, mergeRootId: '20', createdFolderIds: ['20', '21'] },
      undoResult: {
        status: 'completed', restored: 2, removedFolders: 1, skipped: [],
        rebuiltRootIds: ['30', '31'],
      },
      undoAvailable: false, busy: null, error: null,
    })
    render(<ResultStep />)
    expect(screen.getByText('撤销后的结构')).toBeTruthy()
    expect(screen.getByText('NiceG')).toBeTruthy()
    expect(screen.getByText('b_llm')).toBeTruthy()
  })

  it('两个源目录都真被删掉时，名单用中文顿号分隔，不是英文逗号', () => {
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
    expect(screen.getByText('原文件夹已删除：NiceG、b_llm')).toBeTruthy()
  })
})
