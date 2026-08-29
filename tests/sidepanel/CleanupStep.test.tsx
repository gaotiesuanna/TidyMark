import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CleanupStep } from '@/sidepanel/steps/CleanupStep'
import { Shell } from '@/sidepanel/components/Shell'
import { useStore } from '@/sidepanel/store'
import { send } from '@/sidepanel/lib/send'
import type { BookmarkNode } from '@/core/ports'
import type { BookmarkItem } from '@/core/types'
import type { StaleScanResult } from '@/core/stale'
import type { CleanupResult } from '@/engine/cleanup'

vi.mock('@/sidepanel/lib/send', () => ({ send: vi.fn() }))

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
const staleResult: StaleScanResult = {
  items: [],
  scannedAt: 1_754_000_000_000,
  cutoff3Months: 1_738_000_000_000,
  cutoff6Months: 1_722_000_000_000,
  cutoff12Months: 1_706_000_000_000,
  cutoff24Months: 1_674_000_000_000,
  scopeRootIdByBookmarkId: {},
}
const staleReadyResult: StaleScanResult = {
  items: [
    {
      item: item({
        id: 'stale-old',
        title: '旧文章',
        url: 'https://example.com/old',
        parentId: '10',
        currentPath: ['书签栏', '目录甲'],
      }),
      bucket: 'oneToTwoYears',
      lastUsedAt: new Date(2025, 0, 10).getTime(),
    },
    {
      item: item({
        id: 'stale-unknown',
        title: '没有记录的文章',
        url: 'https://example.com/unknown',
        parentId: '10',
        currentPath: ['书签栏', '目录甲'],
      }),
      bucket: 'unknown',
    },
  ],
  scannedAt: new Date(2026, 7, 26, 12).getTime(),
  cutoff3Months: new Date(2026, 4, 26, 12).getTime(),
  cutoff6Months: new Date(2026, 1, 26, 12).getTime(),
  cutoff12Months: new Date(2025, 7, 26, 12).getTime(),
  cutoff24Months: new Date(2024, 7, 26, 12).getTime(),
  scopeRootIdByBookmarkId: { 'stale-old': '10', 'stale-unknown': '10' },
}

beforeEach(() => {
  vi.mocked(send).mockReset()
  useStore.setState({
    tree,
    mode: 'cleanup',
    checkedIds: new Set(['selected-root']),
    busy: null,
    error: null,
    cleanupScan: scan,
    cleanupResult: null,
    cleanupKeep: {},
    // exact 组的默认勾选：除保留项之外全勾上
    cleanupChecked: new Set(['101', '120']),
    cleanupFolders: new Set(),
    cleanupMove: new Set(),
    cleanupStaleMove: new Set(),
    staleScan: null,
    staleState: 'idle',
    staleError: null,
    undoAvailable: false,
    runCleanupScan: vi.fn(async () => {}),
  })
})

async function openCleanupTab(name: string): Promise<void> {
  await userEvent.click(screen.getByRole('tab', { name }))
}

describe('长期未点击书签扫描状态', () => {
  it('页面说明扫描不读取浏览历史', () => {
    render(<CleanupStep />)
    expect(screen.getByText(/不读取浏览历史/)).toBeDefined()
  })

  it('扫描长期未点击书签发送清理扫描的全库根', async () => {
    vi.mocked(send).mockResolvedValue({
      ok: true, kind: 'cleanup_stale_scan', scan: staleResult,
    } as never)
    useStore.setState({ checkedIds: new Set(['selected-root']) })

    await useStore.getState().runStaleScan()

    expect(send).toHaveBeenCalledWith({
      kind: 'cleanup_stale_scan',
      scopeRootIds: ['1'],
    })
    expect(useStore.getState().staleState).toBe('empty')
  })

  it('清理页未勾选整理范围时仍按全库根扫描', async () => {
    vi.mocked(send).mockResolvedValue({
      ok: true, kind: 'cleanup_stale_scan', scan: staleResult,
    } as never)
    useStore.setState({ checkedIds: new Set(), staleState: 'idle', staleScan: null })

    await useStore.getState().runStaleScan()

    expect(send).toHaveBeenCalledWith({
      kind: 'cleanup_stale_scan',
      scopeRootIds: ['1'],
    })
    expect(useStore.getState().staleState).toBe('empty')
  })

  it('点击扫描按钮时即使没有整理勾选也会按全库根扫描', async () => {
    vi.mocked(send).mockResolvedValue({
      ok: true, kind: 'cleanup_stale_scan', scan: staleResult,
    } as never)
    useStore.setState({ checkedIds: new Set() })
    render(<CleanupStep />)

    await userEvent.click(screen.getByRole('button', { name: /扫描长期未点击书签/ }))

    expect(send).toHaveBeenCalledWith({
      kind: 'cleanup_stale_scan',
      scopeRootIds: ['1'],
    })
  })

  it('保留书签使用时间查询错误文本', async () => {
    vi.mocked(send).mockResolvedValue({ ok: false, error: 'bookmark usage unavailable' } as never)

    await useStore.getState().runStaleScan()

    expect(useStore.getState().staleState).toBe('error')
    expect(useStore.getState().staleError).toBe('bookmark usage unavailable')
  })

  it('清理范围改变后忽略在途扫描响应', async () => {
    let resolveSend: ((value: unknown) => void) | undefined
    vi.mocked(send).mockImplementation(
      () => new Promise((resolve) => { resolveSend = resolve }) as never,
    )

    const pending = useStore.getState().runStaleScan()
    await Promise.resolve()
    expect(useStore.getState().staleState).toBe('loading')
    useStore.setState({ cleanupScan: { ...scan, scopeRootIds: ['another-root'] } })
    resolveSend?.({ ok: true, kind: 'cleanup_stale_scan', scan: staleResult })
    await pending

    expect(useStore.getState().staleScan).toBeNull()
    expect(useStore.getState().staleState).toBe('loading')
  })


  it('run 序号改变后忽略在途扫描响应', async () => {
    let resolveSend: ((value: unknown) => void) | undefined
    vi.mocked(send).mockImplementation(
      () => new Promise((resolve) => { resolveSend = resolve }) as never,
    )

    const pending = useStore.getState().runStaleScan()
    await Promise.resolve()
    useStore.setState({ runSeq: useStore.getState().runSeq + 1 })
    resolveSend?.({ ok: true, kind: 'cleanup_stale_scan', scan: staleResult })
    await pending

    expect(useStore.getState().staleScan).toBeNull()
    expect(useStore.getState().staleState).toBe('loading')
  })

  it('长期未点击书签的删除与移动选择互斥', () => {
    useStore.setState({ cleanupChecked: new Set(['stale-id']), cleanupStaleMove: new Set() })

    useStore.getState().toggleStaleMove('stale-id')
    expect(useStore.getState().cleanupChecked.has('stale-id')).toBe(false)
    expect(useStore.getState().cleanupStaleMove.has('stale-id')).toBe(true)

    useStore.getState().toggleStaleDelete('stale-id')
    expect(useStore.getState().cleanupChecked.has('stale-id')).toBe(true)
    expect(useStore.getState().cleanupStaleMove.has('stale-id')).toBe(false)
  })
  it('stale history scan preserves duplicate and dead-link selections', async () => {
    vi.mocked(send).mockResolvedValue({
      ok: true, kind: 'cleanup_stale_scan', scan: staleReadyResult,
    } as never)
    useStore.setState({
      cleanupChecked: new Set(['101', 'dead-link']),
      cleanupMove: new Set(['dead-link-move']),
      cleanupStaleMove: new Set(),
      staleScan: null,
      staleState: 'idle',
      staleError: null,
    })

    await useStore.getState().runStaleScan()

    expect([...useStore.getState().cleanupChecked]).toEqual(['101', 'dead-link'])
    expect([...useStore.getState().cleanupMove]).toEqual(['dead-link-move'])
    expect(useStore.getState().staleState).toBe('ready')
  })

  it('changing checkedIds clears the old stale scan', () => {
    useStore.setState({
      checkedIds: new Set(['1']),
      staleScan: staleReadyResult,
      staleState: 'ready',
      staleError: 'old scan error',
    })

    useStore.getState().toggle('10')

    expect(useStore.getState().staleScan).toBeNull()
    expect(useStore.getState().staleState).toBe('idle')
    expect(useStore.getState().staleError).toBeNull()
  })

  it('refreshing the tree clears the old stale scan', async () => {
    vi.mocked(send).mockResolvedValue({ ok: true, kind: 'get_tree', tree } as never)
    useStore.setState({
      staleScan: staleReadyResult,
      staleState: 'ready',
      staleError: 'old scan error',
    })

    await useStore.getState().refreshTree()

    expect(useStore.getState().staleScan).toBeNull()
    expect(useStore.getState().staleState).toBe('idle')
    expect(useStore.getState().staleError).toBeNull()
  })

})
describe('CleanupStep 长期未点击书签一节', () => {
  it('授权前只展示说明和允许按钮，不在挂载时申请历史权限', () => {
    render(<CleanupStep />)
    expect(screen.getByText(/不读取浏览历史/)).toBeDefined()
    expect(screen.getByRole('button', { name: /扫描长期未点击书签/ })).toBeDefined()
  })

  it('准备完成后显示六个筛选档位、截止日期和书签详情', () => {
    useStore.setState({
      staleScan: staleReadyResult,
      staleState: 'ready',
      cleanupChecked: new Set(),
      cleanupStaleMove: new Set(),
    })
    render(<CleanupStep />)

    for (const label of ['全部', '3个月以上', '6个月以上', '1 年以上', '2 年以上', '无上次打开时间']) {
      expect(screen.getByRole('tab', { name: label })).toBeDefined()
    }
    expect(screen.getByText('旧文章')).toBeDefined()
    expect(screen.getByText('https://example.com/old')).toBeDefined()
    expect(screen.getAllByText('/书签栏/目录甲/').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/上次打开|无上次打开时间/).length).toBeGreaterThan(0)
    expect(screen.getByText(/上次打开早于/)).toBeDefined()
  })

  it('默认不勾选长期未点击书签，并允许单独筛选和选择未知时间', async () => {
    useStore.setState({
      staleScan: staleReadyResult,
      staleState: 'ready',
      cleanupChecked: new Set(),
      cleanupStaleMove: new Set(),
    })
    render(<CleanupStep />)

    const deleteOld = screen.getByRole('checkbox', { name: '删除 旧文章' }) as HTMLInputElement
    const moveOld = screen.getByRole('checkbox', { name: '移到待清理 旧文章' }) as HTMLInputElement
    expect(deleteOld.checked).toBe(false)
    expect(moveOld.checked).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: '无上次打开时间' }))
    expect(screen.getByText('没有记录的文章')).toBeDefined()
    expect(screen.queryByText('旧文章')).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: '删除 没有记录的文章' }))
    expect(useStore.getState().cleanupChecked.has('stale-unknown')).toBe(true)
  })

  it('长期未点击书签的选择合并进底部执行数量', async () => {
    useStore.setState({
      cleanupScan: scan,
      cleanupResult: null,
      cleanupChecked: new Set(),
      staleScan: staleReadyResult,
      staleState: 'ready',
      cleanupStaleMove: new Set(),
      cleanupFolders: new Set(),
      cleanupMove: new Set(),
    })
    render(<CleanupStep />)
    const run = screen.getByRole('button', { name: '清理 0 项' }) as HTMLButtonElement
    expect(run.disabled).toBe(true)
    await userEvent.click(screen.getByRole('checkbox', { name: '移到待清理 旧文章' }))
    expect(screen.getByRole('button', { name: '清理 1 项' })).toBeDefined()
    expect((screen.getByRole('button', { name: '清理 1 项' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('三个月以上筛选包含更久未点击但不包含未知时间', async () => {
    useStore.setState({
      staleScan: {
        ...staleReadyResult,
        items: [
          {
            item: item({
              id: 'stale-mid',
              title: '半年前的',
              url: 'https://example.com/mid',
              parentId: '10',
              currentPath: ['书签栏', '目录甲'],
            }),
            bucket: 'threeToSixMonths',
            lastUsedAt: new Date(2026, 3, 1).getTime(),
          },
          ...staleReadyResult.items,
        ],
      },
      staleState: 'ready',
      cleanupChecked: new Set(),
      cleanupStaleMove: new Set(),
    })
    render(<CleanupStep />)

    await userEvent.click(screen.getByRole('tab', { name: '3个月以上' }))
    expect(screen.getByText('半年前的')).toBeDefined()
    expect(screen.getByText('旧文章')).toBeDefined()
    expect(screen.queryByText('没有记录的文章')).toBeNull()

    await userEvent.click(screen.getByRole('tab', { name: '6个月以上' }))
    expect(screen.queryByText('半年前的')).toBeNull()
    expect(screen.queryByText('没有记录的文章')).toBeNull()
    expect(screen.getByText('旧文章')).toBeDefined()
  })

  it('跨多个文件夹时按文件夹分组，折叠起来，点开才见条目', async () => {
    useStore.setState({
      staleScan: {
        ...staleReadyResult,
        items: [
          ...staleReadyResult.items,
          {
            item: item({
              id: 'stale-other',
              title: '另一个目录的旧书签',
              url: 'https://example.com/other',
              parentId: '11',
              currentPath: ['书签栏', '目录乙'],
            }),
            bucket: 'overTwoYears',
            lastUsedAt: new Date(2023, 0, 1).getTime(),
          },
        ],
      },
      staleState: 'ready',
      cleanupChecked: new Set(),
      cleanupStaleMove: new Set(),
    })
    render(<CleanupStep />)

    // 两个文件夹头都在，条目默认收起
    const jiaToggle = screen.getByRole('button', { name: /展开 \/书签栏\/目录甲\/，共 2 条/ })
    expect(screen.getByRole('button', { name: /展开 \/书签栏\/目录乙\/，共 1 条/ })).toBeDefined()
    expect(screen.queryByText('旧文章')).toBeNull()
    expect(screen.queryByText('另一个目录的旧书签')).toBeNull()

    await userEvent.click(jiaToggle)
    expect(screen.getByText('旧文章')).toBeDefined()
    expect(screen.queryByText('另一个目录的旧书签')).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: '删除 旧文章' }))
    expect(useStore.getState().cleanupChecked.has('stale-old')).toBe(true)

    // 勾选数在折叠态也看得见
    await userEvent.click(screen.getByRole('button', { name: /收起 \/书签栏\/目录甲\// }))
    expect(screen.getByText('已选 1')).toBeDefined()
  })

  it('文件夹行的删除按钮一次勾选整组，再点清空', async () => {
    useStore.setState({
      staleScan: staleReadyResult,
      staleState: 'ready',
      cleanupChecked: new Set(),
      cleanupStaleMove: new Set(['stale-old']),
    })
    render(<CleanupStep />)

    const deleteAll = screen.getByRole('button', { name: /勾选 \/书签栏\/目录甲\/ 里的全部书签待删除/ })
    await userEvent.click(deleteAll)
    expect(useStore.getState().cleanupChecked.has('stale-old')).toBe(true)
    expect(useStore.getState().cleanupChecked.has('stale-unknown')).toBe(true)
    // 开启删除时把原来「移走」的挪出来，两者互斥
    expect(useStore.getState().cleanupStaleMove.has('stale-old')).toBe(false)

    const clearAll = screen.getByRole('button', { name: /取消 \/书签栏\/目录甲\/ 里书签的删除勾选/ })
    await userEvent.click(clearAll)
    expect(useStore.getState().cleanupChecked.size).toBe(0)
  })
})

describe('CleanupStep 功能小 tab', () => {
  it('默认停在长期未点击，不展示重复项', () => {
    render(<CleanupStep />)
    expect(screen.getByRole('tab', { name: '长期未点击' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '重复收藏' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: '失效链接' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByRole('checkbox', { name: '删除 a' })).toBeNull()
    expect(screen.queryByRole('button', { name: /开始检查/ })).toBeNull()
  })

  it('切到重复收藏才看到重复项', async () => {
    render(<CleanupStep />)
    await openCleanupTab('重复收藏')
    expect(screen.getByRole('checkbox', { name: '删除 a' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /扫描长期未点击书签/ })).toBeNull()
  })

  it('切到失效链接才看到开始检查', async () => {
    render(<CleanupStep />)
    await openCleanupTab('失效链接')
    expect(screen.getByRole('button', { name: /开始检查/ })).toBeDefined()
    expect(screen.queryByRole('checkbox', { name: '删除 a' })).toBeNull()
  })

  it('切走再切回仍保留已勾选项，底部数量跨 tab 合计', async () => {
    render(<CleanupStep />)
    await openCleanupTab('重复收藏')
    expect(screen.getByRole('button', { name: '清理 2 项' })).toBeDefined()
    await openCleanupTab('长期未点击')
    expect(screen.getByRole('button', { name: '清理 2 项' })).toBeDefined()
  })

  it('清理扫描日志默认不出现在长期未点击 tab', () => {
    useStore.setState({
      logs: [{ id: 1, phase: 'cleanup', level: 'info', message: '扫描完成：2 组重复、0 个空文件夹' }],
    })
    render(<Shell><CleanupStep /></Shell>)
    expect(screen.queryByText(/2 组重复/)).toBeNull()
  })

  it('切到重复收藏才看到清理扫描日志', async () => {
    useStore.setState({
      logs: [{ id: 1, phase: 'cleanup', level: 'info', message: '扫描完成：2 组重复、0 个空文件夹' }],
    })
    render(<Shell><CleanupStep /></Shell>)
    await openCleanupTab('重复收藏')
    expect(screen.getByText(/2 组重复/)).toBeDefined()
  })
})

describe('CleanupStep 默认勾选', () => {
  it('完全相同那档勾上待删项，保留项不勾且不可勾', async () => {
    render(<CleanupStep />)
    await openCleanupTab('重复收藏')
    const keeper = screen.getByRole('checkbox', { name: '删除 a' }) as HTMLInputElement
    const doomed = screen.getByRole('checkbox', { name: '删除 a 又存了一遍' }) as HTMLInputElement
    expect(keeper.checked).toBe(false)
    expect(keeper.disabled).toBe(true)
    expect(doomed.checked).toBe(true)
  })

  it('可能相同那档一条都不勾', async () => {
    render(<CleanupStep />)
    await openCleanupTab('重复收藏')
    const box = screen.getByRole('checkbox', { name: '删除 b 带追踪参数' }) as HTMLInputElement
    expect(box.checked).toBe(false)
  })

  it('可能相同那档带上说明，讲清为什么默认不勾', async () => {
    render(<CleanupStep />)
    await openCleanupTab('重复收藏')
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
    await openCleanupTab('重复收藏')
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
  it('没有任何可清理项时明说，不留一个空白页面', async () => {
    useStore.setState({
      cleanupScan: { ...scan, duplicates: [] },
      cleanupChecked: new Set(),
    })
    render(<CleanupStep />)
    await openCleanupTab('重复收藏')
    expect(screen.getByText('没有找到可清理的东西。')).toBeDefined()
  })

  it('一项都没勾时执行按钮禁用', () => {
    useStore.setState({
      cleanupScan: scan,
      cleanupResult: null,
      busy: null,
      cleanupChecked: new Set(),
      cleanupMove: new Set(),
      cleanupStaleMove: new Set(),
      cleanupFolders: new Set(),
      staleScan: null,
      staleState: 'idle',
    })
    render(<CleanupStep />)
    expect((screen.getByRole('button', { name: /清理|clean/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('CleanupStep 失效链接一节', () => {
  beforeEach(() => {
    useStore.setState({ cleanupLinks: [], linkCheckState: 'idle', cleanupMove: new Set() })
  })

  it('没授权前只有说明和按钮，不列任何结果', async () => {
    render(<CleanupStep />)
    await openCleanupTab('失效链接')
    expect(screen.getByText(/读取你在所有网站上的数据/)).toBeDefined()
    expect(screen.getByRole('button', { name: /开始检查/ })).toBeDefined()
    expect(screen.queryByText('确定失效')).toBeNull()
  })

  it('说明必须排在按钮之前——用户不该在看懂之前就被弹权限', async () => {
    render(<CleanupStep />)
    await openCleanupTab('失效链接')
    const explain = screen.getByText(/读取你在所有网站上的数据/)
    const button = screen.getByRole('button', { name: /开始检查/ })
    expect(explain.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('拒绝授权后显示跳过提示，另外两节仍在', async () => {
    useStore.setState({ linkCheckState: 'denied' })
    render(<CleanupStep />)
    await openCleanupTab('失效链接')
    expect(screen.getByText(/另外两项照常可用/)).toBeDefined()
    expect(screen.getByText('重复收藏')).toBeDefined()
    expect(screen.getByText('长期未点击')).toBeDefined()
  })


  it('确定失效可勾选，可疑那档只读、没有勾选框', async () => {
    useStore.setState({
      linkCheckState: 'done',
      cleanupLinks: [
        { bookmarkId: '200', url: 'https://gone.com/p', verdict: 'dead', status: 404, errorKind: null },
        { bookmarkId: '201', url: 'https://blocked.com/p', verdict: 'suspect', status: 403, errorKind: null },
      ],
      cleanupChecked: new Set(['200']),
    })
    render(<CleanupStep />)
    await openCleanupTab('失效链接')
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
    await openCleanupTab('失效链接')
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

/**
 * 清理跑完之后那一屏。原来只有一个「撤销」，是个只能后退的死胡同：
 * 想接着清、想收工，界面上都没有对应的那一下。
 */
describe('CleanupStep 清理完成后的出口', () => {
  const result: CleanupResult = {
    status: 'completed', deleted: 2, moved: 0,
    removedFolders: [{ id: '12', title: '目录丙', path: ['书签栏'] }],
    deadFolderId: null, skipped: [], error: null,
  }

  beforeEach(() => {
    useStore.setState({ cleanupResult: result, undoAvailable: true })
  })

  it('三个出口都在：撤销、再清一轮、结束清理', () => {
    render(<CleanupStep />)
    expect(screen.getByRole('button', { name: '撤销本次清理' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '再清一轮' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '结束清理' })).toBeTruthy()
  })

  // 书签已经变了，把刚才那份预览留着等于拿一份自己都不认得的旧数据接着清
  it('点再清一轮重新扫一遍', async () => {
    const runCleanupScan = vi.fn(async () => {})
    useStore.setState({ runCleanupScan })
    render(<CleanupStep />)
    runCleanupScan.mockClear()
    await userEvent.click(screen.getByRole('button', { name: '再清一轮' }))
    expect(runCleanupScan).toHaveBeenCalled()
  })

  it('点结束清理关掉侧栏', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    render(<CleanupStep />)
    await userEvent.click(screen.getByRole('button', { name: '结束清理' }))
    expect(close).toHaveBeenCalledOnce()
    close.mockRestore()
  })

  // 撤销槽是空的时候那个按钮点了也没用，但另外两个出口必须照旧可用
  it('没有可撤销的东西时，只有撤销禁用', () => {
    useStore.setState({ undoAvailable: false })
    render(<CleanupStep />)
    expect((screen.getByRole('button', { name: '撤销本次清理' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '再清一轮' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '结束清理' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
