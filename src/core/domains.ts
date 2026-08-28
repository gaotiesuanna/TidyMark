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

export interface FolderShare {
  folderId: string
  path: string[]
  count: number
  bookmarks: Array<{
    id: string
    title: string
    url: string
  }>
}

/**
 * 某域名的书签按父文件夹聚合。路径是从根到该文件夹的标题，跳过空标题。
 */
export function folderDistribution(
  tree: BookmarkNode[],
  domain: string,
): FolderShare[] {
  const byFolder = new Map<string, FolderShare>()

  const walk = (nodes: BookmarkNode[], path: string[], folderId: string): void => {
    for (const node of nodes) {
      if (node.url !== undefined) {
        const parsed = sanitizeUrl(node.url)
        if (parsed === null || parsed.domain !== domain) continue
        const existing = byFolder.get(folderId)
        if (existing === undefined) {
          byFolder.set(folderId, {
            folderId,
            path,
            count: 1,
            bookmarks: [{ id: node.id, title: node.title, url: node.url }],
          })
        } else {
          existing.count += 1
          existing.bookmarks.push({ id: node.id, title: node.title, url: node.url })
        }
        continue
      }
      const nextPath = node.title === '' ? path : [...path, node.title]
      walk(node.children ?? [], nextPath, node.id)
    }
  }

  walk(tree, [], '')
  return [...byFolder.values()].sort(
    (a, b) => b.count - a.count || a.path.join('\0').localeCompare(b.path.join('\0')),
  )
}
