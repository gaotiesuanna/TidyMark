import type { StorageApi } from '@/core/ports'

export interface FakeStorage extends StorageApi {
  dump(): Record<string, unknown>
}

export function createFakeStorage(initial: Record<string, unknown> = {}): FakeStorage {
  const data = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]),
  )
  return {
    async get<T>(key: string): Promise<T | null> {
      const raw = data.get(key)
      return raw === undefined ? null : (JSON.parse(raw) as T)
    },
    async set<T>(key: string, value: T): Promise<void> {
      data.set(key, JSON.stringify(value))
    },
    async remove(key: string): Promise<void> {
      data.delete(key)
    },
    dump() {
      return Object.fromEntries([...data].map(([k, v]) => [k, JSON.parse(v)]))
    },
  }
}
