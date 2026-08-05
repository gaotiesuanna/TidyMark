import type { BookmarkNode, BookmarksApi } from '@/core/ports'

export interface TreeSpec {
  id: string
  title: string
  url?: string
  children?: TreeSpec[]
}

interface Entry {
  id: string
  parentId?: string
  title: string
  url?: string
  childIds: string[]
}

export interface FakeBookmarks {
  api: BookmarksApi
  structure(): string
}

export function createFakeBookmarks(initial: TreeSpec[]): FakeBookmarks {
  const entries = new Map<string, Entry>()
  const roots: string[] = []
  let nextId = 1000

  function ingest(spec: TreeSpec, parentId?: string): void {
    entries.set(spec.id, {
      id: spec.id,
      parentId,
      title: spec.title,
      url: spec.url,
      childIds: [],
    })
    if (parentId) entries.get(parentId)!.childIds.push(spec.id)
    else roots.push(spec.id)
    for (const child of spec.children ?? []) ingest(child, spec.id)
  }
  for (const spec of initial) ingest(spec)

  function must(id: string): Entry {
    const entry = entries.get(id)
    if (!entry) throw new Error(`书签节点不存在: ${id}`)
    return entry
  }

  function indexOf(entry: Entry): number | undefined {
    if (!entry.parentId) return undefined
    return must(entry.parentId).childIds.indexOf(entry.id)
  }

  function toNode(entry: Entry, deep: boolean): BookmarkNode {
    const node: BookmarkNode = {
      id: entry.id,
      parentId: entry.parentId,
      index: indexOf(entry),
      title: entry.title,
    }
    if (entry.url !== undefined) node.url = entry.url
    if (deep && entry.url === undefined) {
      node.children = entry.childIds.map((id) => toNode(must(id), true))
    }
    return node
  }

  function detach(entry: Entry): void {
    if (!entry.parentId) return
    const siblings = must(entry.parentId).childIds
    const at = siblings.indexOf(entry.id)
    if (at >= 0) siblings.splice(at, 1)
  }

  const api: BookmarksApi = {
    async getTree() {
      return roots.map((id) => toNode(must(id), true))
    },
    async get(id) {
      const entry = entries.get(id)
      return entry ? toNode(entry, false) : null
    },
    async create({ parentId, title, index, url }) {
      const parent = must(parentId)
      const id = String(nextId++)
      entries.set(id, { id, parentId, title, url, childIds: [] })
      const at = index ?? parent.childIds.length
      parent.childIds.splice(at, 0, id)
      return toNode(must(id), false)
    },
    async move(id, dest) {
      const entry = must(id)
      const targetParentId = dest.parentId ?? entry.parentId
      if (!targetParentId) throw new Error(`无法移动根节点: ${id}`)
      const target = must(targetParentId)
      const sameParent = targetParentId === entry.parentId
      const currentIndex = sameParent ? target.childIds.indexOf(id) : -1
      detach(entry)
      entry.parentId = targetParentId
      let at = dest.index ?? target.childIds.length
      // Chrome 语义：同 parent 内向后移动时，index 以移除前的列表计算
      if (sameParent && dest.index !== undefined && dest.index > currentIndex) at = dest.index - 1
      if (at < 0) at = 0
      if (at > target.childIds.length) at = target.childIds.length
      target.childIds.splice(at, 0, id)
      return toNode(entry, false)
    },
    async update(id, changes) {
      const entry = must(id)
      entry.title = changes.title
      return toNode(entry, false)
    },
    async remove(id) {
      const entry = must(id)
      if (entry.childIds.length > 0) throw new Error(`无法删除非空文件夹: ${id}`)
      detach(entry)
      entries.delete(id)
    },
  }

  function structure(): string {
    const lines: string[] = []
    function walk(id: string, prefix: string): void {
      const entry = must(id)
      const isFolder = entry.url === undefined
      const path = prefix + entry.title + (isFolder ? '/' : '')
      lines.push(path)
      if (isFolder) for (const childId of entry.childIds) walk(childId, path.slice(0, -1) + '/')
    }
    for (const id of roots) walk(id, '')
    return lines.join('\n')
  }

  return { api, structure }
}
