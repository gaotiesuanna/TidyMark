import { stripNumberPrefix } from './map'
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

/** 给同层还没编号的目录补号。 */
export interface FolderRename {
  id: string
  oldTitle: string
  newTitle: string
}

/**
 * 给同层还没编号的目录补号，接着本层已有最大整数编号往后编。
 * 已带编号的不动；名字本身以数字开头的（`12 月清单`）也当作已带号，不剪不编。
 */
export function planBareFolderRenames(
  siblings: readonly { id: string; title: string }[],
): FolderRename[] {
  const numbers = siblings
    .map((sibling) => folderNumber(sibling.title))
    .filter((n): n is number => n !== null)
  let next = numbers.length === 0 ? 1 : Math.floor(Math.max(...numbers)) + 1
  const renames: FolderRename[] = []
  for (const sibling of siblings) {
    if (folderNumber(sibling.title) !== null) continue
    renames.push({
      id: sibling.id,
      oldTitle: sibling.title,
      newTitle: `${String(next).padStart(2, '0')} ${sibling.title}`,
    })
    next++
  }
  return renames
}

/**
 * 保底修正整层从 02、03 等偏移编号开始的目录。
 *
 * 只有同层全部是整数编号且最小号大于 01 时才重排；带小数的旧版层级和
 * 未编号目录仍走原有补号逻辑，避免把用户名字里的数字误当成我们的编号。
 */
export function planFolderRenames(
  siblings: readonly { id: string; title: string }[],
): FolderRename[] {
  const numbers = siblings
    .map((sibling) => folderNumber(sibling.title))
  if (
    numbers.length > 0
    && numbers.every((number): number is number => number !== null && Number.isInteger(number))
    && Math.min(...numbers) > 1
  ) {
    return siblings.map((sibling, index) => ({
      id: sibling.id,
      oldTitle: sibling.title,
      newTitle: `${String(index + 1).padStart(2, '0')} ${stripNumberPrefix(sibling.title)}`,
    }))
  }
  return planBareFolderRenames(siblings)
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
