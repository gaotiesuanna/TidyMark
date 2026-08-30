import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { visitUrls } from '@/sidepanel/lib/visits'

const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> }
const original = chromeGlobal.chrome?.history

const NOW = Date.parse('2026-08-29T00:00:00Z')
const DAY = 86400000

let search: ReturnType<typeof vi.fn>
let getVisits: ReturnType<typeof vi.fn>

beforeEach(() => {
  search = vi.fn(() => Promise.resolve([]))
  getVisits = vi.fn(() => Promise.resolve([]))
  chromeGlobal.chrome = { ...chromeGlobal.chrome, history: { search, getVisits } }
})

afterAll(() => {
  chromeGlobal.chrome.history = original
})

describe('visitUrls', () => {
  it('「全部」只查一次，次数直接取 visitCount', async () => {
    search.mockResolvedValue([
      { url: 'https://github.com/a', title: 'A', visitCount: 20 },
      { url: 'https://github.com/b', title: 'B', visitCount: 3 },
    ])

    expect(await visitUrls('all', NOW)).toEqual([
      { url: 'https://github.com/a', title: 'A', weight: 20 },
      { url: 'https://github.com/b', title: 'B', weight: 3 },
    ])
    expect(search).toHaveBeenCalledWith({ text: '', maxResults: 10000, startTime: 0 })
    expect(getVisits).not.toHaveBeenCalled()
  })

  it('限了时间窗就逐条数窗内的时间戳，不用 visitCount', async () => {
    search.mockResolvedValue([
      { url: 'https://github.com/a', title: 'A', visitCount: 500 },
    ])
    getVisits.mockResolvedValue([
      { visitTime: NOW - 1 * DAY },
      { visitTime: NOW - 10 * DAY },
      // 窗外的两年前那笔不算
      { visitTime: NOW - 700 * DAY },
    ])

    expect(await visitUrls('3m', NOW)).toEqual([
      { url: 'https://github.com/a', title: 'A', weight: 2 },
    ])
    expect(search).toHaveBeenCalledWith({
      text: '', maxResults: 10000, startTime: NOW - 90 * DAY,
    })
    expect(getVisits).toHaveBeenCalledWith({ url: 'https://github.com/a' })
  })

  it('窗内一次都没有的丢掉', async () => {
    search.mockResolvedValue([{ url: 'https://github.com/old', visitCount: 900 }])
    getVisits.mockResolvedValue([{ visitTime: NOW - 700 * DAY }])

    expect(await visitUrls('3m', NOW)).toEqual([])
  })

  it('查不到访问明细的当作窗内没有，不炸', async () => {
    search.mockResolvedValue([{ url: 'https://github.com/x', visitCount: 5 }])
    getVisits.mockRejectedValue(new Error('nope'))

    expect(await visitUrls('3m', NOW)).toEqual([])
  })
})
