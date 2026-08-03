import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ResultStep } from '@/sidepanel/steps/ResultStep'
import { useStore } from '@/sidepanel/store'
import type { OrganizePlan } from '@/core/types'
import type { ApplyResult } from '@/engine/apply'

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
  summary: { totalBookmarks: 2, movedBookmarks: 2, unchangedBookmarks: 0, createdFolders: 2, renamedFolders: 0, lowConfidenceItems: 0 },
  warnings: [],
}

const applyResult: ApplyResult = {
  status: 'completed', executed: 4, skipped: [], createdFolderIds: ['10', '11'],
  removedFolders: [{ id: '30', title: '杂项', path: ['书签栏'] }],
  failedAt: null, error: null,
}

beforeEach(() => {
  useStore.setState({
    plan, accepted: new Set(['100', '101']), applyResult,
    undoResult: null, undoAvailable: true, busy: null, error: null,
  })
})

describe('ResultStep', () => {
  it('用树状结构展示整理后的目录与书签数', () => {
    render(<ResultStep />)
    expect(screen.getByText('整理后的结构')).toBeDefined()
    const section = screen.getByText('整理后的结构').parentElement!
    expect(within(section).getByText('AI')).toBeDefined()
    expect(within(section).getByText('RAG')).toBeDefined()
    // AI 含子目录共 2 条，其中 RAG 1 条
    expect(within(section).getAllByText(/^[0-9]+$/).map((el) => el.textContent)).toEqual(['2', '1'])
  })

  it('标出本次新建的目录', () => {
    render(<ResultStep />)
    expect(screen.getAllByText('新建').length).toBe(2)
  })

  it('展示清理掉的空文件夹数量与完整路径', () => {
    render(<ResultStep />)
    expect(screen.getByText('清理空文件夹')).toBeDefined()
    expect(screen.getByText('书签栏 / 杂项')).toBeDefined()
  })

  it('撤销之后不再展示结构树', () => {
    useStore.setState({ undoResult: { status: 'completed', restored: 2, removedFolders: 2, skipped: [] } })
    render(<ResultStep />)
    expect(screen.queryByText('整理后的结构')).toBeNull()
  })
})
