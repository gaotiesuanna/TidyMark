import { describe, it, expect } from 'vitest'
import { windowStart, VISIT_WINDOWS, type VisitWindow } from '@/core/visitWindow'

const NOW = Date.parse('2026-08-29T00:00:00Z')
const DAY = 86400000

describe('windowStart', () => {
  it('一个月起，各自往回数', () => {
    expect(windowStart('1m', NOW)).toBe(NOW - 30 * DAY)
    expect(windowStart('2m', NOW)).toBe(NOW - 60 * DAY)
    expect(windowStart('3m', NOW)).toBe(NOW - 90 * DAY)
    expect(windowStart('6m', NOW)).toBe(NOW - 180 * DAY)
    expect(windowStart('1y', NOW)).toBe(NOW - 365 * DAY)
  })

  it('「全部」是 0——chrome.history.search 用 0 表示不限起点', () => {
    expect(windowStart('all', NOW)).toBe(0)
  })

  it('全部打头，其余从最短排到最长', () => {
    expect(VISIT_WINDOWS).toEqual<VisitWindow[]>(['all', '1m', '2m', '3m', '6m', '1y'])
  })
})
