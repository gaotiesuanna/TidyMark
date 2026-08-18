import { describe, it, expect } from 'vitest'
import { clusterHomeless, MIN_NEW_FOLDER_SIZE, planNewFolders } from '@/core/newTopics'
import { MAX_SIBLINGS } from '@/core/tree'
import type { Classification } from '@/core/types'
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

  it('空白与纯编号的 topic 当没给', () => {
    const clusters = clusterHomeless([homeless('1', '  '), homeless('2', '01 '), homeless('3', '')])
    expect(clusters).toEqual([])
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

describe('planNewFolders', () => {
  const clusters = [
    { key: '语音合成', title: '语音合成', bookmarkIds: ['1', '2', '3'] },
    { key: '数据竞赛', title: '数据竞赛', bookmarkIds: ['4', '5'] },
  ]
  const names = new Map([['语音合成', '语音与音频'], ['数据竞赛', '竞赛数据']])
  const homelessAll: Classification[] = ['1', '2', '3', '4', '5', '9'].map((id) => ({
    bookmarkId: id, targetCategoryId: null, confidence: 0, reason: '无合适目录', source: 'llm' as const,
  }))

  it('每个簇建一个目录，一律挂在范围根下', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root', folders: [folder('root', '书签栏', null)], classifications: homelessAll,
    })
    expect(out.newFolders).toHaveLength(2)
    expect(out.newFolders.every((f) => f.parentId === 'root' && f.parentTemporaryId === null)).toBe(true)
  })

  it('已有直接子目录带编号时，新目录接着最大号往后编', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', '01 GitHub', 'root'), folder('b', '07 其他', 'root')],
      classifications: homelessAll,
    })
    expect(out.newFolders.map((f) => f.title)).toEqual(['08 语音与音频', '09 竞赛数据'])
  })

  it('已有直接子目录都不带编号时，新目录也不编号', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', 'GitHub', 'root')],
      classifications: homelessAll,
    })
    expect(out.newFolders.map((f) => f.title)).toEqual(['语音与音频', '竞赛数据'])
  })

  it('只看范围根的直接子目录，不看更深层的编号', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', 'GitHub', 'root'), folder('b', '05 深处', 'a')],
      classifications: homelessAll,
    })
    expect(out.newFolders[0]!.title).toBe('语音与音频')
  })

  it('簇成员被直接落进新目录，不必再问一次模型', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root', folders: [folder('root', '书签栏', null)], classifications: homelessAll,
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
      clusters, names, rootId: 'root', folders: [folder('root', '书签栏', null)], classifications: homelessAll,
    })
    expect(out.classifications.find((c) => c.bookmarkId === '9')).toMatchObject({ targetCategoryId: null })
  })

  it('新目录同时成为候选，复核页与后续步骤才认得它', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', '01 GitHub', 'root')],
      classifications: homelessAll,
    })
    expect(out.candidates.map((c) => c.path.join('/'))).toEqual(['02 语音与音频', '03 竞赛数据'])
    expect(out.candidates[0]!.id).toBe(out.newFolders[0]!.temporaryId)
  })

  it('新目录路径接在范围根的路径后面', () => {
    const out = planNewFolders({
      clusters: [clusters[0]!], names, rootId: 'sub',
      folders: [folder('sub', '子目录', 'root', ['书签栏'])],
      classifications: homelessAll,
    })
    expect(out.candidates[0]!.path).toEqual(['书签栏', '子目录', '语音与音频'])
  })

  it('簇数超过同层上限时只取最大的那些', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      key: `k${i}`, title: `T${i}`, bookmarkIds: [`${i}a`, `${i}b`, `${i}c`],
    }))
    const out = planNewFolders({
      clusters: many, names: new Map(), rootId: 'root',
      folders: [folder('root', '书签栏', null)], classifications: [],
    })
    expect(out.newFolders).toHaveLength(MAX_SIBLINGS)
  })

  it('没有簇时什么都不产出', () => {
    const out = planNewFolders({
      clusters: [], names: new Map(), rootId: 'root',
      folders: [folder('root', '书签栏', null)], classifications: homelessAll,
    })
    expect(out.newFolders).toEqual([])
    expect(out.candidates).toEqual([])
    expect(out.classifications).toEqual(homelessAll)
  })

  it('绝不产出任何改名——幂等性的最后一道闸', () => {
    const out = planNewFolders({
      clusters, names, rootId: 'root',
      folders: [folder('root', '书签栏', null), folder('a', '01 GitHub', 'root')],
      classifications: homelessAll,
    })
    // 返回结构里根本没有 renameFolders 这一项，已有目录的 id 也不出现在任何新建规格里
    expect(Object.keys(out)).toEqual(['newFolders', 'candidates', 'classifications'])
    expect(out.newFolders.some((f) => f.parentId === 'a')).toBe(false)
  })
})
