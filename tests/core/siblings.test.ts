import { describe, it, expect } from 'vitest'
import { measureTopSiblings } from '@/core/audit'
import { MAX_SIBLINGS } from '@/core/tree'
import { SHAPE_MAX_SIBLINGS } from '@/core/shape'
import type { CategoryCandidate } from '@/core/types'

function tops(n: number): CategoryCandidate[] {
  return Array.from({ length: n }, (_, i) => ({ id: `tmp:${i}`, path: [`0${i} 目录`] }))
}

describe('measureTopSiblings', () => {
  it('没超判准线时返回 null', () => {
    expect(measureTopSiblings(tops(SHAPE_MAX_SIBLINGS))).toBeNull()
  })

  it('超过判准的 10、但没超产品硬上限 12 时标成 judgment', () => {
    const r = measureTopSiblings(tops(SHAPE_MAX_SIBLINGS + 1))
    expect(r).toEqual({ count: SHAPE_MAX_SIBLINGS + 1, tier: 'judgment' })
  })

  // 两档性质不同：一档是判准嫌多，另一档是产品自己的闸都没拦住
  it('超过产品硬上限 12 时标成 product', () => {
    const r = measureTopSiblings(tops(MAX_SIBLINGS + 2))
    expect(r).toEqual({ count: MAX_SIBLINGS + 2, tier: 'product' })
  })

  it('只数一级，二级目录不算', () => {
    const candidates = [...tops(3), { id: 'x', path: ['00 目录', '01 子'] }]
    expect(measureTopSiblings(candidates)).toBeNull()
  })
})
