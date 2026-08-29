import { describe, expect, it } from 'vitest'
import { classifyStaleBookmarks, matchesStaleFilter, staleFolderTree, type StaleBucket, type StaleBookmark } from '@/core/stale'
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
  expect(bucketAt(new Date(2025, 7, 26, 12))).toBe('oneToTwoYears')
  expect(bucketAt(new Date(2024, 7, 26, 12))).toBe('overTwoYears')
})

describe('matchesStaleFilter', () => {
  it('uses cumulative age filters without treating unknown as an age', () => {
    expect(matchesStaleFilter('threeToSixMonths', 'threeToSixMonths')).toBe(true)
    expect(matchesStaleFilter('sixToTwelveMonths', 'threeToSixMonths')).toBe(true)
    expect(matchesStaleFilter('oneToTwoYears', 'threeToSixMonths')).toBe(true)
    expect(matchesStaleFilter('overTwoYears', 'threeToSixMonths')).toBe(true)
    expect(matchesStaleFilter('unknown', 'threeToSixMonths')).toBe(false)
  })

  it('keeps one-year and two-year cumulative filters distinct', () => {
    expect(matchesStaleFilter('oneToTwoYears', 'oneToTwoYears')).toBe(true)
    expect(matchesStaleFilter('overTwoYears', 'oneToTwoYears')).toBe(true)
    expect(matchesStaleFilter('oneToTwoYears', 'overTwoYears')).toBe(false)
    expect(matchesStaleFilter('overTwoYears', 'overTwoYears')).toBe(true)
  })

  it('keeps unknown records in their dedicated filter', () => {
    expect(matchesStaleFilter('unknown', 'all')).toBe(true)
    expect(matchesStaleFilter('unknown', 'unknown')).toBe(true)
    expect(matchesStaleFilter('overTwoYears', 'unknown')).toBe(false)
  })
})

describe('staleFolderTree', () => {
  const staleAt = (id: string, path: string[]): StaleBookmark => ({
    item: { ...item(id, new Date(2025, 0, 1).getTime()), currentPath: path },
    bucket: 'oneToTwoYears',
    lastUsedAt: new Date(2025, 0, 1).getTime(),
  })

  it('nests shared ancestors and counts the whole subtree', () => {
    const tree = staleFolderTree([
      staleAt('a', ['书签栏', '甲']),
      staleAt('b', ['书签栏', '乙']),
      staleAt('c', ['书签栏', '甲']),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.title).toBe('书签栏')
    expect(tree[0]?.count).toBe(3)
    expect(tree[0]?.items).toEqual([])
    expect(tree[0]?.children.map((node) => [node.title, node.count, node.key])).toEqual([
      ['甲', 2, '书签栏/甲'],
      ['乙', 1, '书签栏/乙'],
    ])
    expect(tree[0]?.children[0]?.path).toEqual(['书签栏', '甲'])
  })

  it('orders siblings by subtree size then title', () => {
    const tree = staleFolderTree([
      staleAt('a', ['b']),
      staleAt('b', ['a']),
      staleAt('c', ['c']),
    ])
    expect(tree.map((node) => node.title)).toEqual(['a', 'b', 'c'])
  })

  it('keeps hallway folders as separate levels instead of one path string', () => {
    const tree = staleFolderTree([
      staleAt('x', ['Bookmarks Bar', 'LLMStudy', '10 其他']),
    ])
    expect(tree[0]?.title).toBe('Bookmarks Bar')
    expect(tree[0]?.children[0]?.title).toBe('LLMStudy')
    expect(tree[0]?.children[0]?.children[0]?.title).toBe('10 其他')
    expect(tree[0]?.children[0]?.children[0]?.count).toBe(1)
  })

  it('skips empty path segments from the unnamed Chrome root', () => {
    const tree = staleFolderTree([staleAt('a', ['', '书签栏', '甲'])])
    expect(tree[0]?.title).toBe('书签栏')
    expect(tree[0]?.children[0]?.title).toBe('甲')
  })

  it('puts bookmarks on the folder they live in, not the ancestor', () => {
    const tree = staleFolderTree([
      staleAt('root-item', ['书签栏']),
      staleAt('child-item', ['书签栏', '甲']),
    ])
    expect(tree[0]?.items.map((entry) => entry.item.id)).toEqual(['root-item'])
    expect(tree[0]?.children[0]?.items.map((entry) => entry.item.id)).toEqual(['child-item'])
    expect(tree[0]?.count).toBe(2)
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
      ['old', 'oneToTwoYears', new Date(2025, 0, 1).getTime()],
    ])
  })

  it('uses mutually exclusive natural-month buckets and omits recent bookmarks', () => {
    const result = classifyStaleBookmarks(
      [
        item('three-to-six', new Date(2026, 4, 26, 12).getTime()),
        item('six-to-twelve', new Date(2026, 1, 26, 12).getTime()),
        item('one-to-two-years', new Date(2025, 7, 26, 12).getTime()),
        item('over-two-years', new Date(2024, 7, 26, 12).getTime()),
        item('recent', new Date(2026, 4, 27, 12).getTime()),
      ],
      scanDate,
      new Map(),
    )

    expect(result.cutoff3Months).toBe(new Date(2026, 4, 26, 12).getTime())
    expect(result.cutoff6Months).toBe(new Date(2026, 1, 26, 12).getTime())
    expect(result.cutoff12Months).toBe(new Date(2025, 7, 26, 12).getTime())
    expect(result.cutoff24Months).toBe(new Date(2024, 7, 26, 12).getTime())
    expect(result.items.map(({ item: bookmark, bucket }) => [bookmark.id, bucket])).toEqual([
      ['three-to-six', 'threeToSixMonths'],
      ['six-to-twelve', 'sixToTwelveMonths'],
      ['one-to-two-years', 'oneToTwoYears'],
      ['over-two-years', 'overTwoYears'],
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
