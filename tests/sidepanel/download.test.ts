import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadJson } from '@/sidepanel/lib/download'

let blobs: Blob[]
let anchor: HTMLAnchorElement | null

beforeEach(() => {
  blobs = []
  anchor = null
  vi.useFakeTimers()
  // jsdom 没有实现 createObjectURL，直接补上假的
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return 'blob:fake-url'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchor = this
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('downloadJson', () => {
  it('以指定文件名触发下载', () => {
    downloadJson('tidymark-tree-2026-08-04.json', { kind: 'tree' })
    expect(anchor).not.toBeNull()
    expect(anchor!.download).toBe('tidymark-tree-2026-08-04.json')
    expect(anchor!.href).toBe('blob:fake-url')
  })

  it('内容是 2 空格缩进的 JSON，便于人直接阅读', async () => {
    downloadJson('x.json', { kind: 'tree', roots: [{ name: 'A', url: 'https://a.dev' }] })
    expect(blobs).toHaveLength(1)
    // tsconfig 开了 noUncheckedIndexedAccess，下标访问要显式断言非空
    expect(blobs[0]!.type).toBe('application/json')
    await expect(blobs[0]!.text()).resolves.toBe(
      JSON.stringify({ kind: 'tree', roots: [{ name: 'A', url: 'https://a.dev' }] }, null, 2),
    )
  })

  it('点击当下不回收 URL，让下载先启动', () => {
    downloadJson('x.json', {})
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('本轮任务结束后回收 URL，不泄漏内存', () => {
    downloadJson('x.json', {})
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })
})
