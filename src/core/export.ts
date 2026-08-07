import type { BookmarkNode } from './ports'
import { findScopeRoots } from './scan'

/** 导出文件的版本标识，将来的导入功能靠它挡住不认识的版本。 */
export const EXPORT_FORMAT = 'tidymark/v1'

/** tree / links 是 tidymark/v1 的 JSON，html 是给别家浏览器导入用的 Netscape 书签文件。 */
export type ExportKind = 'tree' | 'links' | 'html'

/** 二选一：带 url 的是书签，带 children 的是文件夹。 */
export type ExportNode =
  | { name: string; url: string }
  | { name: string; children: ExportNode[] }

export interface ExportLink {
  name: string
  url: string
}

export interface TreeExport {
  format: typeof EXPORT_FORMAT
  kind: 'tree'
  exportedAt: string
  roots: ExportNode[]
}

export interface LinksExport {
  format: typeof EXPORT_FORMAT
  kind: 'links'
  exportedAt: string
  bookmarks: ExportLink[]
}

/**
 * 只留 name 与层级，丢掉 Chrome 的 id / parentId / index。
 * 这些 id 在别人的浏览器里没有意义，导入是按结构重建目录而不是还原到原 id 的位置。
 */
function toNode(node: BookmarkNode): ExportNode {
  if (node.url !== undefined) return { name: node.title, url: node.url }
  return { name: node.title, children: (node.children ?? []).map(toNode) }
}

function collectLinks(node: BookmarkNode, out: ExportLink[]): void {
  if (node.url !== undefined) {
    out.push({ name: node.title, url: node.url })
    return
  }
  for (const child of node.children ?? []) collectLinks(child, out)
}

/**
 * 勾选是级联的，scopeRootIds 里父子同时存在，
 * 必须先经 findScopeRoots 去重成互不包含的子树根，否则同一棵子树会被导出两遍。
 */
function scopedLinks(tree: BookmarkNode[], scopeRootIds: string[]): ExportLink[] {
  const links: ExportLink[] = []
  for (const root of findScopeRoots(tree, scopeRootIds)) collectLinks(root, links)
  return links
}

export function toTreeExport(
  tree: BookmarkNode[],
  scopeRootIds: string[],
  exportedAt: Date,
): TreeExport {
  return {
    format: EXPORT_FORMAT,
    kind: 'tree',
    exportedAt: exportedAt.toISOString(),
    roots: findScopeRoots(tree, scopeRootIds).map(toNode),
  }
}

export function toLinksExport(
  tree: BookmarkNode[],
  scopeRootIds: string[],
  exportedAt: Date,
): LinksExport {
  return {
    format: EXPORT_FORMAT,
    kind: 'links',
    exportedAt: exportedAt.toISOString(),
    bookmarks: scopedLinks(tree, scopeRootIds),
  }
}

/** 走与导出同一条路径统计，保证界面上的条数与导出结果永远对得上。 */
export function countScopedBookmarks(tree: BookmarkNode[], scopeRootIds: string[]): number {
  return scopedLinks(tree, scopeRootIds).length
}

/**
 * 范围内所有书签的 URL，深度优先、保持树内顺序。
 * HTML 导出拿它去查 favicon——同样走 scopedLinks，
 * 保证「查图标的范围」与「导出的范围」是同一批，不会多查到没勾选的书签。
 */
export function scopedBookmarkUrls(tree: BookmarkNode[], scopeRootIds: string[]): string[] {
  return scopedLinks(tree, scopeRootIds).map((link) => link.url)
}

/** 本地日期串，形如 2026-08-04。导出的文件名和导入的目标文件夹名共用它。 */
export function localDate(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/** 文件名用本地日期——下载下来的应该是用户自己时区的今天，而不是 UTC 的今天。 */
export function exportFileName(kind: ExportKind, at: Date): string {
  const ext = kind === 'html' ? 'html' : 'json'
  return `tidymark-${kind}-${localDate(at)}.${ext}`
}
