import type { BookmarkItem } from './types'

export type StaleBucket =
  | 'threeToSixMonths'
  | 'sixToTwelveMonths'
  | 'oneToTwoYears'
  | 'overTwoYears'
  | 'unknown'

const AGE_RANK: Record<Exclude<StaleBucket, 'unknown'>, number> = {
  threeToSixMonths: 0,
  sixToTwelveMonths: 1,
  oneToTwoYears: 2,
  overTwoYears: 3,
}

/** 时间筛选只包含有明确上次打开时间的书签；unknown 不能推断为超过任意时长。 */
export function matchesStaleFilter(bucket: StaleBucket, filter: 'all' | StaleBucket): boolean {
  if (filter === 'all') return true
  if (filter === 'unknown') return bucket === 'unknown'
  if (bucket === 'unknown') return false
  return AGE_RANK[bucket] >= AGE_RANK[filter]
}

export interface StaleBookmark {
  item: BookmarkItem
  bucket: StaleBucket
  lastUsedAt?: number
}

export interface StaleFolderNode {
  /** currentPath 拼成的稳定键，也是展开状态的标识 */
  key: string
  title: string
  path: string[]
  /** 这个文件夹里 + 所有子孙里的闲置书签总数。 */
  count: number
  /** 直接躺在这个文件夹里的闲置书签（不含子孙）。 */
  items: StaleBookmark[]
  children: StaleFolderNode[]
}

interface MutableFolder {
  key: string
  title: string
  path: string[]
  items: StaleBookmark[]
  children: Map<string, MutableFolder>
}

/**
 * 按 currentPath 搭成文件夹树。共享祖先只出现一次，count 含子孙。
 * 空标题（Chrome 无名根）不占一层。每层按 count 降序、同数按标题稳定。
 * 过道文件夹不折叠——清理页要看见层级，不能再缩成一条路径。
 */
export function staleFolderTree(items: readonly StaleBookmark[]): StaleFolderNode[] {
  const root: MutableFolder = { key: '', title: '', path: [], items: [], children: new Map() }

  for (const entry of items) {
    const path = entry.item.currentPath.filter((segment) => segment !== '')
    let node = root
    for (let i = 0; i < path.length; i++) {
      const title = path[i]!
      const childPath = path.slice(0, i + 1)
      const key = childPath.join('/')
      let child = node.children.get(title)
      if (child === undefined) {
        child = { key, title, path: childPath, items: [], children: new Map() }
        node.children.set(title, child)
      }
      node = child
    }
    node.items.push(entry)
  }

  function freeze(node: MutableFolder): StaleFolderNode {
    const children = [...node.children.values()].map(freeze).sort(
      (a, b) => b.count - a.count || a.title.localeCompare(b.title),
    )
    return {
      key: node.key,
      title: node.title,
      path: node.path,
      items: node.items,
      children,
      count: node.items.length + children.reduce((n, child) => n + child.count, 0),
    }
  }

  return freeze(root).children
}

export interface StaleScanResult {
  items: StaleBookmark[]
  scannedAt: number
  cutoff3Months: number
  cutoff6Months: number
  cutoff12Months: number
  cutoff24Months: number
  scopeRootIdByBookmarkId: Record<string, string>
}

function subtractMonths(timestamp: number, count: number): number {
  const date = new Date(timestamp)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() - count)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return date.getTime()
}

export function classifyStaleBookmarks(
  items: BookmarkItem[],
  scannedAt: number,
  scopeRootIdByBookmarkId: ReadonlyMap<string, string>,
): StaleScanResult {
  const cutoff3Months = subtractMonths(scannedAt, 3)
  const cutoff6Months = subtractMonths(scannedAt, 6)
  const cutoff12Months = subtractMonths(scannedAt, 12)
  const cutoff24Months = subtractMonths(scannedAt, 24)

  const staleItems: StaleBookmark[] = []
  for (const item of items) {
    const lastUsedAt = item.dateLastUsed
    if (lastUsedAt === undefined) {
      staleItems.push({ item, bucket: 'unknown' })
    } else if (lastUsedAt <= cutoff24Months) {
      staleItems.push({ item, bucket: 'overTwoYears', lastUsedAt })
    } else if (lastUsedAt <= cutoff12Months) {
      staleItems.push({ item, bucket: 'oneToTwoYears', lastUsedAt })
    } else if (lastUsedAt <= cutoff6Months) {
      staleItems.push({ item, bucket: 'sixToTwelveMonths', lastUsedAt })
    } else if (lastUsedAt <= cutoff3Months) {
      staleItems.push({ item, bucket: 'threeToSixMonths', lastUsedAt })
    }
  }

  return {
    items: staleItems,
    scannedAt,
    cutoff3Months,
    cutoff6Months,
    cutoff12Months,
    cutoff24Months,
    scopeRootIdByBookmarkId: Object.fromEntries(scopeRootIdByBookmarkId),
  }
}
