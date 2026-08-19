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

  it('三层的分配留空——top === 0 是调用方必须兜底的占位符，不是「零个一级目录」', () => {
    // N > 1200 才走得到这条分支（真实数据只有 123 条，超出了当前证据范围，
    // 见函数 JSDoc）。1300 条：leaves = ceil(1300/12) = 109 > 100，落进三层。
    // top 留 0 是有意的占位——调用方（background/handlers.ts）必须把它兜底成
    // SHAPE_MAX_SIBLINGS，不能直接拿去当「一级目录数」用（那会让提示词写
    // 「一级目录不超过 -1 个」）。这条测试钉住占位符本身，不代表三层的真实分配
    // 已经实现——它没有，实现前这条断言应该一直保持 top === 0。
    const shape = deriveShape(1300)
    expect(shape).toEqual({ leaves: 109, depth: 3, top: 0, perLeaf: 1300 / 109 })
  })

  it('topCap 收紧时，一层可能装不下——深度会被顶上去', () => {
    // 123 条按甜点要 11 个叶子；cap 收到 6 时 123/6 = 20.5 > 20，一层撑不下，
    // 于是分两层：leaves 仍是 11，branch = max(floor(√11)=3, ceil(11/10)=2, 3) = 3。
    // **这正是计划 2/2 的 depthGuard 要防的事**——它会从最紧的预算往回找第一个不加深的，
    // 而它能这么找的前提，就是 topCap 确实参与深度判断（见 tools/shape-with-groups.mjs）。
    expect(deriveShape(123, 6)).toMatchObject({ depth: 2, top: 3, leaves: 11 })
  })

  it('topCap 宽到装得下时，它只封顶一级目录数，不改变深度', () => {
    // 60 条：甜点要 5 个，cap 8 不咬合；cap 3 时 60/3 = 20，正好不超上限，仍是一层
    expect(deriveShape(60, 8)).toMatchObject({ depth: 1, top: 5 })
    expect(deriveShape(60, 3)).toMatchObject({ depth: 1, top: 3 })
  })

  it('零和负数不炸，返回空形状', () => {
    expect(deriveShape(0)).toEqual({ leaves: 0, depth: 0, top: 0, perLeaf: 0 })
    expect(deriveShape(-5).depth).toBe(0)
  })
})
