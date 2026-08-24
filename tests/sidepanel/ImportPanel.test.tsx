import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportPanel } from '@/sidepanel/components/ImportPanel'
import { useStore } from '@/sidepanel/store'
import { send } from '@/sidepanel/lib/send'
import type { BookmarkNode } from '@/core/ports'

vi.mock('@/sidepanel/lib/send', () => ({ send: vi.fn() }))

const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: '已有', children: [
        { id: '100', title: '已有的', url: 'https://ui.shadcn.com' },
      ]},
    ]},
  ]},
]

const goodFile = JSON.stringify({
  format: 'tidymark/v1', kind: 'tree', exportedAt: '',
  roots: [
    { name: 'NiceG', children: [
      { name: 'shadcn/ui', url: 'https://ui.shadcn.com' },
      { name: '坏的', url: 'javascript:alert(1)' },
    ]},
  ],
})

/** 组件读的是 File.text()，jsdom 的 File 支持它。 */
function jsonFile(name: string, content: string): File {
  return new File([content], name, { type: 'application/json' })
}

beforeEach(() => {
  vi.mocked(send).mockReset()
  useStore.setState({
    tree, busy: null, error: null,
    importFile: null, importError: null, importDone: null,
  })
})

describe('ImportPanel 待选态', () => {
  it('只显示一个导入按钮', () => {
    render(<ImportPanel />)
    expect(screen.getByText('选择文件…')).toBeDefined()
    expect(screen.queryByText('确认导入')).toBeNull()
  })

  it('busy 时按钮禁用', () => {
    useStore.setState({ busy: '正在扫描…' })
    render(<ImportPanel />)
    expect(screen.getByRole('button', { name: '选择文件…' })).toHaveProperty('disabled', true)
  })
})

describe('ImportPanel 出错态', () => {
  it('坏文件显示错误且不进入预览', () => {
    useStore.getState().readImportFile('bad.json', '不是 json')
    render(<ImportPanel />)
    expect(screen.getByText('这个文件不是有效的 JSON。')).toBeDefined()
    expect(screen.queryByText('确认导入')).toBeNull()
    expect(screen.getByText('重新选择')).toBeDefined()
  })

  it('点重新选择回到待选态', async () => {
    useStore.getState().readImportFile('bad.json', '不是 json')
    render(<ImportPanel />)
    await userEvent.click(screen.getByText('重新选择'))
    expect(screen.queryByText('这个文件不是有效的 JSON。')).toBeNull()
    expect(screen.getByText('选择文件…')).toBeDefined()
  })
})

describe('ImportPanel 预览态', () => {
  beforeEach(() => {
    useStore.getState().readImportFile('tidymark-tree-2026-08-04.json', goodFile)
  })

  it('显示文件名与统计，条数是拦截后的数字', () => {
    render(<ImportPanel />)
    expect(screen.getByText('tidymark-tree-2026-08-04.json')).toBeDefined()
    // 2 条里有 1 条 javascript: 被拦下
    expect(screen.getByText('1 条书签、1 个文件夹')).toBeDefined()
  })

  it('提示已收藏过的条数', () => {
    render(<ImportPanel />)
    expect(screen.getByText('其中 1 条你已经收藏过')).toBeDefined()
  })

  it('提示被拦下的不安全链接', () => {
    render(<ImportPanel />)
    expect(screen.getByText('已拦下 1 条不安全的链接')).toBeDefined()
  })

  it('显示将建到哪里', () => {
    render(<ImportPanel />)
    expect(screen.getByText(/将建到：书签栏\/导入 \d{4}-\d{2}-\d{2}/)).toBeDefined()
  })

  it('渲染待建的目录树', () => {
    render(<ImportPanel />)
    expect(screen.getByText('NiceG')).toBeDefined()
    expect(screen.getByText('shadcn/ui')).toBeDefined()
    // 被拦下的不出现在树里
    expect(screen.queryByText('坏的')).toBeNull()
  })

  it('点确认导入时发出正确的载荷', async () => {
    vi.mocked(send).mockResolvedValue({
      ok: true, kind: 'import',
      result: { folderId: '99', bookmarks: 1, folders: 1, skipped: [] },
    })
    render(<ImportPanel />)
    await userEvent.click(screen.getByText('确认导入'))

    expect(send).toHaveBeenCalled()
    const payload = vi.mocked(send).mock.calls[0]![0] as {
      kind: string; targetName: string; nodes: unknown[]
    }
    expect(payload.kind).toBe('import')
    expect(payload.targetName).toMatch(/^导入 \d{4}-\d{2}-\d{2}$/)
    expect(payload.nodes).toEqual([
      { name: 'NiceG', children: [{ name: 'shadcn/ui', url: 'https://ui.shadcn.com' }] },
    ])
  })

  it('导入成功后 importDone.blocked 带上预览阶段拦下的条目，且 importFile 被清空', async () => {
    // confirmImport 成功后还会 refreshTree()，也就是再发一次 get_tree 请求，按 kind 分派两次调用
    vi.mocked(send).mockImplementation(async (message: { kind: string }) => {
      if (message.kind === 'import') {
        return {
          ok: true, kind: 'import',
          result: { folderId: '99', bookmarks: 1, folders: 1, skipped: [] },
        }
      }
      return { ok: true, kind: 'get_tree', tree }
    })
    render(<ImportPanel />)
    await userEvent.click(screen.getByText('确认导入'))

    const state = useStore.getState()
    expect(state.importFile).toBeNull()
    expect(state.importDone).not.toBeNull()
    expect(state.importDone!.blocked).toEqual([
      { name: '坏的', url: 'javascript:alert(1)', scheme: 'javascript:' },
    ])
  })

  it('busy 时确认导入与取消按钮都禁用', () => {
    useStore.setState({ busy: '正在导入…' })
    render(<ImportPanel />)
    expect(screen.getByRole('button', { name: '确认导入' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '取消' })).toHaveProperty('disabled', true)
  })

  it('点取消回到待选态且不发请求', async () => {
    render(<ImportPanel />)
    await userEvent.click(screen.getByText('取消'))
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByText('选择文件…')).toBeDefined()
  })

  it('没有可导入内容时确认按钮禁用', () => {
    const empty = JSON.stringify({ format: 'tidymark/v1', kind: 'links', exportedAt: '', bookmarks: [] })
    useStore.getState().readImportFile('empty.json', empty)
    render(<ImportPanel />)
    expect(screen.getByRole('button', { name: '确认导入' })).toHaveProperty('disabled', true)
  })
})

describe('ImportPanel 结果态', () => {
  beforeEach(() => {
    useStore.setState({
      importFile: null, importError: null,
      importDone: {
        result: {
          folderId: '99', bookmarks: 185, folders: 24,
          skipped: [{ name: '无标题', url: 'https://x.dev', code: 'createFailed', detail: 'boom' }],
        },
        blocked: [
          { name: 'Gmail', url: 'javascript:x', scheme: 'javascript:' },
        ],
        targetName: '导入 2026-08-04',
        barTitle: '书签栏',
      },
    })
  })

  it('报告导入条数与落点', () => {
    render(<ImportPanel />)
    expect(screen.getByText('已导入 185 条书签到 书签栏/导入 2026-08-04')).toBeDefined()
  })

  it('把 blocked 与 skipped 合并成一份没进来的清单', () => {
    render(<ImportPanel />)
    expect(screen.getByText('2 条没有进来：')).toBeDefined()
    expect(screen.getByText(/Gmail — 不安全的链接类型（javascript:）/)).toBeDefined()
    expect(screen.getByText(/无标题 — 创建失败：boom/)).toBeDefined()
  })

  it('明确告诉用户怎么反悔——导入不接撤销机制', () => {
    render(<ImportPanel />)
    expect(screen.getByText('不需要的话，直接在 Chrome 里删掉这个文件夹即可。')).toBeDefined()
  })

  it('点完成回到待选态', async () => {
    render(<ImportPanel />)
    await userEvent.click(screen.getByText('完成'))
    expect(screen.getByText('选择文件…')).toBeDefined()
  })

  it('一条都没跳过时不显示清单', () => {
    useStore.setState({
      importDone: {
        result: { folderId: '99', bookmarks: 3, folders: 1, skipped: [] },
        blocked: [], targetName: '导入', barTitle: '书签栏',
      },
    })
    render(<ImportPanel />)
    expect(screen.queryByText(/没有进来/)).toBeNull()
  })
})

describe('ImportPanel 选文件', () => {
  it('选中文件后读取内容并进入预览', async () => {
    render(<ImportPanel />)
    const input = screen.getByLabelText('选择导入文件') as HTMLInputElement
    await userEvent.upload(input, jsonFile('picked.json', goodFile))
    expect(await screen.findByText('picked.json')).toBeDefined()
  })
})
