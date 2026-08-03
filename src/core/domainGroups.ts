import { sanitizeUrl } from './sanitize'
import type { BookmarkItem } from './types'

export interface DomainGroup {
  key: string
  folderTitle: string
  match: (domain: string) => boolean
}

/** 声明顺序即聚合目录的排列顺序，与用户勾选顺序无关——同样的输入必须产出同样的树。 */
export const DOMAIN_GROUPS: DomainGroup[] = [
  { key: 'github', folderTitle: 'GitHub', match: (d) => d === 'github.com' },
  { key: 'gitlab', folderTitle: 'GitLab', match: (d) => d === 'gitlab.com' },
  { key: 'video', folderTitle: '视频', match: (d) => d === 'youtube.com' || d === 'bilibili.com' },
  { key: 'paper', folderTitle: '论文', match: (d) => d === 'arxiv.org' || d === 'openreview.net' },
  { key: 'qa', folderTitle: 'StackOverflow', match: (d) => d === 'stackoverflow.com' },
  {
    key: 'docs',
    folderTitle: '官方文档',
    match: (d) => d.startsWith('docs.') || d.startsWith('developer.'),
  },
]

/**
 * 书签命中哪个已勾选的聚合组，未命中返回 null。
 * 匹配的是解析出的 host，不是整条 URL——否则 evil.com/github.com/x 会误命中。
 */
export function matchDomainGroup(item: BookmarkItem, enabled: string[]): DomainGroup | null {
  const url = sanitizeUrl(item.url)
  if (url === null) return null
  const enabledKeys = new Set(enabled)
  for (const group of DOMAIN_GROUPS) {
    if (!enabledKeys.has(group.key)) continue
    if (group.match(url.domain)) return group
  }
  return null
}
