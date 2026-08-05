import { EXPORT_FORMAT, localDate, type ExportNode } from './export'
import type { BookmarkNode } from './ports'

export interface BlockedLink {
  name: string
  url: string
  reason: string
}

/** 解析并通过文件级校验之后的文档，两种 kind 的原始条目都还没归一。 */
export type ImportDoc =
  | { kind: 'tree'; roots: unknown[] }
  | { kind: 'links'; bookmarks: unknown[] }

export type ParseResult =
  | { ok: true; doc: ImportDoc }
  | { ok: false; error: string }

export function parseImportFile(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '这个文件不是有效的 JSON。' }
  }
  // 数组也是 object，但顶层必须是带 format 字段的对象
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '这不是 TidyMark 导出的文件，或者版本不支持。' }
  }
  const doc = raw as Record<string, unknown>
  if (doc.format !== EXPORT_FORMAT) {
    return { ok: false, error: '这不是 TidyMark 导出的文件，或者版本不支持。' }
  }
  if (doc.kind === 'tree') {
    if (!Array.isArray(doc.roots)) return { ok: false, error: '文件结构损坏。' }
    return { ok: true, doc: { kind: 'tree', roots: doc.roots } }
  }
  if (doc.kind === 'links') {
    if (!Array.isArray(doc.bookmarks)) return { ok: false, error: '文件结构损坏。' }
    return { ok: true, doc: { kind: 'links', bookmarks: doc.bookmarks } }
  }
  return { ok: false, error: `无法识别的导出类型：${String(doc.kind)}` }
}

/**
 * 导入的文件来自别人，而 javascript: 书签就是 bookmarklet——
 * 点开时会在用户当时所在的页面上以用户的身份执行脚本。data: 同理。
 * 只拦这两个，file:// 之类的正常用法照常放行。
 */
const BLOCKED_SCHEMES = ['javascript:', 'data:'] as const

/**
 * 比对前先按 URL 标准做解析前处理：
 * 首部的 C0 控制符与空格、以及任意位置的 tab/LF/CR，都会被 URL 解析器去掉。
 * 只做 trimStart 的话，"java\tscript:" 这种会溜过去而浏览器照样当 javascript: 执行。
 */
function blockedScheme(url: string): string | null {
  const canonical = url
    .replace(/^[\u0000-\u0020]+/, '')
    .replace(/[\t\n\r]/g, '')
    .trimStart() // JS 认得而 URL 解析器不认得的 Unicode 空白，宁可多拦
    .toLowerCase()
  return BLOCKED_SCHEMES.find((scheme) => canonical.startsWith(scheme)) ?? null
}

/**
 * 真实书签树的层级远达不到这个数——超过大概率是构造出来的坏文件（或恶意文件）。
 * JSON.parse 本身撑得住远超此值的嵌套，若不设界，后续的 count / NodeRow
 * 等递归会在深层输入下栈溢出，把整个侧栏搞崩，比整份拒绝还难看。
 */
const MAX_DEPTH = 64

/**
 * 把来路不明的一条原始数据归一成 ExportNode，归一不了就返回 null 由调用方丢弃。
 * 被安全策略拦下的条目不是「丢弃」，要记进 blocked 让用户看见；
 * 超过 MAX_DEPTH 的子树同样当坏节点丢弃——它不是安全问题，不记进 blocked。
 */
function normalize(raw: unknown, blocked: BlockedLink[], depth = 0): ExportNode | null {
  if (depth > MAX_DEPTH) return null
  if (typeof raw !== 'object' || raw === null) return null
  const node = raw as Record<string, unknown>
  const name = typeof node.name === 'string' ? node.name : ''

  if (typeof node.url === 'string') {
    const scheme = blockedScheme(node.url)
    if (scheme !== null) {
      blocked.push({ name, url: node.url, reason: `不安全的链接类型（${scheme}）` })
      return null
    }
    return { name, url: node.url }
  }

  if ('children' in node) {
    const children = Array.isArray(node.children)
      ? node.children
          .map((child) => normalize(child, blocked, depth + 1))
          .filter((child): child is ExportNode => child !== null)
      : []
    return { name, children }
  }

  return null
}

function collectExistingUrls(tree: BookmarkNode[]): Set<string> {
  const urls = new Set<string>()
  const stack = [...tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.url !== undefined) urls.add(node.url)
    for (const child of node.children ?? []) stack.push(child)
  }
  return urls
}

/** Chrome 的根节点 id='0' 且标题为空，书签栏是它下面的第一个文件夹。 */
export function findBookmarksBar(tree: BookmarkNode[]): BookmarkNode | null {
  const top = tree.flatMap((node) => (node.title === '' ? (node.children ?? []) : [node]))
  return top.find((node) => node.url === undefined) ?? null
}

export interface ImportPreview {
  /** 已剔除坏节点与被拦条目，两种 kind 到这里都是同一种形状。 */
  nodes: ExportNode[]
  bookmarkCount: number
  folderCount: number
  /** 其中已经在用户书签库里存在的条数（按条计，不按 URL 种类计）。 */
  duplicateCount: number
  blocked: BlockedLink[]
  targetName: string
  barTitle: string
}

export function buildImportPreview(
  doc: ImportDoc,
  tree: BookmarkNode[],
  at: Date,
): ImportPreview {
  const blocked: BlockedLink[] = []
  const raw = doc.kind === 'tree' ? doc.roots : doc.bookmarks
  const nodes = raw
    .map((item) => normalize(item, blocked))
    .filter((item): item is ExportNode => item !== null)

  const existing = collectExistingUrls(tree)
  let bookmarkCount = 0
  let folderCount = 0
  let duplicateCount = 0

  function count(items: ExportNode[]): void {
    for (const item of items) {
      if ('url' in item) {
        bookmarkCount += 1
        if (existing.has(item.url)) duplicateCount += 1
        continue
      }
      folderCount += 1
      count(item.children)
    }
  }
  count(nodes)

  return {
    nodes,
    bookmarkCount,
    folderCount,
    duplicateCount,
    blocked,
    targetName: `导入 ${localDate(at)}`,
    barTitle: findBookmarksBar(tree)?.title ?? '书签栏',
  }
}
