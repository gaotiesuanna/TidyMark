import { describe, it, expect } from 'vitest'
import { deriveShape, MAX_LEAF, SHAPE_MAX_SIBLINGS } from '@/core/shape'

describe('deriveShape', () => {
  it('书签少时一层就够，目录数按甜点 12 算', () => {
    // 真实那一遍：123 条 → 10 个叶子、一层，每个叶子 12.3 条
    const shape = deriveShape(123)
    expect(shape.depth).toBe(1)
    expect(shape.top).toBe(10)
    expect(shape.leaves).toBe(10)
    expect(shape.perLeaf).toBeCloseTo(12.3, 1)
  })

  it('目录数顶到同层上限后先撑大叶子，不急着分层', () => {
    // 180 条：按甜点要 15 个，超了上限 10 → 10 个叶子各装 18 条，仍在 20 以内
    const shape = deriveShape(180)
    expect(shape.depth).toBe(1)
    expect(shape.top).toBe(SHAPE_MAX_SIBLINGS)
    expect(shape.perLeaf).toBeLessThanOrEqual(MAX_LEAF)
  })

  it('叶子撑过 20 才加一层——深度跳变只发生在 N=201', () => {
    expect(deriveShape(200).depth).toBe(1)
    expect(deriveShape(201).depth).toBe(2)
  })

  it('两层时叶子回到甜点，一级目录数取「均衡」与「够用」里更大的那个', () => {
    const shape = deriveShape(600)
    expect(shape.depth).toBe(2)
    expect(shape.leaves).toBe(50)
    // floor(√50)=7，ceil(50/10)=5 → 取 7
    expect(shape.top).toBe(7)
  })

  it('深度必须单调——L=91 附近曾经会「两层→三层→两层」', () => {
    // 只取 floor(√L) 时 L=91 算出 10.1 个二级、超上限退回三层，而 L=100 又回到两层。
    // 这个坑票 10 踩过一次，钉住它
    let previous = deriveShape(20).depth
    for (let n = 20; n <= 1500; n++) {
      const depth = deriveShape(n).depth
      expect(depth, `N=${n} 的深度比 N=${n - 1} 还浅`).toBeGreaterThanOrEqual(previous)
      previous = depth
    }
  })

  it('第二处跳变在 N=1201 进三层', () => {
    expect(deriveShape(1200).depth).toBe(2)
    expect(deriveShape(1201).depth).toBe(3)
  })

  it('topCap 收紧时一层能装的目录变少，其余照旧', () => {
    // 计划 2/2 会用它把聚合组占掉的位子让出来
    expect(deriveShape(123, 6).top).toBe(6)
    expect(deriveShape(123, 6).depth).toBe(1)
  })

  it('零和负数不炸，返回空形状', () => {
    expect(deriveShape(0)).toEqual({ leaves: 0, depth: 0, top: 0, perLeaf: 0 })
    expect(deriveShape(-5).depth).toBe(0)
  })
})
