import { describe, it, expect, vi } from 'vitest'
import { collectTopics, applyDesign, designFolders, type FolderDesign } from '@/llm/folders'
import { NO_TOPIC } from '@/llm/tags'
import type { TagResult } from '@/core/types'
import { MAX_SIBLINGS } from '@/core/tree'

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

describe('designFolders', () => {
  const topics = [{ topic: 'Claude Code', count: 3 }, { topic: 'CC 工作流', count: 1 }]

  it('把模型返回的目录树转成 folders + mapping', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'Claude Code', topics: ['Claude Code', 'CC 工作流'], children: [] }],
    })
    const result = await designFolders(topics, { complete })
    expect(result!.folders).toEqual([{ title: 'Claude Code', children: [] }])
    expect(result!.mapping.get('claudecode')).toEqual(['Claude Code'])
    expect(result!.mapping.get('cc工作流')).toEqual(['Claude Code'])
  })

  it('二级目录下的标签映射成两段路径', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{
        title: 'AI 工程', topics: [],
        children: [{ title: 'RAG 检索', topics: ['rag'] }],
      }],
    })
    const result = await designFolders([{ topic: 'rag', count: 2 }], { complete })
    expect(result!.folders).toEqual([{ title: 'AI 工程', children: ['RAG 检索'] }])
    expect(result!.mapping.get('rag')).toEqual(['AI 工程', 'RAG 检索'])
  })

  it('一级目录超过上限时截断，被截掉的标签不进 mapping', async () => {
    const many = Array.from({ length: MAX_SIBLINGS + 3 }, (_, i) => ({
      title: `目录${i}`, topics: [`标签${i}`], children: [],
    }))
    const complete = vi.fn().mockResolvedValue({ folders: many })
    const result = await designFolders(topics, { complete })
    expect(result!.folders).toHaveLength(MAX_SIBLINGS)
    expect(result!.mapping.has(`标签${MAX_SIBLINGS + 1}`)).toBe(false)
  })

  it('oneLevel 时把子目录的标签并进父目录，不产生二级路径', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: '文档解析', topics: ['pdf'], children: [{ title: '深层', topics: ['ocr'] }] }],
    })
    const result = await designFolders([{ topic: 'pdf', count: 1 }], { complete }, { oneLevel: true })
    expect(result!.folders).toEqual([{ title: '文档解析', children: [] }])
    expect(result!.mapping.get('ocr')).toEqual(['文档解析'])
  })

  it('调用失败时返回 null，不抛错', async () => {
    const complete = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { retryable: false }))
    expect(await designFolders(topics, { complete })).toBeNull()
  })

  it('模型没返回任何目录时也返回 null', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    expect(await designFolders(topics, { complete })).toBeNull()
  })

  it('标签清单为空时不发请求', async () => {
    const complete = vi.fn()
    expect(await designFolders([], { complete })).toBeNull()
    expect(complete).not.toHaveBeenCalled()
  })

  it('提示词带上标签与书签数，并禁用宽泛词', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    await designFolders(topics, { complete })
    const prompt = complete.mock.calls[0]![0] as string
    expect(prompt).toContain('Claude Code')
    expect(prompt).toContain('禁止')
    expect(prompt).toContain(String(MAX_SIBLINGS))
  })

  it('oneLevel 时提示词点名父目录并要求只出一层', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    await designFolders(topics, { complete }, { oneLevel: true, parentTitle: 'GitHub' })
    const prompt = complete.mock.calls[0]![0] as string
    expect(prompt).toContain('GitHub')
    expect(prompt).toContain('只输出一层')
  })
})
