import type { BookmarkItem } from './types'

export type StaleBucket =
  | 'threeToSixMonths'
  | 'sixToTwelveMonths'
  | 'overOneYear'
  | 'unknown'

const AGE_RANK: Record<Exclude<StaleBucket, 'unknown'>, number> = {
  threeToSixMonths: 0,
  sixToTwelveMonths: 1,
  overOneYear: 2,
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

export interface StaleScanResult {
  items: StaleBookmark[]
  scannedAt: number
  cutoff3Months: number
  cutoff6Months: number
  cutoff12Months: number
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

  const staleItems: StaleBookmark[] = []
  for (const item of items) {
    const lastUsedAt = item.dateLastUsed
    if (lastUsedAt === undefined) {
      staleItems.push({ item, bucket: 'unknown' })
    } else if (lastUsedAt <= cutoff12Months) {
      staleItems.push({ item, bucket: 'overOneYear', lastUsedAt })
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
    scopeRootIdByBookmarkId: Object.fromEntries(scopeRootIdByBookmarkId),
  }
}
