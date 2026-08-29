import type { BookmarkNode } from './ports'
import { sanitizeUrl } from './sanitize'

export interface WeightedUrl {
  url: string
  weight?: number
  title?: string
}

export interface DomainRank {
  domain: string
  count: number
  sampleUrl: string
}

export const DEFAULT_TOP_DOMAINS = 15
export const TOP_DOMAIN_MIN = 1
export const TOP_DOMAIN_MAX = 50

/** 看板「显示前几名」的合法区间。非法存量、空输入都回落到默认 15。 */
export function clampTopDomainCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TOP_DOMAINS
  const n = Math.round(value)
  if (n < TOP_DOMAIN_MIN) return TOP_DOMAIN_MIN
  if (n > TOP_DOMAIN_MAX) return TOP_DOMAIN_MAX
  return n
}

const DEFAULT_LIMIT = DEFAULT_TOP_DOMAINS

/**
 * 把 URL 按域名聚合成排行。
 *
 * weight 缺省为 1（一条书签算一次）；浏览记录把 visitCount 传进来。
 * 0 和负数丢掉——那不是一次真实出现。
 */
export function rankDomains(items: WeightedUrl[], limit = DEFAULT_LIMIT): DomainRank[] {
  const byDomain = new Map<string, DomainRank>()
  for (const item of items) {
    const weight = item.weight ?? 1
    if (weight <= 0) continue
    const parsed = sanitizeUrl(item.url)
    if (parsed === null) continue
    const existing = byDomain.get(parsed.domain)
    if (existing === undefined) {
      byDomain.set(parsed.domain, {
        domain: parsed.domain,
        count: weight,
        sampleUrl: item.url,
      })
    } else {
      existing.count += weight
    }
  }
  return [...byDomain.values()]
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
    .slice(0, limit)
}

/** 整棵书签树里带 url 的节点，深度优先、保持树内顺序。 */
export function bookmarkUrls(tree: BookmarkNode[]): WeightedUrl[] {
  const out: WeightedUrl[] = []
  const walk = (node: BookmarkNode): void => {
    if (node.url !== undefined) {
      out.push({ url: node.url })
      return
    }
    for (const child of node.children ?? []) walk(child)
  }
  for (const node of tree) walk(node)
  return out
}

export interface DomainFolderNode {
  id: string
  title: string
  /** 该域名的书签在这个文件夹里 + 所有子孙里的总数。 */
  count: number
  /** 该域名的书签直接躺在这个文件夹里的数量（不含子孙）。 */
  directCount: number
  children: DomainFolderNode[]
  bookmarks: Array<{
    id: string
    title: string
    url: string
    weight?: number
  }>
}

/**
 * 某域名的书签在文件夹树上的分布结构。
 *
 * 返回修剪过的森林：只留含该域名书签（或子孙含）的文件夹，count 为 0 的剪掉。
 * 空标题的根节点不成行，其合格子节点上浮到本层。每层按 count 降序、同数按标题稳定。
 * 自己没有直接书签、又只有一个子文件夹的「过道文件夹」折叠成 `甲 / 乙` 一行，
 * 免得单链一路缩进。
 */
export function domainFolderTree(
  tree: BookmarkNode[],
  domain: string,
): DomainFolderNode[] {
  const matches = (url: string): boolean => {
    const parsed = sanitizeUrl(url)
    return parsed !== null && parsed.domain === domain
  }

  const sortLevel = (nodes: DomainFolderNode[]): DomainFolderNode[] =>
    [...nodes].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))

  const collapse = (node: DomainFolderNode): DomainFolderNode => {
    const only = node.children.length === 1 ? node.children[0] : undefined
    if (node.directCount === 0 && only !== undefined) {
      return {
        id: only.id,
        title: `${node.title} / ${only.title}`,
        count: only.count,
        directCount: only.directCount,
        children: only.children,
        bookmarks: only.bookmarks,
      }
    }
    return node
  }

  const forest = (nodes: BookmarkNode[]): DomainFolderNode[] => {
    const out: DomainFolderNode[] = []
    for (const node of nodes) {
      if (node.url !== undefined) continue
      const kids = forest(node.children ?? [])
      if (node.title === '') {
        out.push(...kids)
        continue
      }
      const directCount = (node.children ?? []).reduce(
        (n, child) => n + (child.url !== undefined && matches(child.url) ? 1 : 0),
        0,
      )
      const bookmarks = (node.children ?? []).flatMap((child) =>
        child.url !== undefined && matches(child.url)
          ? [{ id: child.id, title: child.title, url: child.url }]
          : [],
      )
      const count = directCount + kids.reduce((n, kid) => n + kid.count, 0)
      if (count === 0) continue
      out.push(collapse({ id: node.id, title: node.title, count, directCount, children: kids, bookmarks }))
    }
    return sortLevel(out)
  }

  return forest(tree)
}

interface MutableVisitFolder {
  id: string
  title: string
  bookmarks: DomainFolderNode['bookmarks']
  children: Map<string, MutableVisitFolder>
}

/**
 * 某域名的访问记录按 URL 路径搭成文件夹树，结构和 domainFolderTree 对齐：
 * 过道折叠、每层 count 降序。count 是访问次数之和。根路径 `/` 落在空标题节点，
 * 界面上不成行，只露出页面。
 */
export function visitFolderTree(pages: readonly WeightedUrl[], domain: string): DomainFolderNode[] {
  const root: MutableVisitFolder = { id: '/', title: '', bookmarks: [], children: new Map() }

  for (const page of pages) {
    const weight = page.weight ?? 1
    if (weight <= 0) continue
    const parsed = sanitizeUrl(page.url)
    if (parsed === null || parsed.domain !== domain) continue
    const segments = parsed.path === '/' ? [] : parsed.path.split('/').filter((segment) => segment !== '')
    let node = root
    let path = ''
    for (const segment of segments) {
      path = path === '' ? segment : `${path}/${segment}`
      let child = node.children.get(segment)
      if (child === undefined) {
        child = { id: path, title: segment, bookmarks: [], children: new Map() }
        node.children.set(segment, child)
      }
      node = child
    }
    node.bookmarks.push({
      id: page.url,
      title: page.title ?? '',
      url: page.url,
      weight,
    })
  }

  const sortLevel = (nodes: DomainFolderNode[]): DomainFolderNode[] =>
    [...nodes].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))

  const collapse = (node: DomainFolderNode): DomainFolderNode => {
    const only = node.children.length === 1 ? node.children[0] : undefined
    if (node.directCount === 0 && only !== undefined && node.title !== '') {
      return {
        id: only.id,
        title: `${node.title} / ${only.title}`,
        count: only.count,
        directCount: only.directCount,
        children: only.children,
        bookmarks: only.bookmarks,
      }
    }
    return node
  }

  function freeze(node: MutableVisitFolder): DomainFolderNode {
    const children = [...node.children.values()].map(freeze)
    const bookmarks = mergeVisitPages(node.bookmarks)
    const directWeight = bookmarks.reduce((n, bookmark) => n + (bookmark.weight ?? 1), 0)
    const count = directWeight + children.reduce((n, child) => n + child.count, 0)
    return collapse({
      id: node.id,
      title: node.title,
      count,
      directCount: bookmarks.length,
      children: sortLevel(children),
      bookmarks,
    })
  }

  const frozen = freeze(root)
  if (frozen.directCount === 0) return frozen.children
  return sortLevel([
    ...frozen.children,
    {
      id: frozen.id,
      title: '',
      count: frozen.bookmarks.reduce((n, bookmark) => n + (bookmark.weight ?? 1), 0),
      directCount: frozen.directCount,
      children: [],
      bookmarks: frozen.bookmarks,
    },
  ])
}

function visitPageHref(raw: string): string {
  try {
    const url = new URL(raw)
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return raw
  }
}

/** 展示层丢掉 query/hash 后相同的地址合成一条，访问次数相加。 */
function mergeVisitPages(pages: DomainFolderNode['bookmarks']): DomainFolderNode['bookmarks'] {
  const byPath = new Map<string, { page: DomainFolderNode['bookmarks'][number]; topWeight: number }>()
  for (const page of pages) {
    const parsed = sanitizeUrl(page.url)
    const key = parsed === null ? page.url : `${parsed.domain}${parsed.path}`
    const weight = page.weight ?? 1
    const href = visitPageHref(page.url)
    const existing = byPath.get(key)
    if (existing === undefined) {
      byPath.set(key, {
        page: { ...page, id: href, url: href, weight },
        topWeight: weight,
      })
      continue
    }
    existing.page.weight = (existing.page.weight ?? 1) + weight
    if (weight > existing.topWeight) {
      existing.topWeight = weight
      existing.page.title = page.title
      existing.page.id = href
      existing.page.url = href
    }
  }
  return [...byPath.values()]
    .map((entry) => entry.page)
    .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1) || a.url.localeCompare(b.url))
}
