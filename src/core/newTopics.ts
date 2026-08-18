import { normalizeName, stripNumberPrefix } from './map'
import type { Classification } from './types'

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
