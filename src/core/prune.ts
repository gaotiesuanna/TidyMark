import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import type { NewFolderSpec } from './plan'
import { FALLBACK_TITLE } from './tree'
import type { CategoryCandidate, Classification } from './types'

/**
 * 一个目录至少要装下几个书签才值得单独建立。
 *
 * 为什么是 3：两条书签摆在一个目录里，展开目录的动作比直接扫两行还费事——目录只有
 * 从第三条起才开始省浏览成本。再往上（5、8）能活下来的目录太少，整理结果会退化成
 * 一个巨大的「其他」。
 *
 * 为什么不再让用户拨：这个数字**用户无从判断**。3 还是 5 更好，取决于他这批书签的
 * 主题有多分散，而那件事只有跑完一次整理才看得出来——摆成旋钮等于把一道自己也答不出
 * 的题推给用户。目录的数量与层数已经由书签总数推导（见 core/shape.ts），下限是同一
 * 套账里的最后一格，一并由程序定。
 *
 * 曾经有过 `enforceMinFolderSize` / `minFolderSize` 两个设置项，随清单第 12 项删掉；
 * 存量存储里遗留的那两个键读都不读（见 storage/settings.ts 的旧旋钮名单），
 * 也就是说以前关掉过这个开关的用户，下次整理会吃到这道约束。变的不只是他：旧设置页
 * 允许这个数字在 2..10 之间拨，所以拧到 5、9 的人下限反而**变松**（原本剪掉的目录这次
 * 留得住），拧到 2 的人**变紧**。两个方向都有用例盯着（tests/background/handlers.test.ts
 * 里把存量键拧成 2 / 5 / 9 的那几条），只是这段散文一直只写了「关掉过」那一种。
 */
export const MIN_FOLDER_BOOKMARKS = 3

export interface PruneInput {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: Classification[]
  /** 目录至少要装下几个书签。1 或更小表示用户关掉了这项约束。 */
  minFolderSize: number
  locale: Locale
  /** 合并模式下容器目录的临时 id。它是容器不是分类，收不到书签是正常的。 */
  mergeRootTemporaryId?: string | null
}

export interface PruneResult {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  classifications: Classification[]
  /** 被撤掉的目录名（带编号），供日志与排查。 */
  prunedTitles: string[]
  /**
   * 最后落进「其他」或无处可去的书签。
   *
   * 被父目录接住的那批**不在**这里：那是结构上说得通的去处。只有掉进兜底目录的
   * 才值得再问一次模型（见 issues/05-homeless-bookmarks.md「决定 1」）。
   */
  pending: PendingPlacement[]
  /** 「其他」这个兜底目录的 id；不存在时为 null。调用方据此把它剔出二次判定的候选表。 */
  fallbackId: string | null
}

/** 一条需要重新定去处的书签，连同它最后待过的那个目录的信息——够拼出改判理由。 */
export interface PendingPlacement {
  bookmarkId: string
  /** 最后待过的那个目录名，已剥掉编号。 */
  fromTitle: string
  /** 那个目录当时装下的书签数。 */
  count: number
}

/** 改判后的理由会原样显示在结果页，必须双语，且讲的是「为什么不在原来那个目录」。 */
export function pruneReason(
  locale: Locale,
  title: string,
  count: number,
  minFolderSize: number,
  targetTitle: string | null,
): string {
  if (locale === 'zh_CN') {
    const head = `「${title}」只装下 ${count} 个书签，不足 ${minFolderSize} 个`
    return targetTitle === null ? `${head}，不再建这个目录` : `${head}，已并入「${targetTitle}」`
  }
  const head = `"${title}" holds only ${count} of the required ${minFolderSize} bookmarks`
  return targetTitle === null ? `${head}, so it is not created` : `${head}, so it was merged into "${targetTitle}"`
}

/**
 * 撤掉分类之后仍然装不满的新目录，把里面的书签上提一层。
 *
 * 这是目录下限的最后一道：提示词（llm/prompts.ts）和建树（core/tree.ts）都只能按
 * 标签数预估，而书签最终落在哪个目录是分类阶段定的——模型完全可以把一个五条标签的
 * 主题拆着送去别处，留下一个只剩一条的目录。只有数过真实归属才知道结果长什么样。
 *
 * 三条不撤的规矩：
 * - 用户已有的目录不撤。里面只有一个书签是他自己的安排，整理不该顺手拆了它。
 * - 合并模式的容器目录不撤。它是容器不是分类。
 * - 还有存活子目录的父目录不撤，否则那些子目录没有父目录可挂。
 *
 * 还有一处看着矛盾、其实是对的：**建树时无条件放行「其他」，prune 这里却会撤它**。
 * 两处知道的信息不同——建树时它还没收到任何书签，拿标签数去判它毫无意义；
 * prune 时它的真实容量已知，装不满就不值得建。撤掉它之后没有下一站，
 * 里面的书签在这一步退回原位，而这正好与非推翻模式的「放不进就原地不动」是同一个行为
 * （见 issues/05-homeless-bookmarks.md「决定 4」）。推翻模式下调用方（handlers.ts 的
 * 二次判定）还会再问一次模型，把这批书签送去存活目录里更合适的地方；那之后模型仍然
 * 说没有合适去处的，才真的原地不动——本文件这段注释描述的只是 prune 自己这一步。
 *
 * 顺序也是语义的一部分：深的先判，父目录要等子目录并进来之后才知道自己够不够；
 * 同深度时「其他」最后判，它是所有撤销的去处，先判它就会在书签并进来之前被误撤。
 */
export function pruneSmallFolders(input: PruneInput): PruneResult {
  const { minFolderSize, locale } = input
  if (minFolderSize <= 1) {
    return {
      candidates: input.candidates,
      newFolders: input.newFolders,
      classifications: input.classifications,
      prunedTitles: [],
      pending: [],
      fallbackId: null,
    }
  }

  const specById = new Map(input.newFolders.map((f) => [f.temporaryId, f]))
  const candidateById = new Map(input.candidates.map((c) => [c.id, c]))
  const fallbackKey = normalizeName(FALLBACK_TITLE[locale])
  const isFallback = (c: CategoryCandidate): boolean =>
    c.path.length === 1 && normalizeName(stripNumberPrefix(c.path[0]!)) === fallbackKey
  const fallback = input.candidates.find(isFallback) ?? null

  const prunable = input.candidates.filter(
    (c) => specById.has(c.id) && c.id !== input.mergeRootTemporaryId,
  )
  const order = [...prunable].sort(
    (a, b) => b.path.length - a.path.length || Number(isFallback(a)) - Number(isFallback(b)),
  )

  /** 新目录挂在谁下面。挂在范围根这类非候选目录下时，上提就没有下一站了。 */
  const parentIdOf = (id: string): string | null => {
    const spec = specById.get(id)
    if (spec === undefined) return null
    return spec.parentTemporaryId ?? spec.parentId
  }

  const classifications = input.classifications.map((c) => ({ ...c }))
  const removed = new Set<string>()
  const prunedTitles: string[] = []
  const pending = new Map<string, PendingPlacement>()

  for (const folder of order) {
    const hasLiveChild = input.newFolders.some(
      (f) => f.temporaryId !== folder.id
        && !removed.has(f.temporaryId)
        && (f.parentTemporaryId ?? f.parentId) === folder.id,
    )
    if (hasLiveChild) continue

    const mine = classifications.filter((c) => c.targetCategoryId === folder.id)
    if (mine.length >= minFolderSize) continue

    const parentId = parentIdOf(folder.id)
    const parent = parentId === null || removed.has(parentId)
      ? null
      : candidateById.get(parentId) ?? null
    // 父目录没了就退到「其他」；正在撤的就是「其他」自己时没有下一站，书签保持原位
    const target = parent
      ?? (fallback !== null && fallback.id !== folder.id && !removed.has(fallback.id) ? fallback : null)

    removed.add(folder.id)
    prunedTitles.push(specById.get(folder.id)!.title)

    // 编号是建树阶段的内部产物，讲给用户听时不必带上
    const title = stripNumberPrefix(folder.path.at(-1) ?? '')
    const targetTitle = target === null ? null : stripNumberPrefix(target.path.at(-1) ?? '')
    for (const classification of mine) {
      classification.targetCategoryId = target?.id ?? null
      classification.reason = pruneReason(locale, title, mine.length, minFolderSize, targetTitle)
      // 掉进兜底目录或彻底没有下一站的，交给调用方再问一次模型。
      // 被父目录接住的不记——那是结构上说得通的去处，不必花一次调用。
      // 同一条书签可能被撤两次（子目录 → 父目录 → 「其他」），后写的覆盖先写的：
      // 这条对**路由**是对的（判断是否最终落进兜底只能看最后一跳）。
      // 但正在撤的如果是「其他」自己，覆盖就错了——它是这批书签的第二跳，
      // 用户从没见过「其他」（它最终也不会被建出来），名单里已经记着的那个
      // fromTitle 才是他认识、后面改判理由要点名的目录，不能被「其他」盖掉。
      // 只有这一轮里第一次进名单的书签（模型当初就直接选了「其他」，没有
      // 更早的第一跳）才用「其他」当来历。
      if (target === null || target.id === fallback?.id) {
        const isFallbackItself = folder.id === fallback?.id
        if (!(isFallbackItself && pending.has(classification.bookmarkId))) {
          pending.set(classification.bookmarkId, {
            bookmarkId: classification.bookmarkId, fromTitle: title, count: mine.length,
          })
        }
      }
    }
  }

  return {
    candidates: input.candidates.filter((c) => !removed.has(c.id)),
    newFolders: input.newFolders.filter((f) => !removed.has(f.temporaryId)),
    classifications,
    prunedTitles,
    pending: [...pending.values()],
    fallbackId: fallback?.id ?? null,
  }
}
