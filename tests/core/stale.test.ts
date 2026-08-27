import { describe, expect, it } from 'vitest'
import { classifyStaleBookmarks, matchesStaleFilter, type StaleBucket } from '@/core/stale'
import type { BookmarkItem } from '@/core/types'

const scanDate = new Date(2026, 7, 26, 12).getTime()

const item = (id: string, dateLastUsed?: number): BookmarkItem => ({
  id,
  url: `https://${id}.test`,
  title: id,
  parentId: 'root',
  index: 0,
  currentPath: ['root'],
  dateLastUsed,
})

function bucketAt(lastUsedAt: Date): StaleBucket | undefined {
  return classifyStaleBookmarks(
    [item('bookmark', lastUsedAt.getTime())],
    scanDate,
    new Map([['bookmark', 'root']]),
  ).items[0]?.bucket
}

it('assigns exact natural-month boundaries to their older buckets', () => {
  expect(bucketAt(new Date(2026, 4, 26, 12))).toBe('threeToSixMonths')
  expect(bucketAt(new Date(2026, 1, 26, 12))).toBe('sixToTwelveMonths')
  expect(bucketAt(new Date(2025, 7, 26, 12))).toBe('overOneYear')
})

describe('matchesStaleFilter', () => {
  it('uses cumulative age filters without treating unknown as an age', () => {
    expect(matchesStaleFilter('threeToSixMonths', 'threeToSixMonths')).toBe(true)
    expect(matchesStaleFilter('sixToTwelveMonths', 'threeToSixMonths')).toBe(true)
    expect(matchesStaleFilter('overOneYear', 'threeToSixMonths')).toBe(true)
    expect(matchesStaleFilter('unknown', 'threeToSixMonths')).toBe(false)
  })

  it('keeps unknown records in their dedicated filter', () => {
    expect(matchesStaleFilter('unknown', 'all')).toBe(true)
    expect(matchesStaleFilter('unknown', 'unknown')).toBe(true)
    expect(matchesStaleFilter('overOneYear', 'unknown')).toBe(false)
  })
})

describe('classifyStaleBookmarks', () => {
  it('classifies from each bookmark node dateLastUsed even when URLs are identical', () => {
    const old = { ...item('old', new Date(2025, 0, 1).getTime()), url: 'https://same.test' }
    const recent = { ...item('recent', new Date(2026, 7, 1).getTime()), url: 'https://same.test' }

    const result = classifyStaleBookmarks([old, recent], scanDate, new Map())

    expect(result.items.map(({ item: bookmark, bucket, lastUsedAt }) => (
      [bookmark.id, bucket, lastUsedAt]
    ))).toEqual([
      ['old', 'overOneYear', new Date(2025, 0, 1).getTime()],
    ])
  })

  it('uses mutually exclusive natural-month buckets and omits recent bookmarks', () => {
    const result = classifyStaleBookmarks(
      [
        item('three-to-six', new Date(2026, 4, 26, 12).getTime()),
        item('six-to-twelve', new Date(2026, 1, 26, 12).getTime()),
        item('over-year', new Date(2025, 7, 26, 12).getTime()),
        item('recent', new Date(2026, 4, 27, 12).getTime()),
      ],
      scanDate,
      new Map(),
    )

    expect(result.cutoff3Months).toBe(new Date(2026, 4, 26, 12).getTime())
    expect(result.cutoff6Months).toBe(new Date(2026, 1, 26, 12).getTime())
    expect(result.cutoff12Months).toBe(new Date(2025, 7, 26, 12).getTime())
    expect(result.items.map(({ item: bookmark, bucket }) => [bookmark.id, bucket])).toEqual([
      ['three-to-six', 'threeToSixMonths'],
      ['six-to-twelve', 'sixToTwelveMonths'],
      ['over-year', 'overOneYear'],
    ])
  })

  it('clamps month-end cutoffs to the last valid day of the target month', () => {
    const endOfMay = new Date(2026, 4, 31, 12).getTime()
    const result = classifyStaleBookmarks(
      [item('february', new Date(2026, 1, 28, 12).getTime())],
      endOfMay,
      new Map(),
    )

    expect(result.cutoff3Months).toBe(new Date(2026, 1, 28, 12).getTime())
    expect(result.items[0]?.bucket).toBe('threeToSixMonths')
  })

  it('sends a missing dateLastUsed to unknown without using dateAdded as a fallback', () => {
    const bookmark = { ...item('unknown'), dateAdded: new Date(2020, 0, 1).getTime() }

    const result = classifyStaleBookmarks([bookmark], scanDate, new Map())

    expect(result.items).toEqual([{ item: bookmark, bucket: 'unknown' }])
  })

  it('does not mutate input objects and copies scope-root metadata', () => {
    const bookmarks = [item('example', new Date(2025, 0, 1).getTime())]
    const scopeRootIdByBookmarkId = new Map([['example', 'scope-root']])
    const bookmarksBefore = structuredClone(bookmarks)

    const result = classifyStaleBookmarks(bookmarks, scanDate, scopeRootIdByBookmarkId)

    expect(bookmarks).toEqual(bookmarksBefore)
    expect(result.items[0]?.item).toBe(bookmarks[0])
    expect(result.scopeRootIdByBookmarkId).toEqual({ example: 'scope-root' })
    expect(scopeRootIdByBookmarkId).toEqual(new Map([['example', 'scope-root']]))
  })
})
