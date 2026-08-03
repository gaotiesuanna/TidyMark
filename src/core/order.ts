import type { BookmarkNode } from './ports'
import { findScopeRoots } from './scan'

/** 把某个目录移到父目录下的第 index 位。 */
export interface FolderMove {
  id: string
  parentId: string
  index: number
}

/** 取目录名开头的编号，`05 其他` → 5、`01.6 数字人` → 1.6。没有编号返回 null。 */
export function folderNumber(title: string): number | null {
  const match = /^(\d{1,3}(?:\.\d{1,3})*)[\s.、_-]+/.exec(title)
  return match === null ? null : Number.parseFloat(match[1]!)
}

/**
 * 让带编号的目录在书签栏里真的按编号先后排列。
 *
 * 编号只写在标题里，Chrome 仍按 index 排序：新建的目录追加在末尾，
 * 已有的原地不动，于是会出现 02、03、04、01 这种顺序。
 *
 * 带编号的目录一律排到父目录最前面，彼此按编号升序；
 * 没编号的目录与书签跟在后面，相对顺序不变。
 */
export function planFolderOrder(tree: BookmarkNode[], scopeRootIds: string[]): FolderMove[] {
  const moves: FolderMove[] = []

  function walk(node: BookmarkNode): void {
    const children = node.children ?? []
    const numbered = children
      .flatMap((child) => {
        if (child.url !== undefined) return []
        const value = folderNumber(child.title)
        return value === null ? [] : [{ child, value }]
      })
      .sort((a, b) => a.value - b.value)

    numbered.forEach(({ child }, index) => {
      // 升序逐个落位：目标位置之前的都已就位，不会被后续移动挤走
      moves.push({ id: child.id, parentId: node.id, index })
    })
    for (const child of children) {
      if (child.url === undefined) walk(child)
    }
  }

  for (const root of findScopeRoots(tree, scopeRootIds)) walk(root)
  return moves
}
