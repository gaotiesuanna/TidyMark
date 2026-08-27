import { describe, expect, it } from 'vitest'
import { classifyStaleBookmarks, type StaleBucket } from '@/core/stale'
import type { HistoryVisit } from '@/core/ports'
import type { BookmarkItem } from '@/core/types'

const scanDate = new Date(2026, 7, 26, 12).getTime()

const item = (id: string, url: string): BookmarkItem => ({
  id,
  url,
  title: id,
  parentId: 'root',
  index: 0,
  currentPath: ['root'],
})
function bucketAt(lastVisitedAt: Date): StaleBucket | undefined {
  const result = classifyStaleBookmarks(
    [item('bookmark', 'https://example.test')],
    [{ url: 'https://example.test', lastVisitTime: lastVisitedAt.getTime() }],
    scanDate,
    new Map([['bookmark', 'root']]),
  )
  return result.items[0]?.bucket
}

it('assigns exact natural-month boundaries to their older buckets', () => {
  expect(bucketAt(new Date(2026, 4, 26, 12))).toBe('threeToSixMonths')
  expect(bucketAt(new Date(2026, 1, 26, 12))).toBe('sixToTwelveMonths')
  expect(bucketAt(new Date(2025, 7, 26, 12))).toBe('overOneYear')
})


describe('classifyStaleBookmarks', () => {
  it('uses mutually exclusive natural-month buckets', () => {
    const result = classifyStaleBookmarks(
      [
        item('three-to-six', 'https://three.test'),
        item('six-to-twelve', 'https://six.test'),
        item('over-year', 'https://year.test'),
      ],
      [
        { url: 'https://three.test', lastVisitTime: new Date(2026, 4, 26, 12).getTime() },
        { url: 'https://six.test', lastVisitTime: new Date(2026, 1, 26, 12).getTime() },
        { url: 'https://year.test', lastVisitTime: new Date(2025, 7, 26, 12).getTime() },
      ],
      scanDate,
      new Map([
        ['three-to-six', 'root'],
        ['six-to-twelve', 'root'],
        ['over-year', 'root'],
      ]),
    )

    expect(result.items.map(({ item: bookmark, bucket }) => [bookmark.id, bucket])).toEqual([
      ['three-to-six', 'threeToSixMonths'],
      ['six-to-twelve', 'sixToTwelveMonths'],
      ['over-year', 'overOneYear'],
    ])
  })

  it('includes the three-month cutoff and assigns exact older cutoffs to older buckets', () => {
    const bookmarks = [
      item('exact-three', 'https://exact-three.test'),
      item('exact-six', 'https://exact-six.test'),
      item('exact-twelve', 'https://exact-twelve.test'),
      item('recent', 'https://recent.test'),
    ]
    const result = classifyStaleBookmarks(
      bookmarks,
      [
        { url: 'https://exact-three.test', lastVisitTime: new Date(2026, 4, 26, 12).getTime() },
        { url: 'https://exact-six.test', lastVisitTime: new Date(2026, 1, 26, 12).getTime() },
        { url: 'https://exact-twelve.test', lastVisitTime: new Date(2025, 7, 26, 12).getTime() },
        { url: 'https://recent.test', lastVisitTime: new Date(2026, 4, 27, 12).getTime() },
      ],
      scanDate,
      new Map(),
    )

    expect(result.cutoff3Months).toBe(new Date(2026, 4, 26, 12).getTime())
    expect(result.cutoff6Months).toBe(new Date(2026, 1, 26, 12).getTime())
    expect(result.cutoff12Months).toBe(new Date(2025, 7, 26, 12).getTime())
    expect(result.items.map(({ item: bookmark, bucket }) => [bookmark.id, bucket])).toEqual([
      ['exact-three', 'threeToSixMonths'],
      ['exact-six', 'sixToTwelveMonths'],
      ['exact-twelve', 'overOneYear'],
    ])
  })

  it('clamps month-end cutoffs to the last valid day of the target month', () => {
    const endOfMay = new Date(2026, 4, 31, 12).getTime()
    const result = classifyStaleBookmarks(
      [item('february', 'https://february.test')],
      [{ url: 'https://february.test', lastVisitTime: new Date(2026, 1, 28, 12).getTime() }],
      endOfMay,
      new Map(),
    )

    expect(result.cutoff3Months).toBe(new Date(2026, 1, 28, 12).getTime())
    expect(result.items[0]?.bucket).toBe('threeToSixMonths')
  })

  it('takes the newest normalized visit and preserves meaningful query parameters', () => {
    const bookmarks = [
      item('example', 'https://example.test/page/'),
      item('meaningful-query', 'https://example.test/page?id=7'),
    ]
    const visits: HistoryVisit[] = [
      { url: 'https://example.test/page/?utm_source=x', lastVisitTime: new Date(2025, 0, 1).getTime() },
      { url: 'https://example.test/page', lastVisitTime: new Date(2026, 3, 1).getTime() },
      { url: 'https://example.test/page?id=8', lastVisitTime: new Date(2025, 0, 1).getTime() },
    ]
    const result = classifyStaleBookmarks(bookmarks, visits, scanDate, new Map())

    expect(result.items.find(({ item: bookmark }) => bookmark.id === 'example')?.lastVisitedAt)
      .toBe(new Date(2026, 3, 1).getTime())
    expect(result.items.find(({ item: bookmark }) => bookmark.id === 'meaningful-query')?.bucket)
      .toBe('unknown')
  })

  it('sends missing and undefined history to unknown', () => {
    const bookmarks = [item('never', 'https://never.test'), item('undefined', 'https://undefined.test')]
    const result = classifyStaleBookmarks(
      bookmarks,
      [{ url: 'https://undefined.test' }],
      scanDate,
      new Map(),
    )

    expect(result.items).toHaveLength(2)
    expect(result.items.every(({ bucket }) => bucket === 'unknown')).toBe(true)
    expect(result.items.every(({ lastVisitedAt }) => lastVisitedAt === undefined)).toBe(true)
  })

  it('does not mutate input objects and copies scope-root metadata', () => {
    const bookmarks = [item('example', 'https://example.test')]
    const visits: HistoryVisit[] = [{ url: 'https://example.test', lastVisitTime: new Date(2025, 0, 1).getTime() }]
    const scopeRootIdByBookmarkId = new Map([['example', 'scope-root']])
    const bookmarksBefore = structuredClone(bookmarks)
    const visitsBefore = structuredClone(visits)

    const result = classifyStaleBookmarks(bookmarks, visits, scanDate, scopeRootIdByBookmarkId)

    expect(bookmarks).toEqual(bookmarksBefore)
    expect(visits).toEqual(visitsBefore)
    expect(result.items[0]?.item).toBe(bookmarks[0])
    expect(result.scopeRootIdByBookmarkId).toEqual({ example: 'scope-root' })
    expect(scopeRootIdByBookmarkId).toEqual(new Map([['example', 'scope-root']]))
  })
})
