import { describe, expect, it, vi } from 'vitest'
import { scanStaleBookmarks } from '@/engine/stale'
import type { Ports } from '@/core/ports'
import { createFakeBookmarks } from '../fakes/fake-bookmarks'
import { createFakeHistory } from '../fakes/fake-history'
import { createFakeStorage } from '../fakes/fake-storage'

const scannedAt = Date.UTC(2026, 7, 26)

function setup() {
  const bookmarks = createFakeBookmarks([
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', children: [
        { id: '10', title: '范围内', children: [
          { id: '100', title: '旧书签', url: 'https://old.example' },
        ] },
      ] },
      { id: '2', title: '其他书签', children: [
        { id: '20', title: '范围外', url: 'https://outside.example' },
      ] },
    ] },
  ])
  const history = createFakeHistory([
    { url: 'https://old.example', lastVisitTime: Date.UTC(2025, 0, 1) },
    { url: 'https://outside.example', lastVisitTime: Date.UTC(2025, 0, 1) },
  ])
  const ports: Ports = {
    bookmarks: bookmarks.api,
    history: history.api,
    storage: createFakeStorage(),
  }
  return { ports, history }
}

describe('scanStaleBookmarks', () => {
  it('scans only normalized scope roots and assigns each item its scope root', async () => {
    const { ports, history } = setup()
    const search = vi.spyOn(history.api, 'search')

    const result = await scanStaleBookmarks(ports, ['1', '10'], scannedAt)

    expect(search).toHaveBeenCalledOnce()
    expect(result.items.map(({ item }) => item.id)).toEqual(['100'])
    expect(result.scopeRootIdByBookmarkId).toEqual({ '100': '1' })
  })

  it('throws when the optional History API is unavailable', async () => {
    const { ports } = setup()
    const withoutHistory: Ports = { bookmarks: ports.bookmarks, storage: ports.storage }

    await expect(scanStaleBookmarks(withoutHistory, ['1'], scannedAt))
      .rejects.toThrow('History API unavailable')
  })
})
