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
 * 目录的归一化 key：按「父目录 id + 剥编号前缀再归一化的自身名字」判是否同名，不看路径。
 *
 * 与 core/tree.ts 的 lookupKey 同一把尺子——两处都是「同一个真父目录下同名」才算重名。
 * 不按路径判，是因为路径靠不住：勾了两个同名范围根时（例如 `书签栏/工作/前端` 与
 * `其他书签/工作/前端`），两个真父目录本不相同的子树会因为「相对各自范围根的路径」
 * 凑巧一样而被错误合并成一条候选——这正是「不同父目录下的同名目录一个都不能被折叠」
 * 这条硬约束的反例。就算只有一个范围根，目录名本身允许出现 `/`，拼路径字符串还会把
 * `AI/ML`（一个目录）与 `AI` 下的 `ML`（两级目录）撞成同一个 key
 * （llm/classify.ts:36 的 pathKey 早就为这个坑改用了 \u0000 分隔，不用 `/`）。
 * 按 parentId 判，这两类误伤都不存在。
 *
 * scan.ts 数重名目录、buildCandidatesFromFolders 去重候选，两处都要用同一个函数——
 * 这个数字要直接进日志，口径必须和实际折叠掉的候选数同源，不然日志会报一个跟结果
 * 对不上的数字。
 */
export function folderKey(folder: { parentId: string | null; title: string }): string {
  return JSON.stringify([folder.parentId ?? '', normalizeName(stripNumberPrefix(folder.title))])
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
    // 去重不是只挡住新书签往重复目录里去：躺在被折叠掉的那个目录里的存量书签，
    // 下一轮分析也只会分类到幸存的这个，配合默认开启的 removeEmptyFolders，
    // 被抽空的重复目录会被真的删掉。全过程在复核页可预览、可拒绝、可撤销，
    // 不是悄悄合并。
    const key = folderKey(folder)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ id: folder.id, path })
  }

  return candidates
}

/**
 * 当规则给出的名字与某个候选目录的叶子名归一化后相等时，直接确定归属，
 * 无需调用模型。从后往前匹配——越靠后越具体。
 *
 * 认的是 `rule.placement` 而不是 `rule.tags`：托管平台名（GitHub / GitLab /
 * Notion / StackOverflow）在 tags 里、不在 placement 里。它们说的是「托管在哪」，
 * 不是「这是什么」，不该以 confidence 1 决定一条书签的去处（见 core/rules.ts
 * 的 placement 注释）。
 */
export function resolveByRules(
  item: BookmarkItem,
  rule: RuleResult,
  candidates: CategoryCandidate[],
): Classification | null {
  for (let i = rule.placement.length - 1; i >= 0; i--) {
    const tag = normalizeName(rule.placement[i]!)
    // 候选目录名可能带「01.2 」这样的编号前缀，比较时先去掉
    const matches = candidates.filter(
      (c) => normalizeName(stripNumberPrefix(c.path[c.path.length - 1]!)) === tag,
    )
    if (matches.length > 1) return null
    const hit = matches[0]
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
