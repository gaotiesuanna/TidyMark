import type { RuleResult } from './rules'
import type { BookmarkItem, CategoryCandidate, Classification, FolderItem } from './types'

/** 归一化目录名，用于同义判定：忽略大小写、空白、下划线、连字符。 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-]+/g, '')
}

export function buildCandidatesFromFolders(
  folders: FolderItem[],
  scopeRootIds: string[],
): CategoryCandidate[] {
  const rootSet = new Set(scopeRootIds)
  return folders
    .filter((f) => !rootSet.has(f.id))
    .map((f) => ({ id: f.id, path: [...f.path, f.title] }))
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
    const hit = candidates.find((c) => normalizeName(c.path[c.path.length - 1]!) === tag)
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
