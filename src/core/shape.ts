/**
 * 目录的形状（几个、几层）由这次要整理的书签总数推导，而不是由用户拨旋钮。
 *
 * 判准（见 issues/01-good-tree-criteria.md）给叶子目录的容量区间是 8–20，**甜点 12 只是甜点**。
 * 方案 D 就建立在这一点上：先按甜点算需要几个叶子；目录数顶到同层上限之后**让叶子往上长**；
 * 长过容量上限 20 才加一层。四个方案的对跑见 issues/10-shape-from-count.md 与
 * tools/shape.mjs，另外三个都在某处产生「多分一层、而那层几乎不承载区分度」的失败。
 *
 * 全程只有两处深度跳变：N=201 进两层、N=1201 进三层。而且悬崖没那么可怕——
 * 周期性整理走的是非推翻模式、根本不重新设计，形状推导只在首次整理跑一次。
 */

/** 叶子目录的目标容量。 */
export const SWEET_LEAF = 12
/** 叶子目录的容量上限（判准 A1）。撑过它就该加一层。 */
export const MAX_LEAF = 20
/**
 * 同一层的目录数上限（判准 A3）。
 *
 * 比 core/tree.ts 的 `MAX_SIBLINGS = 12` 紧：那个数是建树阶段的最后兜底，还被
 * 非推翻模式用着；这个是形状推导自己的判准线。两者有意不合并。
 */
export const SHAPE_MAX_SIBLINGS = 10

export interface FolderShape {
  /** 叶子目录总数（一层时就是 top，两层时是所有二级目录之和）。 */
  leaves: number
  /** 目录树的层数。0 表示没有书签可整理。 */
  depth: number
  /** 一级目录数。 */
  top: number
  /** 平均每个叶子装多少条。 */
  perLeaf: number
}

/**
 * @param n      这次要整理的书签总数
 * @param topCap 一级目录数上限。计划 2/2 会用它把聚合组占掉的位子让出来。
 */
export function deriveShape(n: number, topCap: number = SHAPE_MAX_SIBLINGS): FolderShape {
  if (n <= 0) return { leaves: 0, depth: 0, top: 0, perLeaf: 0 }

  const wanted = Math.ceil(n / SWEET_LEAF)

  // 一层：先按「本来能站几个」（同层上限 SHAPE_MAX_SIBLINGS）判断撑不撑得下——
  // 这是形状本身的决策，不该被 topCap 干扰。topCap 只是调用方（计划 2/2）
  // 为聚合组预留位置而对「返回几个一级目录」的额外收紧，不能反过来把它塞进
  // MAX_LEAF 判断里：那样会出现「topCap 越紧，越容易被误判成要分层」的怪现象，
  // 恰恰违背「先撑大叶子、撑不下才分层」的初衷。
  const top1 = Math.min(wanted, SHAPE_MAX_SIBLINGS)
  if (n / top1 <= MAX_LEAF) {
    const top = Math.min(top1, topCap)
    return { leaves: top, depth: 1, top, perLeaf: n / top }
  }

  // 两层：叶子回到甜点，只是它们不再都挂在一级
  const leaves = wanted
  if (leaves > SHAPE_MAX_SIBLINGS * SHAPE_MAX_SIBLINGS) {
    // 三层的分配暂不细化：N > 1200 才走得到，超出当前证据范围（真实数据只有 123 条）。
    // 硬编一套没验证过的规则不如留空——到时按同样的思路再递归一层。
    return { leaves, depth: 3, top: 0, perLeaf: n / leaves }
  }
  // 分叉取「均衡」与「够用」里更大的那个。只取 floor(√L) 会在 L=91 处算出 10.1 个
  // 二级、超上限退回三层，而 L=100 又回到两层——**深度非单调**。这个坑票 10 踩过一次。
  const branch = Math.min(
    SHAPE_MAX_SIBLINGS,
    Math.max(Math.floor(Math.sqrt(leaves)), Math.ceil(leaves / SHAPE_MAX_SIBLINGS), 3),
  )
  return { leaves, depth: 2, top: branch, perLeaf: n / leaves }
}
