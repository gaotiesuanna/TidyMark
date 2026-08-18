import { normalizeName, stripNumberPrefix } from './map'
import { folderNumber } from './order'
import type { NewFolderSpec } from './plan'
import { MAX_SIBLINGS } from './tree'
import type { CategoryCandidate, Classification, FolderItem } from './types'

/**
 * 同一主题攒够几条才值得开一个新目录。
 *
 * 内部常量而不是设置项：用户无从判断 3 还是 5 更好（见 issues/08-settings-tradeoffs.md），
 * 而 `minFolderSize` 那个设置项本身即将随清单第 12 项一起删掉，不去依赖它。
 */
export const MIN_NEW_FOLDER_SIZE = 3

export interface TopicCluster {
  /** 归一化后的主题，用于合并同义写法。 */
  key: string
  /** 展示用的主题名：簇内出现次数最多的原始写法，已剥掉编号前缀。 */
  title: string
  /** 属于这一簇的书签 id，按输入顺序。 */
  bookmarkIds: string[]
}

/**
 * 把「分不进任何已有目录」的书签按模型带回的主题聚成簇。
 *
 * 规则定量、模型只负责起名（见 issues/13-additive-mode-design.md）：这里只做确定性的
 * 归并与计数，不问模型「该不该建这个目录」——那会让同一类书签在不同批次里得到不同答案。
 *
 * 并行批次之间的标签本来就不保证一致，`normalizeName` 只能救回大小写、空白、下划线、
 * 连字符这一层的差异。「同一主题被拆成两个近义标签、于是都攒不够」是已知且可接受的
 * 失败——那时书签留在原地，不算错。
 *
 * 排序：先按簇大小降序，同样大小按首次出现顺序。同样的输入必须产出同样的树。
 */
export function clusterHomeless(
  classifications: Classification[],
  minSize: number = MIN_NEW_FOLDER_SIZE,
): TopicCluster[] {
  interface Bucket {
    key: string
    order: number
    bookmarkIds: string[]
    /** 原始写法 → 出现次数，用来挑一个展示名。 */
    titles: Map<string, number>
  }

  const buckets = new Map<string, Bucket>()
  for (const c of classifications) {
    // 只看无家可归的：有归属的书签不需要新目录
    if (c.targetCategoryId !== null) continue
    if (c.topic === undefined) continue
    const title = stripNumberPrefix(c.topic.trim()).trim()
    const key = normalizeName(title)
    // 纯编号或纯空白的 topic 归一化后为空，当没给
    if (key === '') continue
    const bucket = buckets.get(key) ?? { key, order: buckets.size, bookmarkIds: [], titles: new Map<string, number>() }
    bucket.bookmarkIds.push(c.bookmarkId)
    bucket.titles.set(title, (bucket.titles.get(title) ?? 0) + 1)
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .filter((b) => b.bookmarkIds.length >= minSize)
    .sort((a, b) => b.bookmarkIds.length - a.bookmarkIds.length || a.order - b.order)
    .map((b) => ({
      key: b.key,
      // Map 保插入顺序，所以同票数时先出现的写法胜出
      title: [...b.titles.entries()].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0],
      bookmarkIds: b.bookmarkIds,
    }))
}

export interface PlanNewFoldersInput {
  clusters: TopicCluster[]
  /** 簇 key → 目录名，来自 llm/folders.ts 的 nameNewTopics。缺了就用簇自己的 title。 */
  names: Map<string, string>
  /** 新目录挂在这个目录下。一律范围根，不做「挂进语义最近的已有目录」。 */
  rootId: string
  folders: FolderItem[]
  classifications: Classification[]
}

export interface PlanNewFoldersResult {
  newFolders: NewFolderSpec[]
  candidates: CategoryCandidate[]
  classifications: Classification[]
}

/**
 * 把主题簇变成「新建目录 + 书签落位」。
 *
 * 三条硬约束（见 issues/13-additive-mode-design.md）：
 *
 * 1. **一律挂在范围根下。** 不做「挂进语义最近的已有目录」——那正是 prune 现在掉进去的坑
 *    （只看父子不看语义），而且判错了不好发现。放错了用户自己拖一下就行。
 * 2. **编号跟随已有做法。** 范围根的直接子目录带编号就接着最大号往后编，都不带就不编。
 *    **绝不重排已有目录的号**——`renumberPlan` 在非推翻模式下直接返回，全树重排的路不走。
 * 3. **一个改名都不产出。** 新建目录这件事不能让任何已有目录改名，那是幂等性的最后一道闸。
 *
 * 落位是确定性的：簇成员直接进以它命名的目录，不再花一次重分类调用——那个目录本来就是
 * 按这批书签的主题起的名，再问一遍模型是同义反复。
 */
export function planNewFolders(input: PlanNewFoldersInput): PlanNewFoldersResult {
  const root = input.folders.find((f) => f.id === input.rootId)
  const rootPath = root === undefined ? [] : [...root.path, root.title]

  // 只看范围根的直接子目录：更深层的编号是别人的习惯，不代表这一层
  const siblings = input.folders.filter((f) => f.parentId === input.rootId)
  const numbers = siblings.map((f) => folderNumber(f.title)).filter((n): n is number => n !== null)
  const startNumber = numbers.length === 0 ? null : Math.floor(Math.max(...numbers)) + 1

  // 上限只约束本轮新建的：已有目录是用户的，撑爆了也只报告不改动。
  // 这里先用现成的同层上限兜住，清单第 5 项的形状推导落地后换成按 homeless 数量推导。
  const chosen = input.clusters.slice(0, MAX_SIBLINGS)

  const newFolders: NewFolderSpec[] = []
  const candidates: CategoryCandidate[] = []
  const targetByBookmark = new Map<string, string>()

  chosen.forEach((cluster, index) => {
    const name = input.names.get(cluster.key) ?? cluster.title
    const title = startNumber === null
      ? name
      : `${String(startNumber + index).padStart(2, '0')} ${name}`
    const temporaryId = `new:${index + 1}`
    newFolders.push({ temporaryId, parentId: input.rootId, parentTemporaryId: null, title })
    candidates.push({ id: temporaryId, path: [...rootPath, title] })
    for (const bookmarkId of cluster.bookmarkIds) targetByBookmark.set(bookmarkId, temporaryId)
  })

  const classifications = input.classifications.map((c) => {
    const target = targetByBookmark.get(c.bookmarkId)
    if (target === undefined || c.targetCategoryId !== null) return c
    // topic 已经兑现成目录了，不再往下游传——留着会让复核页显示一个已经不成立的「无归属」
    const { topic: _topic, ...rest } = c
    return { ...rest, targetCategoryId: target, confidence: 1 }
  })

  return { newFolders, candidates, classifications }
}
