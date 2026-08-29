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

export interface StaleFolderGroup {
  /** currentPath 拼成的稳定键，也是展开状态的标识 */
  key: string
  path: string[]
  items: StaleBookmark[]
}

/**
 * 按所在文件夹归堆：同一目录下的一批闲置书签只写一次路径，省掉逐行重复。
 * 条数多的排前面（triage 先看大头），条数相同按路径字典序，保证顺序稳定。
 */
export function groupStaleByFolder(items: readonly StaleBookmark[]): StaleFolderGroup[] {
  const groups = new Map<string, StaleFolderGroup>()
  for (const entry of items) {
    const key = entry.item.currentPath.join('/')
    let group = groups.get(key)
    if (group === undefined) {
      group = { key, path: entry.item.currentPath, items: [] }
      groups.set(key, group)
    }
    group.items.push(entry)
  }
  return [...groups.values()].sort(
    (a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key),
  )
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
