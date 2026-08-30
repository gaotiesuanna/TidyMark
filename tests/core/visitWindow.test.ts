import { describe, it, expect } from 'vitest'
import { windowStart, VISIT_WINDOWS, type VisitWindow } from '@/core/visitWindow'

const NOW = Date.parse('2026-08-29T00:00:00Z')
const DAY = 86400000

describe('windowStart', () => {
  it('三个月、半年、一年各自往回数', () => {
    expect(windowStart('3m', NOW)).toBe(NOW - 90 * DAY)
    expect(windowStart('6m', NOW)).toBe(NOW - 180 * DAY)
    expect(windowStart('1y', NOW)).toBe(NOW - 365 * DAY)
  })

  it('「全部」是 0——chrome.history.search 用 0 表示不限起点', () => {
    expect(windowStart('all', NOW)).toBe(0)
  })

  it('选项按从宽到窄排，全部在最前', () => {
    expect(VISIT_WINDOWS).toEqual<VisitWindow[]>(['all', '1y', '6m', '3m'])
  })
})
