import type { BookmarkNode } from './ports'
import { sanitizeUrl } from './sanitize'

export interface WeightedUrl {
  url: string
  weight?: number
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
      const count = directCount + kids.reduce((n, kid) => n + kid.count, 0)
      if (count === 0) continue
      out.push(collapse({ id: node.id, title: node.title, count, directCount, children: kids }))
    }
    return sortLevel(out)
  }

  return forest(tree)
}
