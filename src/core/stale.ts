import type { HistoryVisit } from './ports'
import { normalizeUrl } from './url'
import type { BookmarkItem } from './types'

export type StaleBucket =
  | 'threeToSixMonths'
  | 'sixToTwelveMonths'
  | 'overOneYear'
  | 'unknown'

export interface StaleBookmark {
  item: BookmarkItem
  bucket: StaleBucket
  lastVisitedAt?: number
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
  visits: HistoryVisit[],
  scannedAt: number,
  scopeRootIdByBookmarkId: ReadonlyMap<string, string>,
): StaleScanResult {
  const cutoff3Months = subtractMonths(scannedAt, 3)
  const cutoff6Months = subtractMonths(scannedAt, 6)
  const cutoff12Months = subtractMonths(scannedAt, 12)

  const latestVisitByUrl = new Map<string, number | undefined>()
  for (const visit of visits) {
    const url = normalizeUrl(visit.url)
    const previous = latestVisitByUrl.get(url)
    if (visit.lastVisitTime !== undefined && (previous === undefined || visit.lastVisitTime > previous)) {
      latestVisitByUrl.set(url, visit.lastVisitTime)
    } else if (!latestVisitByUrl.has(url)) {
      latestVisitByUrl.set(url, undefined)
    }
  }

  const staleItems: StaleBookmark[] = []
  for (const item of items) {
    const lastVisitedAt = latestVisitByUrl.get(normalizeUrl(item.url))
    if (lastVisitedAt === undefined) {
      staleItems.push({ item, bucket: 'unknown' })
    } else if (lastVisitedAt <= cutoff12Months) {
      staleItems.push({ item, bucket: 'overOneYear', lastVisitedAt })
    } else if (lastVisitedAt <= cutoff6Months) {
      staleItems.push({ item, bucket: 'sixToTwelveMonths', lastVisitedAt })
    } else if (lastVisitedAt <= cutoff3Months) {
      staleItems.push({ item, bucket: 'threeToSixMonths', lastVisitedAt })
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
