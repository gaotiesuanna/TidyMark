import { describe, it, expect } from 'vitest'
import { clusterHomeless, MIN_NEW_FOLDER_SIZE, planNewFolders } from '@/core/newTopics'
import { MAX_SIBLINGS } from '@/core/tree'
import type { BookmarkItem, Classification } from '@/core/types'
import type { FolderItem } from '@/core/types'

function homeless(id: string, topic?: string): Classification {
  return {
    bookmarkId: id, targetCategoryId: null, confidence: 0, reason: '无合适目录', source: 'llm',
    ...(topic === undefined ? {} : { topic }),
  }
}

function placed(id: string, topic?: string): Classification {
  return {
    bookmarkId: id, targetCategoryId: '10', confidence: 0.9, reason: 'r', source: 'llm',
    ...(topic === undefined ? {} : { topic }),
  }
}

describe('clusterHomeless', () => {
  it('攒够下限的主题成簇', () => {
    const clusters = clusterHomeless([homeless('1', '语音合成'), homeless('2', '语音合成'), homeless('3', '语音合成')])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!).toMatchObject({ title: '语音合成', bookmarkIds: ['1', '2', '3'] })
  })

  it('攒不够下限的主题不成簇——那批书签原地不动', () => {
    const clusters = clusterHomeless([homeless('1', '语音合成'), homeless('2', '语音合成')])
    expect(clusters).toEqual([])
  })

  it('归一化后同义的主题并成一簇', () => {
    const clusters = clusterHomeless([
      homeless('1', '语音合成'), homeless('2', '语音 合成'), homeless('3', '语音_合成'),
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.bookmarkIds).toEqual(['1', '2', '3'])
  })

  it('簇名取出现次数最多的原始写法，同票数取先出现的', () => {
    const clusters = clusterHomeless([
      homeless('1', '语音 合成'), homeless('2', '语音合成'), homeless('3', '语音合成'),
    ])
    expect(clusters[0]!.title).toBe('语音合成')
  })

  it('已有归属的书签不参与——它们不需要新目录', () => {
    const clusters = clusterHomeless([
      placed('1', '语音合成'), placed('2', '语音合成'), placed('3', '语音合成'),
    ])
    expect(clusters).toEqual([])
  })

  it('没带 topic 的无归属书签不参与', () => {
    const clusters = clusterHomeless([homeless('1'), homeless('2'), homeless('3')])
    expect(clusters).toEqual([])
  })

  it('空白的 topic 当没给', () => {
    const clusters = clusterHomeless([homeless('1', '  '), homeless('2', '  '), homeless('3', '')])
    expect(clusters).toEqual([])
  })

  // 三条都用同一个纯编号 topic：如果过滤是假的（例如三条 topic 各不相同、
  // 每个桶本来就攒不够 minSize），这条用例也会「碰巧」通过而验不出问题。
  it('纯编号的 topic 当没给——1.2 剥完前缀剩的纯数字也算', () => {
    expect(clusterHomeless([homeless('1', '01 '), homeless('2', '01 '), homeless('3', '01 ')])).toEqual([])
    expect(clusterHomeless([homeless('1', '2024'), homeless('2', '2024'), homeless('3', '2024')])).toEqual([])
    expect(clusterHomeless([homeless('1', '1.2 '), homeless('2', '1.2 '), homeless('3', '1.2 ')])).toEqual([])
  })

  it('带字母或汉字的编号前缀不算纯数字，照常成簇', () => {
    const clusters = clusterHomeless([homeless('1', '3D打印'), homeless('2', '3D打印'), homeless('3', '3D打印')])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.title).toBe('3D打印')
  })

  it('簇名剥掉模型可能带上的编号前缀', () => {
    const clusters = clusterHomeless([homeless('1', '01 语音合成'), homeless('2', '01 语音合成'), homeless('3', '01 语音合成')])
    expect(clusters[0]!.title).toBe('语音合成')
  })

  it('多个簇按大小降序，同样大小按首次出现顺序——同样的输入必须产出同样的顺序', () => {
    const clusters = clusterHomeless([
      homeless('1', 'A'), homeless('2', 'B'), homeless('3', 'B'), homeless('4', 'A'),
      homeless('5', 'B'), homeless('6', 'A'), homeless('7', 'A'),
    ])
    expect(clusters.map((c) => c.title)).toEqual(['A', 'B'])
    expect(clusters[0]!.bookmarkIds).toEqual(['1', '4', '6', '7'])
  })

  it('下限可以覆盖', () => {
    expect(clusterHomeless([homeless('1', 'A'), homeless('2', 'A')], 2)).toHaveLength(1)
  })

  it('默认下限是 3', () => {
    expect(MIN_NEW_FOLDER_SIZE).toBe(3)
  })
})

function folder(id: string, title: string, parentId: string | null, path: string[] = []): FolderItem {
  return { id, title, parentId, index: 0, path, depth: 1, level: 1 }
}

/** 松散挂在 parentId 下的书签——用于喂 planNewFolders 判断「是否已经聚齐」。 */
function bm(id: string, parentId: string): BookmarkItem {
  return { id, title: id, url: `https://${id}.dev`, parentId, index: 0, currentPath: [] }
}

describe('planNewFolders', () => {
  const clusters = [
    { key: '语音合成', title: '语音合成', bookmarkIds: ['1', '2', '3'] },
    { key: '数据竞赛', title: '数据竞赛', bookmarkIds: ['4', '5'] },
  ]
  const names = new Map([['语音合成', '语音与音频'], ['数据竞赛', '竞赛数据']])
  const homelessAll: Classification[] = ['1', '2', '3', '4', '5', '9'].map((id) => ({
    bookmarkId: id, targetCategoryId: null, confidence: 0, reason: '无合适目录', source: 'llm' as const,
  }))
  // 全部松散挂在范围根下：guard 不该拦这批——它们的父目录就是范围根本身
  const looseBookmarks = ['1', '2', '3', '4', '5', '9'].map((id) => bm(id, 'root'))

  it('每个簇建一个目录，一律挂在范围根下', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root', folders: [folder('root', '书签栏', null)],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    expect(out.newFolders).toHaveLength(2)
    expect(out.newFolders.every((f) => f.parentId === 'root' && f.parentTemporaryId === null)).toBe(true)
  })

  it('已有直接子目录带编号时，新目录接着最大号往后编', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', '01 GitHub', 'root'), folder('b', '07 其他', 'root')],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    expect(out.newFolders.map((f) => f.title)).toEqual(['08 语音与音频', '09 竞赛数据'])
  })

  it('已有直接子目录都不带编号时，新目录也不编号', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', 'GitHub', 'root')],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    expect(out.newFolders.map((f) => f.title)).toEqual(['语音与音频', '竞赛数据'])
  })

  it('只看范围根的直接子目录，不看更深层的编号', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', 'GitHub', 'root'), folder('b', '05 深处', 'a')],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    expect(out.newFolders[0]!.title).toBe('语音与音频')
  })

  it('簇成员被直接落进新目录，不必再问一次模型', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root', folders: [folder('root', '书签栏', null)],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    const id = out.newFolders[0]!.temporaryId
    for (const b of ['1', '2', '3']) {
      expect(out.classifications.find((c) => c.bookmarkId === b)).toMatchObject({
        targetCategoryId: id, source: 'llm', confidence: 1,
      })
    }
  })

  it('不属于任何簇的无归属书签原样留着', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root', folders: [folder('root', '书签栏', null)],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    expect(out.classifications.find((c) => c.bookmarkId === '9')).toMatchObject({ targetCategoryId: null })
  })

  it('新目录同时成为候选，复核页与后续步骤才认得它', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', '01 GitHub', 'root')],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    expect(out.candidates.map((c) => c.path.join('/'))).toEqual([
      '书签栏/02 语音与音频', '书签栏/03 竞赛数据',
    ])
    expect(out.candidates[0]!.id).toBe(out.newFolders[0]!.temporaryId)
  })

  // 这个 fixture 里 root 自己的 path 是 ['书签栏']，但 scanTree 里任何真正的范围根
  // 都是以 path: [] 被扫描到的（见 scan.ts 的 `walk(root, [], 0)`）——所以这条用例
  // 记录的是公式本身（范围根的 path 拼上它自己的 title，再拼上新目录名），而不是一个
  // 生产环境里真的会出现的状态。
  it('新目录路径接在范围根的路径后面', () => {
    const out = planNewFolders({
      clusters: [clusters[0]!], names, rootId: 'sub',
      folders: [folder('sub', '子目录', 'root', ['书签栏'])],
      classifications: homelessAll, bookmarks: ['1', '2', '3'].map((id) => bm(id, 'sub')), locale: 'zh_CN',
    })
    expect(out.candidates[0]!.path).toEqual(['书签栏', '子目录', '语音与音频'])
  })

  it('簇数超过同层上限时只取最大的那些，超出的数量报给调用方', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      key: `k${i}`, title: `T${i}`, bookmarkIds: [`${i}a`, `${i}b`, `${i}c`],
    }))
    const manyBookmarks = many.flatMap((c) => c.bookmarkIds.map((id) => bm(id, 'root')))
    const manyNames = new Map(many.map((c) => [c.key, c.title]))
    const out = planNewFolders({
      clusters: many, names: manyNames, rootId: 'root',
      folders: [folder('root', '书签栏', null)], classifications: [], bookmarks: manyBookmarks, locale: 'zh_CN',
    })
    expect(out.newFolders).toHaveLength(MAX_SIBLINGS)
    expect(out.truncatedCount).toBe(15 - MAX_SIBLINGS)
  })

  it('没有簇时什么都不产出', () => {
    const out = planNewFolders({
      clusters: [], names: new Map(), rootId: 'root',
      folders: [folder('root', '书签栏', null)], classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    expect(out.newFolders).toEqual([])
    expect(out.candidates).toEqual([])
    expect(out.classifications).toEqual(homelessAll)
    expect(out.placedCount).toBe(0)
    expect(out.truncatedCount).toBe(0)
  })

  it('绝不产出任何改名——幂等性的最后一道闸', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', '01 GitHub', 'root')],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    // 返回结构里根本没有 renameFolders 这一项，已有目录的 id 也不出现在任何新建规格里
    expect(out.newFolders.some((f) => f.parentId === 'a')).toBe(false)
    expect((out as unknown as { renameFolders?: unknown }).renameFolders).toBeUndefined()
  })

  it('落位的 classification 讲清楚为什么，不再是模型那句「无合适目录」', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root', folders: [folder('root', '书签栏', null)],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    const row = out.classifications.find((c) => c.bookmarkId === '1')!
    expect(row.reason).toContain('语音与音频')
    expect(row.reason).not.toBe('无合适目录')
  })

  it('英文 locale 下落位理由也是英文', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root', folders: [folder('root', '书签栏', null)],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'en',
    })
    const row = out.classifications.find((c) => c.bookmarkId === '1')!
    expect(row.reason).toContain('语音与音频')
    expect(row.reason.toLowerCase()).toContain('placed in new folder')
  })

  it('命名阶段被跳过的簇（names 里没有它的 key）不建目录，书签留在原地', () => {
    const namesMissingOne = new Map([['数据竞赛', '竞赛数据']]) // '语音合成' 撞名被 nameNewTopics 跳过了
    const out = planNewFolders({
      clusters, names: namesMissingOne, rootId: 'root', folders: [folder('root', '书签栏', null)],
      classifications: homelessAll, bookmarks: looseBookmarks, locale: 'zh_CN',
    })
    expect(out.newFolders.map((f) => f.title)).toEqual(['竞赛数据'])
    for (const id of ['1', '2', '3']) {
      expect(out.classifications.find((c) => c.bookmarkId === id)).toMatchObject({ targetCategoryId: null })
    }
    expect(out.placedCount).toBe(2)
  })

  describe('已聚齐的簇不再建目录（幂等性第四道闸，见 review C1）', () => {
    it('簇成员已经全挤在范围内同一个非根目录下——不建新目录，书签原地不动', () => {
      const alreadyGrouped = ['1', '2', '3'].map((id) => bm(id, 'existing'))
      const out = planNewFolders({
        clusters: [clusters[0]!], names, rootId: 'root',
        folders: [folder('root', '书签栏', null), folder('existing', '语音合成', 'root')],
        classifications: homelessAll.filter((c) => ['1', '2', '3'].includes(c.bookmarkId)),
        bookmarks: alreadyGrouped, locale: 'zh_CN',
      })
      expect(out.newFolders).toEqual([])
      expect(out.classifications.every((c) => c.targetCategoryId === null)).toBe(true)
    })

    it('书签松散挂在范围根下不算已聚齐——guard 不能拦住真正无处可去的书签', () => {
      const out = planNewFolders({
        clusters: [clusters[0]!], names, rootId: 'root',
        folders: [folder('root', '书签栏', null)],
        classifications: homelessAll.filter((c) => ['1', '2', '3'].includes(c.bookmarkId)),
        bookmarks: ['1', '2', '3'].map((id) => bm(id, 'root')), locale: 'zh_CN',
      })
      expect(out.newFolders).toHaveLength(1)
    })

    it('簇成员分散在不同父目录下——不算已聚齐，照常建目录', () => {
      const out = planNewFolders({
        clusters: [clusters[0]!], names, rootId: 'root',
        folders: [folder('root', '书签栏', null), folder('a', 'A', 'root'), folder('b', 'B', 'root')],
        classifications: homelessAll.filter((c) => ['1', '2', '3'].includes(c.bookmarkId)),
        bookmarks: [bm('1', 'a'), bm('2', 'a'), bm('3', 'b')], locale: 'zh_CN',
      })
      expect(out.newFolders).toHaveLength(1)
    })

    it('找不到书签归属信息时不拦——宁可多建一次也不误伤', () => {
      const out = planNewFolders({
        clusters: [clusters[0]!], names, rootId: 'root',
        folders: [folder('root', '书签栏', null), folder('existing', '语音合成', 'root')],
        classifications: homelessAll.filter((c) => ['1', '2', '3'].includes(c.bookmarkId)),
        bookmarks: [], locale: 'zh_CN',
      })
      expect(out.newFolders).toHaveLength(1)
    })
  })
})
