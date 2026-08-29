import type { BookmarkNode, BookmarksApi, Ports, StorageApi } from '@/core/ports'

function toNode(raw: chrome.bookmarks.BookmarkTreeNode): BookmarkNode {
  const node: BookmarkNode = {
    id: raw.id,
    parentId: raw.parentId,
    index: raw.index,
    title: raw.title,
  }
  if (raw.url !== undefined) node.url = raw.url
  if (raw.dateAdded !== undefined) node.dateAdded = raw.dateAdded
  if (raw.dateLastUsed !== undefined) node.dateLastUsed = raw.dateLastUsed
  if (raw.children !== undefined) node.children = raw.children.map(toNode)
  return node
}

const bookmarks: BookmarksApi = {
  async getTree() {
    return (await chrome.bookmarks.getTree()).map(toNode)
  },
  async get(id) {
    try {
      const found = await chrome.bookmarks.get(id)
      return found[0] ? toNode(found[0]) : null
    } catch {
      return null
    }
  },
  async create(arg) {
    return toNode(await chrome.bookmarks.create(arg))
  },
  async move(id, dest) {
    return toNode(await chrome.bookmarks.move(id, dest))
  },
  async update(id, changes) {
    return toNode(await chrome.bookmarks.update(id, changes))
  },
  async remove(id) {
    await chrome.bookmarks.remove(id)
  },
}

const storage: StorageApi = {
  async get<T>(key: string): Promise<T | null> {
    const result = await chrome.storage.local.get(key)
    return (result[key] as T | undefined) ?? null
  },
  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  },
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key)
  },
}

export function createChromePorts(): Ports {
  return { bookmarks, storage }
}
