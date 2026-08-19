import type { Locale } from './locale'
import { stripNumberPrefix } from './map'
import type { ScanResult } from './types'

/**
 * 这一轮整理走哪条路。
 *
 * - `rebuild`：推翻现有结构，重新设计整棵目录树。
 * - `additive`：只把书签归进已有目录，实在分不进去的攒成新目录，绝不改动任何已有目录。
 */
export type OrganizeMode = 'rebuild' | 'additive'

export interface ModeDecision {
  mode: OrganizeMode
  /** 直接显示给用户、也写进日志，所以必须双语——由传进来的 locale 定。 */
  reason: string
}

/**
 * 三条阈值都是初值，要靠更多真实书签库校准（见 issues/14-mode-detection.md §3）。
 *
 * 与「目录形状怎么由书签总数推导」那组数字不同：那组决定产出长什么样，这组只决定走哪条路，
 * 而且误判有逃生口兜底，容错高得多。也正因如此，它们不做成设置项——
 * 用户无从判断 0.3 还是 0.35 更好。
 */
export const NUMBERED_PREFIX_RATIO = 0.5
export const LOOSE_BOOKMARK_RATIO = 0.3
export const SINGLETON_FOLDER_RATIO = 0.4

/**
 * 样本量护栏，与上面三条比例同类——也是待更多真实书签库校准的初值。
 *
 * 判断目录/书签的数量低于这两个门槛时，对应的比例规则不生效，直接放行给下一条规则
 * （最终兜底是 additive）。理由见 issues/14-mode-detection.md §2：不对称论证的全部
 * 力量来自「乱信号是明确的」，样本量只有一两个时，一个目录/一条书签就能把比例推过线，
 * 这算不上明确证据。
 *
 * 「一个目录都没有 → rebuild」那条不受这两个护栏影响：它是结构事实，不是比例。
 */
export const MIN_JUDGED_FOLDERS = 4
export const MIN_JUDGED_BOOKMARKS = 10

/**
 * 「这个目录名带编号前缀吗」。`stripNumberPrefix` 剥不动就是没带。
 *
 * 整串都是编号的标题（如 `01 `）被 stripNumberPrefix 原样返回，于是这里判成「没带」。
 * 方向是对的：宁可少认一个编号，也不要把手工整理的库误认成 TidyMark 的旧作。
 */
function hasNumberPrefix(title: string): boolean {
  return stripNumberPrefix(title) !== title
}

/**
 * 判断这次该重新设计整棵目录树，还是只把书签归进现有目录。
 *
 * 两个方向的误判代价不对称（见 issues/14-mode-detection.md §2）：
 * 「该重新设计却归入现有」只是把书签塞进不太好的目录，用户在复核页逐条看得见、
 * 拒得掉；「该归入现有却重新设计」会把整套目录推翻，正是这张地图要治的病。
 * 所以规则写成**默认已整理，只有明确的乱信号才翻成一团乱麻**，而不是反过来找整齐的证据。
 *
 * 勾了多个范围根时合起来判一次，不逐根各判各的（§4）：与上面的不对称一致，
 * 也与现有链路不拧——多根且非永久目录时推翻模式本来就要合并成一棵新树，
 * 逐根各判会让一次整理里两种模式并存。
 *
 * 不读 `scan.stats`：`stats.totalFolders` 把范围根自己也数了进去，
 * 而范围根是勾选点、不是整理出来的目录，混进分母会把每条比例都稀释一遍。
 */
export function detectMode(scan: ScanResult, locale: Locale): ModeDecision {
  // scanTree 只给范围根 depth === 0，其余目录都 >= 1
  const roots = scan.folders.filter((f) => f.depth === 0)
  const judged = scan.folders.filter((f) => f.depth > 0)

  if (judged.length === 0) {
    return { mode: 'rebuild', reason: reasonNoFolders(locale) }
  }

  // 编号前缀是最强也最便宜的信号，几乎必然是上一轮 TidyMark 留下的：命中就直接定性，
  // 不再看别的。反过来「没有编号」什么都不说明——手工整理得很好的库同样没有编号，
  // 只看编号会把他判成一团乱麻，而那正是危险方向（§1）
  //
  // 分母只取一级目录：TidyMark 按设计只给一级目录编号，二级目录里用户自建、
  // 本轮没收到书签的目录被刻意保持原样、不编号（见 core/plan.ts 的 participates）。
  // 把二级目录也算进分母，等于按用户手建子目录的多寡把这条最强信号成比例稀释掉。
  const numerable = judged.filter((f) => f.depth === 1)
  const numbered = numerable.filter((f) => hasNumberPrefix(f.title)).length
  if (numerable.length > 0 && numbered / numerable.length >= NUMBERED_PREFIX_RATIO) {
    return { mode: 'additive', reason: reasonNumbered(locale, numbered, numerable.length) }
  }

  // 「散在根下」= 直接挂在勾中的那个目录底下，一层都没进。样本太少时一两条散落
  // 书签就能把比例推过线，够不上「明确的乱信号」，让它放行给下一条规则
  const rootIds = new Set(roots.map((r) => r.id))
  const loose = scan.bookmarks.filter((b) => rootIds.has(b.parentId)).length
  if (
    scan.bookmarks.length >= MIN_JUDGED_BOOKMARKS &&
    loose / scan.bookmarks.length > LOOSE_BOOKMARK_RATIO
  ) {
    return { mode: 'rebuild', reason: reasonLoose(locale, loose, scan.bookmarks.length) }
  }

  const bookmarkCount = new Map<string, number>()
  for (const b of scan.bookmarks) bookmarkCount.set(b.parentId, (bookmarkCount.get(b.parentId) ?? 0) + 1)
  const hasSubfolder = new Set(scan.folders.map((f) => f.parentId))
  // 还带着子目录的不算独苗——那是导航目录，本来就不该装满书签
  const singletons = judged.filter(
    (f) => bookmarkCount.get(f.id) === 1 && !hasSubfolder.has(f.id),
  ).length
  // 目录太少时同理：一个装了一条书签的目录就能把比例推过线，够不上明确证据
  if (judged.length >= MIN_JUDGED_FOLDERS && singletons / judged.length > SINGLETON_FOLDER_RATIO) {
    return { mode: 'rebuild', reason: reasonSingletons(locale, singletons, judged.length) }
  }

  // 兜底偏向「已整理」：没抓到明确的乱信号就不推翻
  return { mode: 'additive', reason: reasonTidy(locale) }
}

function percent(part: number, total: number): number {
  return Math.round((part / total) * 100)
}

function reasonNumbered(locale: Locale, numbered: number, total: number): string {
  if (locale === 'zh_CN') return `${total} 个一级目录里有 ${numbered} 个带编号前缀，看起来是排过序的结构`
  return `${numbered} of ${total} top-level folders carry a number prefix — looks like a structure that was already ordered`
}

function reasonNoFolders(locale: Locale): string {
  if (locale === 'zh_CN') return '范围内一个目录都没有，书签全散着'
  return 'There is not a single folder in scope — every bookmark sits loose'
}

function reasonLoose(locale: Locale, loose: number, total: number): string {
  if (locale === 'zh_CN') {
    return `${total} 条书签里有 ${loose} 条（${percent(loose, total)}%）直接散在范围根下，没进任何目录`
  }
  return `${loose} of ${total} bookmarks (${percent(loose, total)}%) sit directly under the scope root, in no folder at all`
}

function reasonSingletons(locale: Locale, singletons: number, total: number): string {
  if (locale === 'zh_CN') {
    return `${total} 个目录里有 ${singletons} 个（${percent(singletons, total)}%）只装着一条书签`
  }
  return `${singletons} of ${total} folders (${percent(singletons, total)}%) hold just one bookmark`
}

function reasonTidy(locale: Locale): string {
  if (locale === 'zh_CN') return '目录数量与书签分布都看不出明显的混乱信号'
  return 'Neither the folder count nor the spread of bookmarks shows a clear sign of a mess'
}
