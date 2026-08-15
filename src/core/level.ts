import { findBookmarksBar } from './import'
import type { BookmarkNode } from './ports'

/**
 * 每个目录的**绝对**层级，跟用户勾了哪里无关。
 *
 * 与 FolderItem.depth 的区别：`depth` 是相对于勾选点算的（勾中的那个是 0），
 * 同一个目录在不同勾选下 depth 不同。这里的 level 是它在书签库里的固定位置。
 * 两个都要——一个回答「这次要遍历多深」，一个回答「这是几级目录」。
 *
 * 层级定义照 Chrome 的视觉模型走：书签栏在界面上就是那一条栏，它自己不是「一个目录」，
 * 所以不占一层，栏里的目录是一级；而「其他书签」显示在栏的最右端、看起来就是栏上的
 * 一个文件夹，所以它自己算一级，它里面的是二级。移动设备书签同理。
 */
export function folderLevels(tree: BookmarkNode[]): Map<string, number> {
  const levels = new Map<string, number>()
  const barId = findBookmarksBar(tree)?.id

  function walk(node: BookmarkNode, level: number): void {
    // 书签不进表：层级是目录的属性
    if (node.url !== undefined) return
    levels.set(node.id, level)
    for (const child of node.children ?? []) walk(child, level + 1)
  }

  // 无名根容器（Chrome 的 '0'）不是目录，从它的子节点开始。
  // 与 findBookmarksBar 用同一种展开写法，免得两处对「顶层是什么」的理解分家。
  const top = tree.flatMap((node) => (node.title === '' ? (node.children ?? []) : [node]))
  for (const node of top) walk(node, node.id === barId ? 0 : 1)

  return levels
}
