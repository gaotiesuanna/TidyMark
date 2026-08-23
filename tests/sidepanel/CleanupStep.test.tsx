import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CleanupStep } from '@/sidepanel/steps/CleanupStep'
import { useStore } from '@/sidepanel/store'
import type { BookmarkNode } from '@/core/ports'
import type { BookmarkItem } from '@/core/types'

/**
 * 目录丙只有一条书签，而那条是重复项——勾上它，目录丙就该在「空文件夹」一节
 * 里冒出来。这是本组测试要验的核心联动。
 */
const tree: BookmarkNode[] = [
  { id: '0', title: '', children: [
    { id: '1', title: '书签栏', children: [
      { id: '10', title: '目录甲', children: [
        { id: '100', title: 'a', url: 'https://a.com/p' },
        { id: '101', title: 'a 又存了一遍', url: 'https://a.com/p' },
      ]},
      { id: '11', title: '目录乙', children: [
        { id: '110', title: 'b', url: 'https://b.com/p' },
        { id: '111', title: 'b 带追踪参数', url: 'https://b.com/p?utm_source=x' },
      ]},
      { id: '12', title: '目录丙', children: [
        { id: '120', title: 'a 第三遍', url: 'https://a.com/p' },
      ]},
    ]},
  ]},
]

function item(
  over: Partial<BookmarkItem> & { id: string; url: string; title: string; currentPath: string[] },
): BookmarkItem {
  return { parentId: 'p', index: 0, ...over }
}

const scan = {
  duplicates: [
    { kind: 'exact' as const, key: 'https://a.com/p', keepId: '100', items: [
      item({ id: '100', title: 'a', url: 'https://a.com/p', parentId: '10', currentPath: ['书签栏', '目录甲'] }),
      item({ id: '101', title: 'a 又存了一遍', url: 'https://a.com/p', parentId: '10', index: 1, currentPath: ['书签栏', '目录甲'] }),
      item({ id: '120', title: 'a 第三遍', url: 'https://a.com/p', parentId: '12', currentPath: ['书签栏', '目录丙'] }),
    ]},
    { kind: 'normalized' as const, key: 'https://b.com/p', keepId: '110', items: [
      item({ id: '110', title: 'b', url: 'https://b.com/p', parentId: '11', currentPath: ['书签栏', '目录乙'] }),
      item({ id: '111', title: 'b 带追踪参数', url: 'https://b.com/p?utm_source=x', parentId: '11', index: 1, currentPath: ['书签栏', '目录乙'] }),
    ]},
  ],
  emptyFolders: [],
  items: [], folders: [], scopeRootIds: ['1'],
}

beforeEach(() => {
  useStore.setState({
    tree,
    mode: 'cleanup',
    busy: null,
    error: null,
    cleanupScan: scan,
    cleanupResult: null,
    cleanupKeep: {},
    // exact 组的默认勾选：除保留项之外全勾上
    cleanupChecked: new Set(['101', '120']),
    cleanupFolders: new Set(),
    undoAvailable: false,
    runCleanupScan: vi.fn(async () => {}),
  })
})

describe('CleanupStep 默认勾选', () => {
  it('完全相同那档勾上待删项，保留项不勾且不可勾', () => {
    render(<CleanupStep />)
    const keeper = screen.getByRole('checkbox', { name: '删除 a' }) as HTMLInputElement
    const doomed = screen.getByRole('checkbox', { name: '删除 a 又存了一遍' }) as HTMLInputElement
    expect(keeper.checked).toBe(false)
    expect(keeper.disabled).toBe(true)
    expect(doomed.checked).toBe(true)
  })

  it('可能相同那档一条都不勾', () => {
    render(<CleanupStep />)
    const box = screen.getByRole('checkbox', { name: '删除 b 带追踪参数' }) as HTMLInputElement
    expect(box.checked).toBe(false)
  })

  it('可能相同那档带上说明，讲清为什么默认不勾', () => {
    render(<CleanupStep />)
    expect(screen.getByText(/默认不勾/)).toBeDefined()
  })
})

describe('CleanupStep 空文件夹随勾选联动', () => {
  it('唯一的书签被勾上待删时，它的父目录出现在空文件夹一节', () => {
    render(<CleanupStep />)
    expect(screen.getByText('目录丙')).toBeDefined()
    expect(screen.getByText('删除后将变空')).toBeDefined()
  })

  it('取消勾选后那个目录立刻消失', async () => {
    render(<CleanupStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: '删除 a 第三遍' }))
    expect(screen.queryByText('目录丙')).toBeNull()
  })

  it('两条中只勾掉一条的目录不算空', () => {
    render(<CleanupStep />)
    expect(screen.queryByText('目录甲')).toBeNull()
  })
})

describe('CleanupStep 覆盖警告', () => {
  it('已有撤销快照时警告用户上一次整理将撤不回来', () => {
    useStore.setState({ undoAvailable: true })
    render(<CleanupStep />)
    expect(screen.getByText(/无法再撤销/)).toBeDefined()
  })

  it('没有快照时不显示警告', () => {
    render(<CleanupStep />)
    expect(screen.queryByText(/无法再撤销/)).toBeNull()
  })
})

describe('CleanupStep 空状态', () => {
  it('没有任何可清理项时明说，不留一个空白页面', () => {
    useStore.setState({
      cleanupScan: { ...scan, duplicates: [] },
      cleanupChecked: new Set(),
    })
    render(<CleanupStep />)
    expect(screen.getByText('没有找到可清理的东西。')).toBeDefined()
  })

  it('一项都没勾时执行按钮禁用', () => {
    useStore.setState({ cleanupChecked: new Set(), cleanupFolders: new Set() })
    render(<CleanupStep />)
    expect((screen.getByRole('button', { name: /清理/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('CleanupStep 失效链接一节', () => {
  beforeEach(() => {
    useStore.setState({ cleanupLinks: [], linkCheckState: 'idle', cleanupMove: new Set() })
  })

  it('没授权前只有说明和按钮，不列任何结果', () => {
    render(<CleanupStep />)
    expect(screen.getByText(/读取你在所有网站上的数据/)).toBeDefined()
    expect(screen.getByRole('button', { name: /开始检查/ })).toBeDefined()
    expect(screen.queryByText('确定失效')).toBeNull()
  })

  it('说明必须排在按钮之前——用户不该在看懂之前就被弹权限', () => {
    render(<CleanupStep />)
    const explain = screen.getByText(/读取你在所有网站上的数据/)
    const button = screen.getByRole('button', { name: /开始检查/ })
    expect(explain.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('拒绝授权后显示跳过提示，另外两节仍在', () => {
    useStore.setState({ linkCheckState: 'denied' })
    render(<CleanupStep />)
    expect(screen.getByText(/另外两项照常可用/)).toBeDefined()
    expect(screen.getByText('重复收藏')).toBeDefined()
  })

  it('确定失效可勾选，可疑那档只读、没有勾选框', () => {
    useStore.setState({
      linkCheckState: 'done',
      cleanupLinks: [
        { bookmarkId: '200', url: 'https://gone.com/p', verdict: 'dead', status: 404, errorKind: null },
        { bookmarkId: '201', url: 'https://blocked.com/p', verdict: 'suspect', status: 403, errorKind: null },
      ],
      cleanupChecked: new Set(['200']),
    })
    render(<CleanupStep />)
    expect((screen.getByRole('checkbox', { name: '删除 https://gone.com/p' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('checkbox', { name: /https:\/\/blocked\.com/ })).toBeNull()
    expect(screen.getByText(/https:\/\/blocked\.com\/p/)).toBeDefined()
  })

  it('勾了「移走」就自动取消「删除」，两者互斥', async () => {
    useStore.setState({
      linkCheckState: 'done',
      cleanupLinks: [
        { bookmarkId: '200', url: 'https://gone.com/p', verdict: 'dead', status: 404, errorKind: null },
      ],
      cleanupChecked: new Set(['200']),
    })
    render(<CleanupStep />)
    await userEvent.click(screen.getByRole('checkbox', { name: '移到「失效链接」文件夹 https://gone.com/p' }))
    expect(useStore.getState().cleanupChecked.has('200')).toBe(false)
    expect(useStore.getState().cleanupMove.has('200')).toBe(true)
  })

  /**
   * 最容易漏的一条：移走同样腾空了原位置。只按「删除」那批推演，
   * 预览会漏报目录，用户执行完才发现多清了几个。
   */
  it('选了「移走」的死链也计入空目录推演', () => {
    useStore.setState({
      linkCheckState: 'done',
      cleanupLinks: [
        { bookmarkId: '120', url: 'https://a.com/p', verdict: 'dead', status: 404, errorKind: null },
      ],
      cleanupChecked: new Set(),
      cleanupMove: new Set(['120']),
    })
    render(<CleanupStep />)
    // 目录丙只有 120 这一条，移走之后它就空了
    expect(screen.getByText('目录丙')).toBeDefined()
  })
})
