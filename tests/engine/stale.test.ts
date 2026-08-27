import { describe, expect, it, vi } from 'vitest'
import { scanStaleBookmarks } from '@/engine/stale'
import type { Ports } from '@/core/ports'
import { createFakeBookmarks, type TreeSpec } from '../fakes/fake-bookmarks'
import { createFakeHistory } from '../fakes/fake-history'
import { createFakeStorage } from '../fakes/fake-storage'

const scannedAt = new Date(2026, 7, 26, 12).getTime()

function portsWithBookmarks(children: TreeSpec[]): Ports {
  return {
    bookmarks: createFakeBookmarks([
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', children },
        { id: '2', title: '其他书签', children: [
          { id: '200', title: '范围外', url: 'https://outside.example', dateLastUsed: 1 },
        ] },
      ] },
    ]).api,
    storage: createFakeStorage(),
  }
}

describe('scanStaleBookmarks', () => {
  it('classifies exact age boundaries from bookmark dateLastUsed', async () => {
    const ports = portsWithBookmarks([
      { id: '100', title: '三到六个月', url: 'https://three.example', dateLastUsed: new Date(2026, 4, 26, 12).getTime() },
      { id: '101', title: '六到十二个月', url: 'https://six.example', dateLastUsed: new Date(2026, 1, 26, 12).getTime() },
      { id: '102', title: '一年以上', url: 'https://year.example', dateLastUsed: new Date(2025, 7, 26, 12).getTime() },
    ])

    const result = await scanStaleBookmarks(ports, ['1'], scannedAt)

    expect(result.items.map(({ item, bucket }) => [item.id, bucket])).toEqual([
      ['100', 'threeToSixMonths'],
      ['101', 'sixToTwelveMonths'],
      ['102', 'overOneYear'],
    ])
  })

  it('scans only normalized scope roots and assigns each item its scope root', async () => {
    const ports = portsWithBookmarks([
      { id: '10', title: '范围内', children: [
        { id: '100', title: '旧书签', url: 'https://old.example', dateLastUsed: 1 },
      ] },
    ])

    const result = await scanStaleBookmarks(ports, ['1', '10'], scannedAt)

    expect(result.items.map(({ item }) => item.id)).toEqual(['100'])
    expect(result.scopeRootIdByBookmarkId).toEqual({ '100': '1' })
  })

  it('does not read History API when classifying long-unused bookmarks', async () => {
    const ports = portsWithBookmarks([
      { id: '100', title: '旧书签', url: 'https://old.example', dateLastUsed: 1 },
    ])
    const history = createFakeHistory()
    const search = vi.spyOn(history.api, 'search')
    ports.history = history.api

    await scanStaleBookmarks(ports, ['1'], scannedAt)

    expect(search).not.toHaveBeenCalled()
  })

  it('keeps missing dateLastUsed as unknown and omits recently opened bookmarks', async () => {
    const ports = portsWithBookmarks([
      { id: '100', title: '未知', url: 'https://unknown.example', dateAdded: 1 },
      { id: '101', title: '最近打开', url: 'https://recent.example', dateLastUsed: new Date(2026, 7, 1).getTime() },
    ])

    const result = await scanStaleBookmarks(ports, ['1'], scannedAt)

    expect(result.items).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ id: '100' }), bucket: 'unknown' }),
    ])
  })
})
