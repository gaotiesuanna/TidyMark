import type { BookmarkItem } from './types'
import { normalizeUrl } from './url'

export type DuplicateKind = 'exact' | 'normalized'

export interface DuplicateGroup {
  /**
   * - `exact`：组里每条的 URL 字符串一模一样。零误判，界面默认勾选待删。
   * - `normalized`：组里存在至少两种写法，是归一化把它们并到一起的。
   *   界面默认**不**勾选，摊开完整 URL 让用户自己看。
   */
  kind: DuplicateKind
  /** 归一化后的 URL，组的身份。 */
  key: string
  /** 默认保留哪条。必然等于 items[0].id。 */
  keepId: string
  /** 全部成员（含 keepId 那条），已按「该保留谁」从优到劣排好。 */
  items: BookmarkItem[]
}

/**
 * 「该保留谁」的排序：越靠前越该留。
 *
 * 1. 有标题的胜过空标题的——`ScanStats.untitledBookmarks` 说明空标题书签真实存在，
 *    留下没名字的那条等于把一条书签变成一串 URL；
 * 2. 路径浅的胜出——更可能是用户主动放好的位置，深处那条往往是随手又存了一遍；
 * 3. 同层里 index 小的胜出；
 * 4. id 兜底——前三条全平时也要给出确定的答案，否则同一批书签两次扫描的默认
 *    保留项可能不同，用户会觉得界面在乱跳。
 */
function betterKeep(a: BookmarkItem, b: BookmarkItem): number {
  const named = (item: BookmarkItem): number => (item.title.trim() === '' ? 1 : 0)
  return named(a) - named(b)
    || a.currentPath.length - b.currentPath.length
    || a.index - b.index
    || a.id.localeCompare(b.id)
}

/**
 * 把重复收藏分组。
 *
 * 分档的做法是**先按归一化后的 URL 收桶，再看桶里有几种原始写法**，而不是
 * 「先挑完全相同的、剩下的再归一化」。后者会让 `[p, p, p/]` 裂成一个 exact 组
 * `{p, p}` 和一个 normalized 组 `{p, p, p/}`——同一条书签出现在两组里，
 * 用户在一组勾了删、在另一组又选了保留，无法收敛。
 *
 * 判重不看协议、不问 `isCheckableUrl`：`chrome://extensions` 存了两遍也是重复。
 */
export function findDuplicateGroups(items: BookmarkItem[]): DuplicateGroup[] {
  const buckets = new Map<string, BookmarkItem[]>()
  for (const item of items) {
    const key = normalizeUrl(item.url)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [item])
    else bucket.push(item)
  }

  const groups: DuplicateGroup[] = []
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue
    const sorted = [...bucket].sort(betterKeep)
    const writings = new Set(bucket.map((i) => i.url))
    groups.push({
      kind: writings.size === 1 ? 'exact' : 'normalized',
      key,
      keepId: sorted[0]!.id,
      items: sorted,
    })
  }

  // 大组排前面：用户从收益最大的那组开始看。key 兜底保证顺序稳定
  return groups.sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key))
}
