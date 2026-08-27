import { folderLevels } from './level'
import { folderKey } from './map'
import type { BookmarkNode } from './ports'
import type { BookmarkItem, FolderItem, ScanResult, ScanStats } from './types'

/**
 * 把 scopeRootIds 解释成互不包含的若干棵子树的根。
 *
 * 勾选界面会级联勾上所有子文件夹，因此 scopeRootIds 往往同时包含父与子。
 * 若不去重，同一棵子树会被重复遍历，调用方拿到重复节点。
 */
export function findScopeRoots(tree: BookmarkNode[], scopeRootIds: string[]): BookmarkNode[] {
  const wanted = new Set(scopeRootIds)
  const roots: BookmarkNode[] = []

  function walk(node: BookmarkNode, insideRoot: boolean): void {
    const isRoot = !insideRoot && wanted.has(node.id)
    if (isRoot) roots.push(node)
    for (const child of node.children ?? []) walk(child, insideRoot || isRoot)
  }
  for (const node of tree) walk(node, false)

  return roots
}

/**
 * 把这次勾的范围根画成 /书签栏/react/ 这种路径。
 *
 * 无名根（Chrome 的 id='0'）不占一段——界面上本来就看不见它。
 * 父子同时勾选时只报真正的范围根，跟 findScopeRoots 同一套去重。
 */
export function scopeFolderPaths(tree: BookmarkNode[], scopeRootIds: string[]): string[] {
  const wanted = new Set(findScopeRoots(tree, scopeRootIds).map((root) => root.id))
  const paths: string[] = []

  function walk(node: BookmarkNode, ancestors: string[]): void {
    const titles = node.title === '' ? ancestors : [...ancestors, node.title]
    if (wanted.has(node.id)) {
      paths.push(titles.length === 0 ? '/' : `/${titles.join('/')}/`)
    }
    for (const child of node.children ?? []) walk(child, titles)
  }
  for (const node of tree) walk(node, [])
  return paths
}

export function scanTree(tree: BookmarkNode[], scopeRootIds: string[]): ScanResult {
  const bookmarks: BookmarkItem[] = []
  const folders: FolderItem[] = []
  // 必须先去重：勾选界面级联勾上所有子文件夹，父子同时在列时子树会被遍历两遍
  const roots = findScopeRoots(tree, scopeRootIds)
  // 绝对层级要从整棵树算，不能从子树根算——这正是它与 depth 的区别
  const levels = folderLevels(tree)

  function walk(node: BookmarkNode, path: string[], depth: number): void {
    if (node.url !== undefined) {
      bookmarks.push({
        id: node.id,
        title: node.title,
        url: node.url,
        parentId: node.parentId ?? '',
        index: node.index ?? 0,
        currentPath: path,
        dateAdded: node.dateAdded,
        dateLastUsed: node.dateLastUsed,
      })
      return
    }
    folders.push({
      id: node.id,
      title: node.title,
      parentId: node.parentId ?? null,
      index: node.index ?? 0,
      path,
      depth,
      // 必中：levels 走的是同一棵 tree，凡是能在这里被遍历到的目录都在表里。
      // 不写 ?? 兜底——兜出来的会是个看着合理的错数字，比缺失更难发现
      level: levels.get(node.id)!,
    })
    const childPath = [...path, node.title]
    for (const child of node.children ?? []) walk(child, childPath, depth + 1)
  }

  for (const root of roots) walk(root, [], 0)

  const urlCounts = new Map<string, number>()
  for (const item of bookmarks) urlCounts.set(item.url, (urlCounts.get(item.url) ?? 0) + 1)

  // 同父（parentId）+ 归一化后的名字 → 出现次数。用它数出有几组重名目录。
  // 用 folder.parentId 判「同父」，不用相对范围根拼出来的 path——勾了两个同名
  // 范围根时，两个真父目录并不相同的子树会因为「相对各自范围根的路径」凑巧一样
  // 而被错误合并成一组。parentId 就是上面 walk() 里如实透传的 BookmarkNode.parentId
  // （`parentId: node.parentId ?? null`），调用方（含测试夹具）必须按真实层级填好，
  // 不能省——这正是它靠得住的前提。
  // key 由 folderKey 统一构造（父目录 id + 剥编号前缀再归一化的名字），与
  // buildCandidatesFromFolders 去重候选用的是同一个函数——这个数字要直接进日志，
  // 口径必须和实际折叠掉的候选数同源，不然日志会报一个跟结果对不上的数字。
  const folderKeyCounts = new Map<string, number>()
  for (const folder of folders) {
    const key = folderKey(folder)
    folderKeyCounts.set(key, (folderKeyCounts.get(key) ?? 0) + 1)
  }

  const stats: ScanStats = {
    totalBookmarks: bookmarks.length,
    totalFolders: folders.length,
    emptyFolders: folders.filter(
      (f) => !bookmarks.some((b) => b.parentId === f.id) && !folders.some((c) => c.parentId === f.id),
    ).length,
    untitledBookmarks: bookmarks.filter((b) => b.title.trim() === '').length,
    duplicateUrlGroups: [...urlCounts.values()].filter((n) => n > 1).length,
    maxDepth: folders.reduce((max, f) => Math.max(max, f.depth), 0),
    duplicateFolderGroups: [...folderKeyCounts.values()].filter((n) => n > 1).length,
  }

  return { bookmarks, folders, stats }
}
