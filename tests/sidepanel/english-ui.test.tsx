import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setLocale } from '@/i18n'
import { makePlan } from '../fakes/plan'
import { ScopeStep } from '@/sidepanel/steps/ScopeStep'
import { PreferencesStep } from '@/sidepanel/steps/PreferencesStep'
import { StructureStep } from '@/sidepanel/steps/StructureStep'
import { ReviewStep } from '@/sidepanel/steps/ReviewStep'
import { ResultStep } from '@/sidepanel/steps/ResultStep'
import { ExportPanel } from '@/sidepanel/components/ExportPanel'
import { ImportPanel } from '@/sidepanel/components/ImportPanel'
import { ProgressPanel } from '@/sidepanel/components/ProgressPanel'
import { SettingsPanel } from '@/sidepanel/components/SettingsPanel'
import { useStore } from '@/sidepanel/store'
import { EMPTY_EDITS } from '@/core/structure'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import type { BookmarkNode } from '@/core/ports'
import type { OrganizePlan } from '@/core/types'
import type { ApplyResult } from '@/engine/apply'

/**
 * 全局 setup（tests/setup/i18n.ts）把界面钉成中文，其余测试文件全程跑在中文界面下。
 * 这份文件是唯一跑在英文界面下的测试——「相邻 JSX 表达式之间缺空格」
 * 「裸写中文标点」这类缺陷只在英文分支才会现形。
 * afterEach 换回中文，不然会污染同一 jsdom project 里跑在这份文件之后的其它测试。
 */
beforeEach(() => setLocale('en'))
afterEach(() => setLocale('zh_CN'))

/** CJK 表意文字，加上项目里实际用过的中文全角标点：： 。「 」 */
const CHINESE_LEAK = /[一-鿿：。「」]/

/**
 * 语言选择器里的「中文」是有意的中文：语言名永远用该语言自己的写法，
 * 否则界面已经切到用户看不懂的语言时，他找不到切回去的那一项。
 * 这是本守卫唯一的例外，写成精确字面量而不是放宽正则——
 * 别的地方漏出中文仍然要当场失败。
 */
const INTENTIONAL_CHINESE = /中文/g

function assertNoChinese(container: HTMLElement, componentName: string): void {
  const text = (container.textContent ?? '').replace(INTENTIONAL_CHINESE, '')
  const hit = text.match(CHINESE_LEAK)
  expect(
    hit,
    `${componentName} 在英文界面下渲染出了中文字符或中文标点：${JSON.stringify(hit?.[0])}\n完整文本：${text}`,
  ).toBeNull()
}

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: 'Bookmarks bar', children: [
      { id: '10', title: 'react', children: [
        { id: '100', title: 'hooks', children: [] },
      ]},
      { id: '11', title: 'misc', children: [] },
    ]},
  ]},
]

describe('英文界面渲染守卫：步骤组件', () => {
  it('ScopeStep', () => {
    useStore.setState({
      tree, checkedIds: new Set(['10']), busy: null, error: null,
      importFile: null, importError: null, importDone: null,
    })
    const { container } = render(<ScopeStep />)
    assertNoChinese(container, 'ScopeStep')
  })

  it('PreferencesStep', () => {
    const scan = {
      bookmarks: [], folders: [],
      stats: { totalBookmarks: 12, totalFolders: 3, emptyFolders: 1, untitledBookmarks: 0, duplicateUrlGroups: 0, maxDepth: 2 },
    }
    useStore.setState({
      scan, settings: { ...DEFAULT_SETTINGS, rebuildStructure: true }, busy: null,
    })
    const { container } = render(<PreferencesStep />)
    assertNoChinese(container, 'PreferencesStep')
  })

  it('StructureStep', () => {
    useStore.setState({ plan: makePlan(), structureEdits: EMPTY_EDITS, step: 'structure' })
    const { container } = render(<StructureStep />)
    assertNoChinese(container, 'StructureStep')
  })

  it('StructureStep（合并模式：合并到输入框与「源目录会被删除」说明）', () => {
    // makePlan() 的 mergeRoot 是 null，上面那条用例一行合并 UI 都没渲染到。
    // 合并说明是整条动线里唯一一处在删除发生之前点名源目录的文案，
    // 它同时要把名字用分隔符连起来——中文顿号漏到英文界面正是这份文件要挡的东西。
    useStore.setState({
      plan: {
        ...makePlan(),
        mergeRoot: {
          temporaryId: 'tmp:0', title: 'AI learning',
          sourceRootIds: ['10', '11'], sourceTitles: ['NiceG', 'b_llm'],
        },
      },
      structureEdits: EMPTY_EDITS, step: 'structure',
    })
    const { container } = render(<StructureStep />)
    assertNoChinese(container, 'StructureStep（合并模式）')
  })

  it('ReviewStep（含新建目录、重命名目录、重命名书签三条摘要，覆盖第 26 行的分支）', () => {
    // summary 里的 createdFolders/renamedFolders/renamedBookmarks 由组件用
    // summarize(plan, accepted) 现算，不读 plan.summary 字段——operations 必须
    // 真的包含 create_folder / rename_folder / rename_bookmark，且被接受的
    // move 要引用到那个 create_folder，条件 (createdFolders>0 || renamedFolders>0)
    // 才会为真，第 26 行那个裸中文句号才会被渲染出来。
    const plan: OrganizePlan = {
      id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
      candidates: [{ id: 'tmp:1', path: ['react'] }],
      operations: [
        { type: 'create_folder', temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: 'react' },
        { type: 'rename_folder', folderId: '9', oldTitle: 'misc', newTitle: '01 misc' },
        { type: 'rename_bookmark', bookmarkId: '100', oldTitle: 'react', newTitle: 'react (facebook)' },
        { type: 'move_bookmark', bookmarkId: '100', fromParentId: '9', originalIndex: 0, toCategoryId: 'tmp:1', toTemporaryId: 'tmp:1', confidence: 0.95, reason: 'official docs' },
        { type: 'move_bookmark', bookmarkId: '101', fromParentId: '9', originalIndex: 1, toCategoryId: 'tmp:1', toTemporaryId: 'tmp:1', confidence: 0.4, reason: 'maybe related' },
      ],
      rows: [
        { bookmarkId: '100', title: 'React docs', url: 'https://react.dev', fromPath: ['Bookmarks bar', 'Misc'], toPath: ['Bookmarks bar', 'react'], confidence: 0.95, reason: 'official docs' },
        { bookmarkId: '101', title: 'Uncertain one', url: 'https://x.dev', fromPath: ['Bookmarks bar', 'Misc'], toPath: ['Bookmarks bar', 'react'], confidence: 0.4, reason: 'maybe related' },
      ],
      summary: { totalBookmarks: 2, movedBookmarks: 2, unchangedBookmarks: 0, createdFolders: 1, renamedFolders: 1, renamedBookmarks: 1, lowConfidenceItems: 1 },
      warnings: [],
      tags: [],
      mergeRoot: null,
    }
    useStore.setState({
      plan, accepted: new Set(['100', '101']), busy: null, error: null, scan: null,
      settings: { ...DEFAULT_SETTINGS, removeEmptyFolders: true },
    })
    const { container } = render(<ReviewStep />)
    assertNoChinese(container, 'ReviewStep')
  })

  it('ResultStep（含撤销结果与被跳过条目，覆盖第 81 行的分支）', () => {
    const plan: OrganizePlan = {
      id: 'p1', createdAt: 1, scopeRootIds: ['1'], rebuildStructure: true,
      candidates: [{ id: 'tmp:1', path: ['AI'] }],
      operations: [
        { type: 'create_folder', temporaryId: 'tmp:1', parentId: '1', parentTemporaryId: null, title: 'AI' },
        { type: 'move_bookmark', bookmarkId: '100', fromParentId: '1', originalIndex: 0, toCategoryId: 'tmp:1', toTemporaryId: 'tmp:1', confidence: 1, reason: '' },
      ],
      rows: [
        { bookmarkId: '100', title: 'a', url: 'https://a', fromPath: ['Bookmarks bar'], toPath: ['AI'], confidence: 1, reason: '' },
      ],
      summary: { totalBookmarks: 1, movedBookmarks: 1, unchangedBookmarks: 0, createdFolders: 1, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0 },
      warnings: [],
      tags: [],
      mergeRoot: null,
    }
    const applyResult: ApplyResult = {
      status: 'completed', executed: 2,
      skipped: [{ bookmarkId: '999', reason: 'bookmark is gone' }],
      createdFolderIds: ['20'],
      removedFolders: [{ id: '30', title: 'Misc', path: ['Bookmarks bar'] }],
      sortedFolders: 0, renamedBookmarkIds: [], mergeRootId: null,
      failedAt: null, error: null,
    }
    const resultTree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: 'Bookmarks bar', children: [
          { id: '20', title: '01 AI', children: [
            { id: '100', title: 'a', url: 'https://a' },
          ]},
        ]},
      ]},
    ]
    useStore.setState({
      plan, accepted: new Set(['100']), applyResult, tree: resultTree,
      // undoResult.skipped 命中第 81 行 `{each.title}：{each.reason}`
      undoResult: {
        status: 'completed', restored: 1, removedFolders: 1, rebuiltRootIds: [],
        skipped: [{ id: '55', title: 'orphaned bookmark', reason: 'node is gone' }],
      },
      undoAvailable: false, busy: null, error: null,
    })
    const { container } = render(<ResultStep />)
    assertNoChinese(container, 'ResultStep')
  })

  // 上面那条用例的 plan.mergeRoot 是 null、undoResult 又不为 null，
  // 合并说明与「原文件夹已删除」名单两段都被跳过，一个字都没经过英文界面。
  const mergedPlan: OrganizePlan = {
    id: 'p2', createdAt: 1, scopeRootIds: ['10', '11'], rebuildStructure: true,
    candidates: [{ id: 'tmp:1', path: ['AI'] }],
    operations: [
      { type: 'create_folder', temporaryId: 'tmp:0', parentId: '1', parentTemporaryId: null, title: 'AI learning' },
      { type: 'create_folder', temporaryId: 'tmp:1', parentId: null, parentTemporaryId: 'tmp:0', title: 'AI' },
      { type: 'move_bookmark', bookmarkId: '100', fromParentId: '10', originalIndex: 0, toCategoryId: 'tmp:1', toTemporaryId: 'tmp:1', confidence: 1, reason: '' },
    ],
    rows: [
      { bookmarkId: '100', title: 'a', url: 'https://a', fromPath: ['NiceG'], toPath: ['AI learning', 'AI'], confidence: 1, reason: '' },
    ],
    summary: { totalBookmarks: 1, movedBookmarks: 1, unchangedBookmarks: 0, createdFolders: 2, renamedFolders: 0, renamedBookmarks: 0, lowConfidenceItems: 0 },
    warnings: [],
    tags: [],
    mergeRoot: {
      temporaryId: 'tmp:0', title: 'AI learning',
      sourceRootIds: ['10', '11'], sourceTitles: ['NiceG', 'b_llm'],
    },
  }

  const mergedApplyResult: ApplyResult = {
    status: 'completed', executed: 3, skipped: [], createdFolderIds: ['20', '21'],
    removedFolders: [
      { id: '10', title: 'NiceG', path: ['Bookmarks bar'] },
      { id: '11', title: 'b_llm', path: ['Bookmarks bar'] },
    ],
    sortedFolders: 0, renamedBookmarkIds: [], mergeRootId: '20',
    failedAt: null, error: null,
  }

  it('ResultStep（合并模式：合并说明与已删除的源目录名单）', () => {
    const mergedTree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: 'Bookmarks bar', children: [
          { id: '20', title: 'AI learning', children: [
            { id: '21', title: '01 AI', children: [
              { id: '100', title: 'a', url: 'https://a' },
            ]},
          ]},
        ]},
      ]},
    ]
    useStore.setState({
      plan: mergedPlan, accepted: new Set(['100']),
      applyResult: mergedApplyResult, tree: mergedTree,
      undoResult: null, undoAvailable: true, busy: null, error: null,
    })
    const { container } = render(<ResultStep />)
    assertNoChinese(container, 'ResultStep（合并模式）')
  })

  it('ResultStep（合并撤销之后：结构树按重建出来的新根 id 画）', () => {
    const restoredTree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: 'Bookmarks bar', children: [
          { id: '30', title: 'NiceG', children: [
            { id: '100', title: 'a', url: 'https://a' },
          ]},
          { id: '31', title: 'b_llm', children: [] },
        ]},
      ]},
    ]
    useStore.setState({
      plan: mergedPlan, accepted: new Set(['100']),
      applyResult: mergedApplyResult, tree: restoredTree,
      undoResult: {
        status: 'completed', restored: 1, removedFolders: 2, skipped: [],
        rebuiltRootIds: ['30', '31'],
      },
      undoAvailable: false, busy: null, error: null,
    })
    const { container } = render(<ResultStep />)
    assertNoChinese(container, 'ResultStep（合并撤销之后）')
  })
})

describe('英文界面渲染守卫：设置页', () => {
  it('SettingsPanel', () => {
    useStore.setState({
      settingsOpen: true,
      settings: { ...DEFAULT_SETTINGS, rebuildStructure: true },
    })
    const { container } = render(<SettingsPanel />)
    assertNoChinese(container, 'SettingsPanel')
  })

  // 禁用态的说明文字与启用态不是同一批节点，两种都要过一遍
  it('SettingsPanel 推翻重建关闭时', () => {
    useStore.setState({
      settingsOpen: true,
      settings: { ...DEFAULT_SETTINGS, rebuildStructure: false },
    })
    const { container } = render(<SettingsPanel />)
    assertNoChinese(container, 'SettingsPanel')
  })
})

describe('英文界面渲染守卫：跨步骤共用组件', () => {
  it('ExportPanel', () => {
    useStore.setState({ tree, checkedIds: new Set(['10']), busy: null })
    const { container } = render(<ExportPanel />)
    assertNoChinese(container, 'ExportPanel')
  })

  it('ImportPanel（待选态）', () => {
    useStore.setState({
      tree, busy: null, error: null,
      importFile: null, importError: null, importDone: null,
    })
    const { container } = render(<ImportPanel />)
    assertNoChinese(container, 'ImportPanel（待选态）')
  })

  it('ImportPanel（出错态）', () => {
    useStore.setState({ tree, busy: null, importFile: null, importDone: null })
    useStore.getState().readImportFile('bad.json', 'not json')
    const { container } = render(<ImportPanel />)
    assertNoChinese(container, 'ImportPanel（出错态）')
  })

  it('ImportPanel（预览态，含重复与被拦截链接）', () => {
    const goodFile = JSON.stringify({
      format: 'tidymark/v1', kind: 'tree', exportedAt: '',
      roots: [
        { name: 'NiceG', children: [
          { name: 'shadcn/ui', url: 'https://ui.shadcn.com' },
          { name: 'blocked', url: 'javascript:alert(1)' },
        ]},
      ],
    })
    useStore.setState({
      tree: [
        { id: '0', title: '', children: [
          { id: '1', title: 'Bookmarks bar', children: [
            { id: '10', title: 'existing', children: [
              { id: '100', title: 'shadcn/ui', url: 'https://ui.shadcn.com' },
            ]},
          ]},
        ]},
      ],
      busy: null, importFile: null, importError: null, importDone: null,
    })
    useStore.getState().readImportFile('picked.json', goodFile)
    const { container } = render(<ImportPanel />)
    assertNoChinese(container, 'ImportPanel（预览态）')
  })

  it('ImportPanel（结果态，含未导入清单）', () => {
    useStore.setState({
      importFile: null, importError: null,
      importDone: {
        result: {
          folderId: '99', bookmarks: 185, folders: 24,
          skipped: [{ name: 'untitled', url: 'https://x.dev', code: 'createFailed', detail: 'boom' }],
        },
        blocked: [{ name: 'Gmail', url: 'javascript:x', scheme: 'javascript:' }],
        targetName: 'Imported 2026-08-05',
        barTitle: 'Bookmarks bar',
      },
    })
    const { container } = render(<ImportPanel />)
    assertNoChinese(container, 'ImportPanel（结果态）')
  })

  it('ProgressPanel（折叠态）', () => {
    const { container } = render(
      <ProgressPanel
        busy="Analyzing…"
        progress={{ phase: 'classify', done: 320, total: 923 }}
        logs={[
          { id: 1, phase: 'tags', level: 'info', message: 'tag batch 1/2: 25 items' },
          { id: 2, phase: 'classify', level: 'info', message: 'classify batch 1/2: 25 items, 25 succeeded' },
        ]}
        onCancel={() => {}}
      />,
    )
    assertNoChinese(container, 'ProgressPanel（折叠态）')
  })

  it('ProgressPanel（展开态）', async () => {
    const { container } = render(
      <ProgressPanel
        busy="Analyzing…"
        progress={null}
        logs={[
          { id: 1, phase: 'tags', level: 'info', message: 'tag batch 1/2: 25 items' },
          { id: 2, phase: 'classify', level: 'error', message: 'batch failed: 400' },
        ]}
      />,
    )
    await userEvent.click(container.querySelector('[aria-expanded]')!)
    assertNoChinese(container, 'ProgressPanel（展开态）')
  })
})
