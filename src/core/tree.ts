import { DOMAIN_GROUPS, groupFolderTitle, matchDomainGroup } from './domainGroups'
import type { Locale } from './locale'
import { normalizeName, stripNumberPrefix } from './map'
import type { NewFolderSpec, RenameFolderSpec } from './plan'
import type { BookmarkItem, CategoryCandidate, Classification, TagResult } from './types'

/** 同一层最多允许的目录数量。目录集合由 llm/folders.ts 设计，这里只做兜底截断。 */
export const MAX_SIBLINGS = 12
/** 兜底目录名，会真的建进用户书签栏，必须双语。 */
export const FALLBACK_TITLE: Record<Locale, string> = { zh_CN: '其他', en: 'Other' }

export { stripNumberPrefix }

/** 复用已有目录时只需要这三个字段，FolderItem 可以直接传入。 */
export interface ExistingFolder {
  id: string
  parentId: string | null
  title: string
}

export interface BuildTreeInput {
  tags: TagResult[]
  /** 新目录挂载的范围根文件夹 id。 */
  rootId: string
  /**
   * 合并模式：新目录树挂在一个本批新建的容器目录下，而不是已有的 rootId。
   * 给出时 rootId 不再被使用，两者互斥。
   */
  mergeRoot?: { parentId: string; title: string }
  /** 范围内已存在的文件夹，用于复用而不是重复新建同名目录。 */
  existingFolders: ExistingFolder[]
  /** 域名匹配需要 URL，TagResult 只有 bookmarkId。省略时不做聚合。 */
  bookmarks?: BookmarkItem[]
  /** 已勾选的聚合组 key。省略或为空时不做聚合。 */
  domainGroups?: string[]
  /** 聚合组目录名走哪种语言。必填——Record<Locale, string> 的强制在调用点这一侧也不能松口。 */
  locale: Locale
}

export interface BuildTreeOutput {
  candidates: CategoryCandidate[]
  newFolders: NewFolderSpec[]
  renameFolders: RenameFolderSpec[]
  /** 命中聚合组的书签，归属已确定，无需再走 LLM 分类。 */
  pinned: Classification[]
  /** 合并模式下容器目录的临时 id；非合并模式为 null。 */
  mergeRootTemporaryId: string | null
}

/** 建树时的中间形态：聚合组与主题组归一成同一种结构，交给同一个发射循环。 */
interface Section {
  title: string
  /** 属于哪个聚合组；主题组为 null。 */
  domainGroup: string | null
  children: Array<{ title: string; bookmarkIds: string[] }>
  /** 直接落在本节点下的书签；主题组恒为空（归属由分类阶段决定）。 */
  ownBookmarkIds: string[]
}

interface TopicGroup {
  title: string
  count: number
  children: Map<string, { title: string; count: number }>
}

/** 每层各自从 `01` 开始编号，子层不带父级前缀。 */
function numbered(prefix: string, title: string): string {
  return `${prefix} ${title}`
}

/** 聚合组的排列顺序取自 DOMAIN_GROUPS 的声明顺序，不受用户勾选顺序影响。 */
function domainGroupOrder(key: string): number {
  const index = DOMAIN_GROUPS.findIndex((g) => g.key === key)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

export function buildCategoryTree(input: BuildTreeInput): BuildTreeOutput {
  if (input.tags.length === 0) {
    return { candidates: [], newFolders: [], renameFolders: [], pinned: [], mergeRootTemporaryId: null }
  }
  const { locale } = input

  const baseTitle = (folder: ExistingFolder): string => stripNumberPrefix(folder.title)
  const lookupKey = (parentId: string, title: string): string =>
    JSON.stringify([parentId, normalizeName(title)])

  // (父目录, 归一化后的名字) → 已有目录，用于复用
  const existingByParent = new Map<string, ExistingFolder>()
  // 归一化后的名字 → 已有写法，用于沿用用户自己的命名习惯
  const existingByName = new Map<string, string>()
  for (const folder of input.existingFolders) {
    const base = baseTitle(folder)
    const key = lookupKey(folder.parentId ?? '', base)
    if (!existingByParent.has(key)) existingByParent.set(key, folder)
    if (!existingByName.has(normalizeName(base))) existingByName.set(normalizeName(base), base)
  }
  const findChild = (parentId: string, title: string): ExistingFolder | null =>
    existingByParent.get(lookupKey(parentId, title)) ?? null
  const preferredName = (title: string): string =>
    existingByName.get(normalizeName(title)) ?? title

  // ---- 第一步：把命中聚合组的书签分流出去 ----

  const bookmarkById = new Map((input.bookmarks ?? []).map((b) => [b.id, b]))
  const enabled = input.domainGroups ?? []
  /** 聚合组 key → 该组的标签；顺序沿用 tags 的顺序。 */
  const byDomainGroup = new Map<string, TagResult[]>()
  const groupTitleByKey = new Map<string, string>()
  const domainOf = new Map<string, string>()
  const topicTags: TagResult[] = []

  for (const tag of input.tags) {
    const bookmark = enabled.length === 0 ? undefined : bookmarkById.get(tag.bookmarkId)
    const group = bookmark === undefined ? null : matchDomainGroup(bookmark, enabled)
    if (group === null) {
      topicTags.push(tag)
      continue
    }
    const bucket = byDomainGroup.get(group.key) ?? []
    bucket.push(tag)
    byDomainGroup.set(group.key, bucket)
    groupTitleByKey.set(group.key, groupFolderTitle(group, locale))
    // sanitizeUrl 已在 matchDomainGroup 内部成功解析过，这里必定拿得到 host
    domainOf.set(tag.bookmarkId, new URL(bookmark!.url).hostname.toLowerCase().replace(/^www\./, ''))
  }

  // ---- 第二步：聚合组的 Section，按 DOMAIN_GROUPS 声明顺序 ----

  const domainSections: Section[] = []
  for (const key of enabled.slice().sort(
    (a, b) => domainGroupOrder(a) - domainGroupOrder(b),
  )) {
    const bucket = byDomainGroup.get(key)
    if (bucket === undefined || bucket.length === 0) continue

    const byTopic = new Map<string, { title: string; bookmarkIds: string[] }>()
    for (const tag of bucket) {
      const topicKey = normalizeName(tag.primaryTopic)
      if (topicKey === '') continue
      const child = byTopic.get(topicKey) ?? { title: preferredName(tag.primaryTopic), bookmarkIds: [] }
      child.bookmarkIds.push(tag.bookmarkId)
      byTopic.set(topicKey, child)
    }
    const children = [...byTopic.values()]
      .sort((a, b) => b.bookmarkIds.length - a.bookmarkIds.length)
      .slice(0, MAX_SIBLINGS)
    const placed = new Set(children.flatMap((c) => c.bookmarkIds))
    domainSections.push({
      title: preferredName(groupTitleByKey.get(key)!),
      domainGroup: key,
      children,
      // primaryTopic 归一化后为空、或因超过 MAX_SIBLINGS 阈值未获得子目录的书签，
      // 不建子目录，直接平铺在组根下
      ownBookmarkIds: bucket.map((t) => t.bookmarkId).filter((id) => !placed.has(id)),
    })
  }

  // ---- 第三步：主题组的 Section，逻辑与聚合前完全一致 ----

  const groups = new Map<string, TopicGroup>()
  for (const tag of topicTags) {
    const key = normalizeName(tag.primaryTopic)
    if (key === '') continue
    const group = groups.get(key) ?? { title: preferredName(tag.primaryTopic), count: 0, children: new Map() }
    group.count++
    if (tag.secondaryTopic !== null && normalizeName(tag.secondaryTopic) !== '') {
      const childKey = normalizeName(tag.secondaryTopic)
      const child = group.children.get(childKey) ?? { title: preferredName(tag.secondaryTopic), count: 0 }
      child.count++
      group.children.set(childKey, child)
    }
    groups.set(key, group)
  }

  const ranked = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SIBLINGS - 1) // 留一个位置给「其他」

  const hasFallback = ranked.some((g) => normalizeName(g.title) === normalizeName(FALLBACK_TITLE[locale]))
  const orderedTopics = hasFallback
    ? ranked
    : [...ranked, { title: FALLBACK_TITLE[locale], count: 0, children: new Map() } satisfies TopicGroup]

  const topicSections: Section[] = orderedTopics.map((group) => ({
    title: group.title,
    domainGroup: null,
    children: [...group.children.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_SIBLINGS)
      .map((c) => ({ title: c.title, bookmarkIds: [] })),
    ownBookmarkIds: [],
  }))

  // ---- 第四步：统一发射 ----

  const candidates: CategoryCandidate[] = []
  const newFolders: NewFolderSpec[] = []
  const renameFolders: RenameFolderSpec[] = []
  const pinned: Classification[] = []
  let counter = 0
  const nextId = (): string => `tmp:${++counter}`

  // 合并模式：容器目录必须第一个发射，后面的一级目录才挂得上它的临时 id。
  // 它是容器不是分类，标题不编号。
  let mergeRootTemporaryId: string | null = null
  if (input.mergeRoot !== undefined) {
    mergeRootTemporaryId = nextId()
    newFolders.push({
      temporaryId: mergeRootTemporaryId,
      parentId: input.mergeRoot.parentId,
      parentTemporaryId: null,
      title: input.mergeRoot.title,
    })
  }

  // 理由说明的是「为什么进这个聚合组」，因此落到子目录时也报组名而不是子目录名
  const pin = (bookmarkIds: string[], categoryId: string, groupTitle: string): void => {
    for (const bookmarkId of bookmarkIds) {
      const domain = domainOf.get(bookmarkId) ?? ''
      pinned.push({
        bookmarkId,
        targetCategoryId: categoryId,
        confidence: 1,
        reason:
          locale === 'zh_CN'
            ? `域名 ${domain} 命中「${groupTitle}」聚合`
            : `Domain ${domain} matched the "${groupTitle}" group`,
        source: 'rule',
      })
    }
  }

  ;[...domainSections, ...topicSections].forEach((section, sectionIndex) => {
    const prefix = String(sectionIndex + 1).padStart(2, '0')
    const title = numbered(prefix, section.title)
    // 合并模式下容器目录是刚建的，底下没有任何可复用的子目录
    const existing = mergeRootTemporaryId === null ? findChild(input.rootId, section.title) : null
    const mark = section.domainGroup === null ? {} : { domainGroup: section.domainGroup }

    let parentRealId: string | null = null
    let parentTemporaryId: string | null = null
    let sectionId: string
    if (existing !== null) {
      parentRealId = existing.id
      sectionId = existing.id
      candidates.push({ id: existing.id, path: [title], ...mark })
      if (existing.title !== title) {
        renameFolders.push({ folderId: existing.id, oldTitle: existing.title, newTitle: title })
      }
    } else {
      parentTemporaryId = nextId()
      sectionId = parentTemporaryId
      newFolders.push({
        temporaryId: parentTemporaryId,
        parentId: mergeRootTemporaryId === null ? input.rootId : null,
        parentTemporaryId: mergeRootTemporaryId,
        title,
      })
      candidates.push({ id: parentTemporaryId, path: [title], ...mark })
    }
    pin(section.ownBookmarkIds, sectionId, section.title)

    section.children.forEach((child, childIndex) => {
      const childTitle = numbered(String(childIndex + 1).padStart(2, '0'), child.title)
      // 父目录是新建的，它下面不可能有已存在的子目录
      const existingChild = parentRealId === null ? null : findChild(parentRealId, child.title)
      if (existingChild !== null) {
        candidates.push({ id: existingChild.id, path: [title, childTitle], ...mark })
        if (existingChild.title !== childTitle) {
          renameFolders.push({
            folderId: existingChild.id, oldTitle: existingChild.title, newTitle: childTitle,
          })
        }
        pin(child.bookmarkIds, existingChild.id, section.title)
        return
      }
      const childId = nextId()
      newFolders.push({
        temporaryId: childId, parentId: parentRealId, parentTemporaryId, title: childTitle,
      })
      candidates.push({ id: childId, path: [title, childTitle], ...mark })
      pin(child.bookmarkIds, childId, section.title)
    })
  })

  return { candidates, newFolders, renameFolders, pinned, mergeRootTemporaryId }
}
