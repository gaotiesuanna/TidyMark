import { sanitizeUrl } from './sanitize'
import type { BookmarkItem, ResourceType } from './types'

export interface RuleResult {
  tags: string[]
  resourceType: ResourceType
  reason: string
}

interface DomainRule {
  match: (domain: string) => boolean
  resourceType: ResourceType
  tags: (domain: string, path: string) => string[]
}

const RULES: DomainRule[] = [
  {
    match: (d) => d === 'github.com',
    resourceType: 'repository',
    tags: (_d, path) => {
      const parts = path.split('/').filter(Boolean)
      return parts.length >= 2 ? ['GitHub', parts[0]!, parts[1]!] : ['GitHub']
    },
  },
  { match: (d) => d === 'gitlab.com', resourceType: 'repository', tags: () => ['GitLab'] },
  { match: (d) => d === 'arxiv.org' || d === 'openreview.net', resourceType: 'paper', tags: () => ['论文'] },
  { match: (d) => d === 'youtube.com' || d === 'bilibili.com', resourceType: 'video', tags: () => ['视频'] },
  { match: (d) => d === 'notion.so', resourceType: 'tool', tags: () => ['Notion'] },
  { match: (d) => d === 'figma.com', resourceType: 'tool', tags: () => ['设计'] },
  { match: (d) => d === 'stackoverflow.com', resourceType: 'community', tags: () => ['StackOverflow'] },
  { match: (d) => d.startsWith('docs.') || d.startsWith('developer.'), resourceType: 'documentation', tags: () => ['官方文档'] },
]

export function classifyByRules(item: BookmarkItem): RuleResult | null {
  const url = sanitizeUrl(item.url)
  if (url === null) return null

  for (const rule of RULES) {
    if (!rule.match(url.domain)) continue
    return {
      tags: rule.tags(url.domain, url.path),
      resourceType: rule.resourceType,
      reason: `根据域名规则 ${url.domain} 判定`,
    }
  }
  return null
}
