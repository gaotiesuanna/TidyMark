import type { Locale } from './locale'
import { sanitizeUrl } from './sanitize'
import type { BookmarkItem, ResourceType } from './types'

export interface RuleResult {
  tags: string[]
  /**
   * tags 里**允许决定归属**的那些，按「越靠后越具体」排列（resolveByRules 从后往前找）。
   *
   * 与 tags 分开是这条规则存在的全部理由：`GitHub`／`GitLab`／`Notion`／
   * `StackOverflow` 说的是「托管在哪」，不是「这是什么」。库里只要有一个叫
   * 「GitHub」的目录，它就会把每一条 github.com 书签都按 confidence 1 吸过去，
   * 模型一次都轮不到——连本来好好待在「前端」里的仓库也会被拔出来倒进那个平铺的桶。
   * 真实事故：186 条书签、0 次模型调用（见 issues/39-platform-tags-still-decide.md）。
   *
   * tags 本身一个字不动：它还要进 llm/tags.ts 的主题、进推翻模式的建树、进界面展示，
   * 「这是个 GitHub 仓库」在那些地方都是有用的事实，只是不该当判决书用。
   */
  placement: string[]
  resourceType: ResourceType
  reason: string
  /**
   * 这条规则是否对「书签讲的是什么」下了断言。
   *
   * 只有它为真时才值得为了规则绕开分类缓存（见 llm/classify.ts）——那道绕行防的是
   * 「模型早年把技能仓库判进 Claude 目录，缓存把过期语义原样端回来」。平台名规则
   * 压根没有语义主张，让它也绕开缓存，等于每一轮分析都要为库里每条 GitHub 书签
   * 重新付一次钱。
   *
   * 不从 platform.length 推导：将来完全可能出现「既带平台名又带主题」的规则，
   * 那时推导出来的答案会静默地反过来。写死一个字，改规则的人必须正面回答。
   */
  semantic: boolean
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
  /** tags 里属于「托管平台名」的那些，逐字匹配剔除后剩下的才进 placement。 */
  platform: string[]
  semantic: boolean
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
    // owner/repo 留在 placement 里：库里真有个叫 react 的目录时，facebook/react
    // 进去是对的，那是名字撞上名字的真信号，不是「它托管在 GitHub」。
    tags: (_d, path) => {
      const parts = path.split('/').filter(Boolean)
      return parts.length >= 2 ? ['GitHub', parts[0]!, parts[1]!] : ['GitHub']
    },
    platform: ['GitHub'],
    semantic: false,
  },
  { match: (d) => d === 'gitlab.com', resourceType: 'repository', tags: () => ['GitLab'], platform: ['GitLab'], semantic: false },
  { match: (d) => d === 'arxiv.org' || d === 'openreview.net', resourceType: 'paper', tags: (_d, _p, l) => [TAG_PAPER[l]], platform: [], semantic: true },
  { match: (d) => d === 'youtube.com' || d === 'bilibili.com', resourceType: 'video', tags: (_d, _p, l) => [TAG_VIDEO[l]], platform: [], semantic: true },
  { match: (d) => d === 'notion.so', resourceType: 'tool', tags: () => ['Notion'], platform: ['Notion'], semantic: false },
  { match: (d) => d === 'figma.com', resourceType: 'tool', tags: (_d, _p, l) => [TAG_DESIGN[l]], platform: [], semantic: true },
  { match: (d) => d === 'stackoverflow.com', resourceType: 'community', tags: () => ['StackOverflow'], platform: ['StackOverflow'], semantic: false },
  { match: (d) => d.startsWith('docs.') || d.startsWith('developer.'), resourceType: 'documentation', tags: (_d, _p, l) => [TAG_DOCS[l]], platform: [], semantic: true },
]

/** GitHub/GitLab 仓库名或路径里明确写了 skill(s) 时优先按技能处理。 */
export function classifyByRules(item: BookmarkItem, locale: Locale): RuleResult | null {
  const url = sanitizeUrl(item.url)
  if (url === null) return null

  if (isSkillBookmark(item)) {
    return {
      tags: [SKILL_TOPIC[locale]],
      placement: [SKILL_TOPIC[locale]],
      resourceType: 'tool',
      reason: locale === 'zh_CN'
        ? '根据仓库路径中的 skill 判定'
        : 'Matched by the skill marker in the repository path',
      semantic: true,
    }
  }

  for (const rule of RULES) {
    if (!rule.match(url.domain)) continue
    const tags = rule.tags(url.domain, url.path, locale)
    return {
      tags,
      placement: tags.filter((tag) => !rule.platform.includes(tag)),
      resourceType: rule.resourceType,
      reason: reasonFor(url.domain, locale),
      semantic: rule.semantic,
    }
  }
  return null
}
