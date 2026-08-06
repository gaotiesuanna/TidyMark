import type { Locale } from './locale'
import { sanitizeUrl } from './sanitize'
import type { BookmarkItem } from './types'

export interface DomainGroup {
  key: string
  /** 两种语言都必填——Record<Locale, string> 让 tsc 挡住漏填。 */
  folderTitle: Record<Locale, string>
  match: (domain: string) => boolean
}

/** 声明顺序即聚合目录的排列顺序，与用户勾选顺序无关——同样的输入必须产出同样的树。 */
export const DOMAIN_GROUPS: DomainGroup[] = [
  { key: 'github', folderTitle: { zh_CN: 'GitHub', en: 'GitHub' }, match: (d) => d === 'github.com' },
  { key: 'gitlab', folderTitle: { zh_CN: 'GitLab', en: 'GitLab' }, match: (d) => d === 'gitlab.com' },
  { key: 'video', folderTitle: { zh_CN: '视频', en: 'Videos' }, match: (d) => d === 'youtube.com' || d === 'bilibili.com' },
  { key: 'paper', folderTitle: { zh_CN: '论文', en: 'Papers' }, match: (d) => d === 'arxiv.org' || d === 'openreview.net' },
  { key: 'qa', folderTitle: { zh_CN: 'StackOverflow', en: 'StackOverflow' }, match: (d) => d === 'stackoverflow.com' },
  {
    key: 'docs',
    folderTitle: { zh_CN: '官方文档', en: 'Docs' },
    match: (d) => d.startsWith('docs.') || d.startsWith('developer.'),
  },
]

export function groupFolderTitle(group: DomainGroup, locale: Locale): string {
  return group.folderTitle[locale]
}

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
