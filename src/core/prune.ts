import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import type { NewFolderSpec } from './plan'
import { FALLBACK_TITLE } from './tree'
import type { CategoryCandidate, Classification } from './types'

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
 * 四条不撤的规矩：
 * - 用户已有的目录不撤。里面只有一个书签是他自己的安排，整理不该顺手拆了它。
 * - 合并模式的容器目录不撤。它是容器不是分类。
 * - 聚合组的目录不撤。core/tree.ts 建树时就放行了它们——用户勾了那个组就是明确要
 *   这个结构，这里再撤等于两层规矩打架，勾了 GitHub 聚合却看不到 GitHub 目录。
 * - 还有存活子目录的父目录不撤，否则那些子目录没有父目录可挂。
 *
 * 还有一处看着矛盾、其实是对的：**建树时无条件放行「其他」，prune 这里却会撤它**。
 * 两处知道的信息不同——建树时它还没收到任何书签，拿标签数去判它毫无意义；
 * prune 时它的真实容量已知，装不满就不值得建。撤掉它之后没有下一站，
 * 里面的书签退回原位，而这正好与非推翻模式的「放不进就原地不动」是同一个行为
 * （见 issues/05-homeless-bookmarks.md「决定 4」）。
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

  // domainGroup 标记盖住整个聚合组子树（见 core/tree.ts 的 mark），组根和组内子目录
  // 一并豁免。子目录本来也撤不掉——建树已按标签数筛过，分类阶段只会往里加不会往外拿
  const prunable = input.candidates.filter(
    (c) => specById.has(c.id)
      && c.id !== input.mergeRootTemporaryId
      && c.domainGroup === undefined,
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
      // 理由要讲的是它**最后**待过的那个目录
      if (target === null || target.id === fallback?.id) {
        pending.set(classification.bookmarkId, {
          bookmarkId: classification.bookmarkId, fromTitle: title, count: mine.length,
        })
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
