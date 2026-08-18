import { describe, it, expect } from 'vitest'
import { clusterHomeless, MIN_NEW_FOLDER_SIZE } from '@/core/newTopics'
import type { Classification } from '@/core/types'

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
