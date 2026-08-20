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
 *
 *   topCap 收紧会参与「一层撑不撑得下」的判断，是有意的：cap 收得越紧，
 *   一层能吸收的书签就越少，可能被顶去两层。计划 2/2 的 depthGuard
 *   （见 tools/shape-with-groups.mjs）正是靠这件事工作——它从最紧的预算
 *   往回找第一个不加深的 cap，前提就是 cap 确实能影响深度。别把这里
 *   改成「topCap 只收窄 top、不参与深度判断」，那会让 depthGuard 的整个
 *   搜索退化成第一次迭代就返回，等于废掉这个防「多分一层」的机制
 *   （票 10 反复论证过：98 条书签被聚合组挤成 3×3 就是这么出的问题）。
 */
export function deriveShape(n: number, topCap: number = SHAPE_MAX_SIBLINGS): FolderShape {
  if (n <= 0) return { leaves: 0, depth: 0, top: 0, perLeaf: 0 }

  const wanted = Math.ceil(n / SWEET_LEAF)

  // 一层：目录数最多 topCap，装不下就让每个叶子多装点——判准给的是区间不是定值
  const top1 = Math.min(wanted, topCap)
  if (n / top1 <= MAX_LEAF) return { leaves: top1, depth: 1, top: top1, perLeaf: n / top1 }

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
  // 最多 SHAPE_MAX_SIBLINGS 个一级目录，聚合组 + 主题就把同层撑爆，depthGuard 白算。
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

/**
 * 主题目录的一级预算：**挤到不能再挤，但绝不因为聚合组而让主题多分一层。**
 *
 * 聚合组要占一级目录的位子，最直觉的做法是「主题预算 = 上限 − 组数」硬挤。
 * 原型对跑（tools/shape-with-groups.mjs）证明那一格是致命的：勾 6 个组、123 条书签时，
 * 主题的 98 条会被压成「3 个一级 × 3 个二级」——正是票 10 枪毙方案 A 的那个失败模式
 * （多分一层，而那层几乎不承载区分度），只是触发条件从「N 卡在阈值上」换成了「勾的组多」。
 *
 * 所以从最紧的预算起往回找第一个不会加深的值。规则里没有拍脑袋的常数：
 * 下限由「这批书签本来该多深」自己算出来。代价是同层总数——组数 + shape.top（或它
 * 三层时的兜底 SHAPE_MAX_SIBLINGS） + 1 个「其他」——最坏能到 **17**：勾满 6 个组、
 * 主题侧约 180 条以上就会摸到，不是极端角，是这个库规模最常见的取值（穷举实测见
 * final-review.md I1）。破判准 A3——接受它，因为同层多几个是线性代价（多扫两行），
 * 多一层是指数代价（每个都要点开才知道里面是什么），而「GitHub」「论文」「视频」
 * 这种来源名一眼掠过、几乎不耗认知。（这个上界当初是按「14」论证要不要接受的——
 * 那是拿错数字做的取舍；17 有没有超出当初愿意接受的范围，待真实库观感重判，
 * 不在这一轮修复范围内。）
 */
export function depthGuard(groups: number, topicN: number): number {
  const want = deriveShape(topicN, SHAPE_MAX_SIBLINGS).depth
  for (let cap = Math.max(SHAPE_MAX_SIBLINGS - groups, 1); cap < SHAPE_MAX_SIBLINGS; cap++) {
    if (deriveShape(topicN, cap).depth <= want) return cap
  }
  return SHAPE_MAX_SIBLINGS
}
