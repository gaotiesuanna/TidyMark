/**
 * 目录的形状（几个、几层）由这次要整理的书签总数推导，而不是由用户拨旋钮。
 *
 * 判准（见 issues/01-good-tree-criteria.md）里叶子容量的**下限**是 8、甜点是 12。
 * 方案 D 建立在「甜点只是甜点」这一点上：先按甜点算需要几个叶子；目录数顶到同层上限之后
 * **让叶子往上长**；长过 STRETCH_LEAF（20）才加一层。四个方案的对跑见
 * issues/10-shape-from-count.md 与 tools/shape.mjs，另外三个都在某处产生
 * 「多分一层、而那层几乎不承载区分度」的失败。
 *
 * 全程只有两处深度跳变：N=201 进两层、N=1201 进三层。而且悬崖没那么可怕——
 * 周期性整理走的是非推翻模式、根本不重新设计，形状推导只在首次整理跑一次。
 *
 * **容量上限（判准 A1）不在这里生效。**它由 core/audit.ts 的 findOversizedFolders
 * 对**落成后的实际占用**验算，用的是 MAX_LEAF = 12；这里预测用的是 STRETCH_LEAF = 20。
 * 两个数分家的理由见下面 STRETCH_LEAF 的注释与 issues/38-source-vs-topic.md 的 D2。
 */

/** 叶子目录的目标容量。 */
export const SWEET_LEAF = 12
/**
 * 叶子目录的容量上限（判准 A1）。**落成之后**验算用——超过它的目录由
 * core/audit.ts 的 findOversizedFolders 挑出来，单独再切一层。
 *
 * 从 20 收到 12 是 issues/38-source-vs-topic.md 的 D2，判准 A1 由「8–20」改判「8–12」。
 * 12 就是 SWEET_LEAF：甜点即上限，超过甜点就该往下分。
 *
 * **不要拿它去改 deriveShape**——那里用的是下面的 STRETCH_LEAF，两个数有意分家。
 */
export const MAX_LEAF = 12
/**
 * 预测阶段允许叶子撑到哪。只有 deriveShape 读它。
 *
 * 它曾经和 MAX_LEAF 是同一个数（20），D2 把两件事拆开：
 *
 * - **预测故意宽松。**形状是开工前一次性算的，算的是平均值。宽松是 issues/10 的立场：
 *   绝不因为预测就多分一层。宽松能成立的前提正是有落成后那道严格验算兜底。
 * - **验算严格。**MAX_LEAF = 12 看的是单个目录的真实占用，切的是那一个目录、不是整棵树。
 *
 * 为什么不能把这个数也收到 12（两条，都致命，见 issues/38 的 D2 展开）：
 *
 * 1. SWEET_LEAF 也是 12，甜点等于上限，方案 D 的「先撑大叶子、撑不下再分层」
 *    失去全部弹性空间，退化成「一到上限就分层」。
 * 2. 深度跳变从 N=201 提前到 N=121，而那一段 deriveShape 吐的是 top=3——三个一级目录，
 *    只能叫「后端开发」这种粗名字。两层布局是 branch = floor(√leaves)，天生
 *    「少而粗的一级 + 多而细的叶子」，产不出「多而具体的一级 + 每个轻度细分」那种形状。
 *    后一种形状只能靠落成后的验算走出来。
 */
export const STRETCH_LEAF = 20
/**
 * 同一层的目录数上限（判准 A3）。
 *
 * 比 core/tree.ts 的 `MAX_SIBLINGS = 12` 紧：那个数是建树阶段的最后兜底，还被
 * 非推翻模式用着；这个是形状推导自己的判准线。两者有意不合并。
 */
export const SHAPE_MAX_SIBLINGS = 10

/**
 * 判准 A5 的红线：「其他」整个子树占范围内书签总数的比例上限。
 *
 * 与 A1 量的**不是同一个东西**，两者不可比、也互不覆盖（organize-audit-holes 05 票判准 D）：
 * A1 量「一个目录**直接**装了多少条」，是**形状**判准，治法是下切；
 * A5 量「『其他』**整个子树**占全库的份额」，是**覆盖**判准——它胀起来说的是
 * 顶层设计没覆盖住这个库，治法在上游（预算与落位），不是把它切开。
 * 所以把「其他」切成 9 个子目录之后，A1 处处通过而 A5 照样破。
 *
 * 越线的动作是「量出来 + 在复核页如实告知」，不是阻断、不是回头重设计
 * （05 票判准 A/B）。这个数在 123 条的库上校准，要不要改是最后一招，别先翻它。
 */
export const FALLBACK_SHARE_LIMIT = 0.1

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
 * @param topCap 一级目录数上限。默认 SHAPE_MAX_SIBLINGS，目前没有调用点收紧它——
 *   曾经有一个（depthGuard，给聚合组让出一级位子），随 issues/38 的 D4
 *   取消域名聚合一起退休。参数保留是因为 topCap 收紧确实参与
 *   「一层撑不撑得下」的判断（cap 越紧，一层能吸收的书签越少，可能被顶去两层），
 *   将来若再有别的东西要占一级位子，这个口子是现成的。
 */
export function deriveShape(n: number, topCap: number = SHAPE_MAX_SIBLINGS): FolderShape {
  if (n <= 0) return { leaves: 0, depth: 0, top: 0, perLeaf: 0 }

  const wanted = Math.ceil(n / SWEET_LEAF)

  // 一层：目录数最多 topCap，装不下就让每个叶子多装点——判准给的是区间不是定值
  const top1 = Math.min(wanted, topCap)
  if (n / top1 <= STRETCH_LEAF) return { leaves: top1, depth: 1, top: top1, perLeaf: n / top1 }

  // 两层：叶子回到甜点，只是它们不再都挂在一级
  const leaves = wanted
  // 两层布局的容量 = 一级数 × 每个一级下的二级数。一级被 topCap 收紧时容量跟着变小，
  // 于是更早需要三层——写死上限的话，紧预算下两层塞不下也不会分层（N > 1200 才走得到
  // 默认预算下的这条分支，超出当前证据范围（真实数据只有 123 条）；三层的分配暂不细化，
  // 硬编一套没验证过的规则不如留空——到时按同样的思路再递归一层）。
  if (leaves > topCap * SHAPE_MAX_SIBLINGS) {
    return { leaves, depth: 3, top: 0, perLeaf: n / leaves }
  }
  // branch 就是一级目录数，必须服从 topCap：写死上限的话，预算收紧时两层布局仍会吐出
  // 最多 SHAPE_MAX_SIBLINGS 个一级目录，把同层撑爆。
  // 分叉取「均衡」与「够用」里更大的那个。只取 floor(√L) 会在 L=91 处算出 10.1 个
  // 二级、超上限退回三层，而 L=100 又回到两层——**深度非单调**。这个坑票 10 踩过一次。
  // 注意 Math.ceil(leaves / SHAPE_MAX_SIBLINGS) 这一项分母不变：它问的是「每个一级下
  // 最多 SHAPE_MAX_SIBLINGS 个二级，那至少要几个一级」，分母是二级的上限、不是一级的预算。
  const branch = Math.min(
    topCap,
    Math.max(Math.floor(Math.sqrt(leaves)), Math.ceil(leaves / SHAPE_MAX_SIBLINGS), 3),
  )
  return { leaves, depth: 2, top: branch, perLeaf: n / leaves }
}
