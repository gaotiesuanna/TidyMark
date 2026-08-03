import { describe, it, expect } from 'vitest'
import { collectTopics, applyDesign, type FolderDesign } from '@/llm/folders'
import { NO_TOPIC } from '@/llm/tags'
import type { TagResult } from '@/core/types'

function tag(bookmarkId: string, primaryTopic: string): TagResult {
  return { bookmarkId, primaryTopic, secondaryTopic: null }
}

function design(entries: Array<[string, string[]]>, folders: FolderDesign['folders'] = []): FolderDesign {
  return { folders, mapping: new Map(entries) }
}

describe('collectTopics', () => {
  it('按标签去重并计数，数量从多到少', () => {
    const result = collectTopics([tag('1', 'AI'), tag('2', 'React'), tag('3', 'React')])
    expect(result).toEqual([{ topic: 'React', count: 2 }, { topic: 'AI', count: 1 }])
  })

  it('大小写与空格不同的写法算同一个标签，保留首次出现的写法', () => {
    const result = collectTopics([tag('1', 'LLM'), tag('2', 'l l m')])
    expect(result).toEqual([{ topic: 'LLM', count: 2 }])
  })

  it('空主题不计入', () => {
    expect(collectTopics([tag('1', NO_TOPIC), tag('2', 'AI')])).toEqual([{ topic: 'AI', count: 1 }])
  })
})

describe('applyDesign', () => {
  it('一层路径写进 primaryTopic，secondaryTopic 为 null', () => {
    const result = applyDesign([tag('1', 'Claude')], design([['claude', ['Claude Code']]]))
    expect(result).toEqual([{ bookmarkId: '1', primaryTopic: 'Claude Code', secondaryTopic: null }])
  })

  it('两层路径分别写进 primaryTopic 与 secondaryTopic', () => {
    const result = applyDesign([tag('1', 'rag')], design([['rag', ['AI 工程', 'RAG 检索']]]))
    expect(result[0]).toEqual({ bookmarkId: '1', primaryTopic: 'AI 工程', secondaryTopic: 'RAG 检索' })
  })

  it('同义标签归并到同一个目录', () => {
    const d = design([['claudecode', ['Claude Code']], ['cc工作流', ['Claude Code']]])
    const result = applyDesign([tag('1', 'Claude Code'), tag('2', 'CC 工作流')], d)
    expect(result.map((t) => t.primaryTopic)).toEqual(['Claude Code', 'Claude Code'])
  })

  it('查表用归一化后的名字，大小写空格不影响命中', () => {
    const result = applyDesign([tag('1', 'L L M')], design([['llm', ['LLM 原理']]]))
    expect(result[0]!.primaryTopic).toBe('LLM 原理')
  })

  it('没被映射的标签置空，不参与建树', () => {
    const result = applyDesign([tag('1', '冷门标签')], design([['别的', ['某目录']]]))
    expect(result[0]).toEqual({ bookmarkId: '1', primaryTopic: NO_TOPIC, secondaryTopic: null })
  })

  it('原本就是空主题的标签保持为空', () => {
    const result = applyDesign([tag('1', NO_TOPIC)], design([['x', ['某目录']]]))
    expect(result[0]!.primaryTopic).toBe(NO_TOPIC)
  })

  it('保持输入顺序与条数', () => {
    const input = [tag('1', 'a'), tag('2', 'b'), tag('3', 'c')]
    const result = applyDesign(input, design([['b', ['B']]]))
    expect(result.map((t) => t.bookmarkId)).toEqual(['1', '2', '3'])
  })
})
