import type { RuleResult } from './rules'
import type { BookmarkItem, CategoryCandidate, Classification, FolderItem } from './types'

/** 归一化目录名，用于同义判定：忽略大小写、空白、下划线、连字符。 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-]+/g, '')
}

/**
 * 去掉「01 」「01.2 」这类编号前缀。
 * 匹配和展示都用去掉编号后的名字，再次整理时编号才不会层层叠加。
 */
export function stripNumberPrefix(title: string): string {
  const stripped = title.replace(/^\d{1,3}(?:\.\d{1,3})*[\s.、_-]+/, '').trim()
  return stripped === '' ? title : stripped
}

/**
 * 目录路径的归一化 key：每一段都剥掉编号前缀再归一化，拼起来。
 *
 * scan.ts 数重名目录、buildCandidatesFromFolders 去重候选，两处都要用同一把尺子——
 * 否则日志报出的组数会跟实际折叠掉的候选数对不上。
 */
export function folderPathKey(path: string[], title: string): string {
  return [...path, title].map((segment) => normalizeName(stripNumberPrefix(segment))).join('/')
}

export function buildCandidatesFromFolders(
  folders: FolderItem[],
  scopeRootIds: string[],
): CategoryCandidate[] {
  const rootSet = new Set(scopeRootIds)
  const seen = new Set<string>()
  const candidates: CategoryCandidate[] = []

  for (const folder of folders) {
    if (rootSet.has(folder.id)) continue
    const path = [...folder.path, folder.title]
    // 模型看到的候选是**路径**不是 id（llm/classify.ts 渲染成 `- id=… 目录=A / B`）。
    // 同父同名的两个目录对它就是同一行，发两遍只会让它随机挑一个，于是同类书签
    // 被分散进几个重名目录（见 issues/23-duplicate-sibling-folders.md）。
    // 剥编号是有意的：「01 前端」和「02 前端」对用户就是重名，编号是我们自己加的。
    // 留树序第一个，与 core/tree.ts 里 existingByParent 的「首个胜出」同源——
    // 两处规则必须一致，否则「推翻模式复用哪个」与「归入现有留哪个候选」会指向不同目录。
    const key = folderPathKey(folder.path, folder.title)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ id: folder.id, path })
  }

  return candidates
}

/**
 * 当规则给出的 tag 与某个候选目录的叶子名归一化后相等时，直接确定归属，
 * 无需调用模型。tags 按从后往前匹配——越靠后的 tag 越具体。
 */
export function resolveByRules(
  item: BookmarkItem,
  rule: RuleResult,
  candidates: CategoryCandidate[],
): Classification | null {
  for (let i = rule.tags.length - 1; i >= 0; i--) {
    const tag = normalizeName(rule.tags[i]!)
    // 候选目录名可能带「01.2 」这样的编号前缀，比较时先去掉
    const hit = candidates.find(
      (c) => normalizeName(stripNumberPrefix(c.path[c.path.length - 1]!)) === tag,
    )
    if (hit) {
      return {
        bookmarkId: item.id,
        targetCategoryId: hit.id,
        confidence: 1,
        reason: rule.reason,
        source: 'rule',
      }
    }
  }
  return null
}
