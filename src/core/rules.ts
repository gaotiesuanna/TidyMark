import type { Locale } from './locale'
import { sanitizeUrl } from './sanitize'
import type { BookmarkItem, ResourceType } from './types'

export interface RuleResult {
  tags: string[]
  resourceType: ResourceType
  reason: string
}

/** 用 Record<Locale, string> 而不是 string，让 tsc 强制每个词两种语言都有。 */
type Bilingual = Record<Locale, string>

const TAG_PAPER: Bilingual = { zh_CN: '论文', en: 'Papers' }
const TAG_VIDEO: Bilingual = { zh_CN: '视频', en: 'Videos' }
const TAG_DESIGN: Bilingual = { zh_CN: '设计', en: 'Design' }
const TAG_DOCS: Bilingual = { zh_CN: '官方文档', en: 'Docs' }


export const SKILL_TOPIC: Bilingual = { zh_CN: '技能', en: 'Skills' }

/**
 * GitHub/GitLab 仓库名或路径里明确写了 skill(s) 时，按技能仓库处理。
 * 这类仓库存放的是可复用能力，不应因为依附 Claude 等模型而归入模型目录。
 */
export function isSkillBookmark(item: BookmarkItem): boolean {
  const url = sanitizeUrl(item.url)
  if (url === null || (url.domain !== 'github.com' && url.domain !== 'gitlab.com')) return false
  return /(?:^|[-_\s/.])skills?(?:$|[-_\s/.])/i.test(`${item.title} ${url.path}`)
}
interface DomainRule {
  match: (domain: string) => boolean
  resourceType: ResourceType
  tags: (domain: string, path: string, locale: Locale) => string[]
}

/** GitHub、GitLab、Notion 这类专有名词两种语言相同，不做翻译。 */
function reasonFor(domain: string, locale: Locale): string {
  return locale === 'zh_CN'
    ? `根据域名规则 ${domain} 判定`
    : `Matched by domain rule ${domain}`
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
  { match: (d) => d === 'arxiv.org' || d === 'openreview.net', resourceType: 'paper', tags: (_d, _p, l) => [TAG_PAPER[l]] },
  { match: (d) => d === 'youtube.com' || d === 'bilibili.com', resourceType: 'video', tags: (_d, _p, l) => [TAG_VIDEO[l]] },
  { match: (d) => d === 'notion.so', resourceType: 'tool', tags: () => ['Notion'] },
  { match: (d) => d === 'figma.com', resourceType: 'tool', tags: (_d, _p, l) => [TAG_DESIGN[l]] },
  { match: (d) => d === 'stackoverflow.com', resourceType: 'community', tags: () => ['StackOverflow'] },
  { match: (d) => d.startsWith('docs.') || d.startsWith('developer.'), resourceType: 'documentation', tags: (_d, _p, l) => [TAG_DOCS[l]] },
]

/** GitHub/GitLab 仓库名或路径里明确写了 skill(s) 时优先按技能处理。 */
export function classifyByRules(item: BookmarkItem, locale: Locale): RuleResult | null {
  const url = sanitizeUrl(item.url)
  if (url === null) return null

  if (isSkillBookmark(item)) {
    return {
      tags: [SKILL_TOPIC[locale]],
      resourceType: 'tool',
      reason: locale === 'zh_CN'
        ? '根据仓库路径中的 skill 判定'
        : 'Matched by the skill marker in the repository path',
    }
  }

  for (const rule of RULES) {
    if (!rule.match(url.domain)) continue
    return {
      tags: rule.tags(url.domain, url.path, locale),
      resourceType: rule.resourceType,
      reason: reasonFor(url.domain, locale),
    }
  }
  return null
}
