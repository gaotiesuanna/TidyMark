import { describe, it, expect, vi } from 'vitest'
import {
  collectTopics,
  applyDesign,
  designFolders as designFoldersRaw,
  designTagFolders as designTagFoldersRaw,
  nameMergedFolder,
  nameNewTopics,
  type FolderDesign,
  type DesignOptions,
} from '@/llm/folders'
import { NO_TOPIC } from '@/llm/tags'
import type { BookmarkItem, TagResult } from '@/core/types'
import type { LlmClient } from '@/llm/client'
import { MAX_SIBLINGS } from '@/core/tree'

function tag(bookmarkId: string, primaryTopic: string): TagResult {
  return { bookmarkId, primaryTopic, secondaryTopic: null }
}

/**
 * locale 现在是必填项，但本文件里的用例全部只关心中文分支。
 * 固定传 'zh_CN'，调用点不必逐个重复。
 */
function designFolders(
  topics: Array<{ topic: string; count: number }>,
  client: LlmClient,
  options?: DesignOptions,
): Promise<FolderDesign | null> {
  return designFoldersRaw(topics, client, 'zh_CN', options)
}

function designTagFolders(
  tags: TagResult[],
  bookmarks: BookmarkItem[],
  domainGroups: string[],
  client: LlmClient,
  options?: DesignOptions,
): Promise<TagResult[]> {
  return designTagFoldersRaw(tags, bookmarks, domainGroups, client, 'zh_CN', options)
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

  it('非 oneLevel 时一级目录超过上限截断到 MAX_SIBLINGS - 1，给「其他」留位', async () => {
    const many = Array.from({ length: MAX_SIBLINGS + 3 }, (_, i) => ({
      title: `目录${i}`, topics: [`标签${i}`], children: [],
    }))
    const complete = vi.fn().mockResolvedValue({ folders: many })
    const result = await designFolders(topics, { complete })
    expect(result!.folders).toHaveLength(MAX_SIBLINGS - 1)
    expect(result!.mapping.has(`标签${MAX_SIBLINGS - 1}`)).toBe(false)
  })

  it('oneLevel 时子目录超过上限仍按 MAX_SIBLINGS 截断，不留「其他」位', async () => {
    const many = Array.from({ length: MAX_SIBLINGS + 3 }, (_, i) => ({
      title: `目录${i}`, topics: [`标签${i}`], children: [],
    }))
    const complete = vi.fn().mockResolvedValue({ folders: many })
    const result = await designFolders(topics, { complete }, { oneLevel: true })
    expect(result!.folders).toHaveLength(MAX_SIBLINGS)
    expect(result!.mapping.has(`标签${MAX_SIBLINGS + 1}`)).toBe(false)
  })

  it('maxTopFolders 覆盖截断上限，非 oneLevel 时仍给「其他」留位', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `目录${i}`, topics: [`标签${i}`], children: [],
    }))
    const complete = vi.fn().mockResolvedValue({ folders: many })
    const result = await designFolders(topics, { complete }, { maxTopFolders: 5 })
    expect(result!.folders).toHaveLength(4)
  })

  // 上限只写进 slice 不写进提示词的话，模型仍会按 12 个来设计，
  // 多出来的目录在这里被静默截掉，等于白花了 token
  it('maxTopFolders 写进提示词文本', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    await designFolders(topics, { complete }, { maxTopFolders: 5 })
    expect(complete.mock.calls[0]![0]).toContain('一级目录不超过 4 个')
  })

  // 下限不写进提示词的话，模型照样设计出一堆独苗目录，全靠后面两道兜底去撤，
  // 等于白花了 token 又把结果推向「其他」
  it('minFolderSize 写进提示词文本', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    await designFolders(topics, { complete }, { minFolderSize: 3 })
    expect(complete.mock.calls[0]![0]).toContain('不到 3 个书签')
  })

  it('不传 minFolderSize 时提示词里没有这条', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    await designFolders(topics, { complete })
    expect(complete.mock.calls[0]![0]).not.toContain('个书签的目录')
  })

  it('folders 不是数组时返回 null，不抛错', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: { oops: true } })
    await expect(designFolders(topics, { complete })).resolves.toBeNull()
  })

  it('folder 元素为 null 时返回 null，不抛错', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [null] })
    await expect(designFolders(topics, { complete })).resolves.toBeNull()
  })

  it('folder 缺少 title 或 topics 不是数组时返回 null，不抛错', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [{ topics: 'oops', children: [] }] })
    await expect(designFolders(topics, { complete })).resolves.toBeNull()
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
    expect(prompt).toContain(String(MAX_SIBLINGS - 1))
  })

  it('oneLevel 时提示词点名父目录并要求只出一层', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    await designFolders(topics, { complete }, { oneLevel: true, parentTitle: 'GitHub' })
    const prompt = complete.mock.calls[0]![0] as string
    expect(prompt).toContain('GitHub')
    expect(prompt).toContain('只输出一层')
  })

  it('标签被多个目录同时声明时取最后一个，并汇总一条警告日志', async () => {
    const onLog = vi.fn()
    const complete = vi.fn().mockResolvedValue({
      folders: [
        { title: 'A', topics: ['x'], children: [] },
        { title: 'B', topics: ['x'], children: [] },
      ],
    })
    const result = await designFolders(topics, { complete }, { onLog })
    expect(result!.mapping.get('x')).toEqual(['B'])
    const warnCalls = onLog.mock.calls.filter(([, level]) => level === 'warn')
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0]![0]).toContain('x')
    expect(warnCalls[0]![0]).toContain('2')
  })

  it('没有重复声明时不产生警告日志', async () => {
    const onLog = vi.fn()
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'A', topics: ['x'], children: [] }],
    })
    await designFolders(topics, { complete }, { onLog })
    expect(onLog.mock.calls.some(([, level]) => level === 'warn')).toBe(false)
  })
})

describe('designTagFolders', () => {
  const item = (id: string, url: string): BookmarkItem => ({
    id, title: 'T' + id, url, parentId: '1', index: 0, currentPath: ['书签栏'],
  })
  const gh = (id: string) => item(id, `https://github.com/o/r${id}`)
  const blog = (id: string) => item(id, `https://example.com/${id}`)

  it('没勾选聚合组时，全部标签走一次设计', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'LLM 原理', topics: ['KV Cache', '注意力机制'], children: [] }],
    })
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '注意力机制')],
      [blog('1'), blog('2')], [], { complete },
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.map((t) => t.primaryTopic)).toEqual(['LLM 原理', 'LLM 原理'])
  })

  it('命中聚合组的书签单独设计，且不进一级目录那次请求', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }] })
      .mockResolvedValueOnce({ folders: [{ title: 'Agent 框架', topics: ['智能体框架'], children: [] }] })
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '智能体框架')],
      [blog('1'), gh('2')], ['github'], { complete },
    )
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[0]![0]).not.toContain('智能体框架')
    expect(result[0]!.primaryTopic).toBe('LLM 原理')
    expect(result[1]!.primaryTopic).toBe('Agent 框架')
  })

  it('聚合组那次调用限一层', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    await designTagFolders([tag('2', '智能体框架')], [gh('2')], ['github'], { complete })
    expect(complete.mock.calls[0]![0]).toContain('只输出一层')
    expect(complete.mock.calls[0]![0]).toContain('GitHub')
  })

  it('某一次设计失败时，该批标签原样保留，其余照常归并', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }] })
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: false }))
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '智能体框架')],
      [blog('1'), gh('2')], ['github'], { complete },
    )
    expect(result[0]!.primaryTopic).toBe('LLM 原理')
    expect(result[1]!.primaryTopic).toBe('智能体框架')
  })

  it('保持输入顺序与条数', async () => {
    const complete = vi.fn().mockResolvedValue({ folders: [] })
    const result = await designTagFolders(
      [tag('1', 'a'), tag('2', 'b')], [blog('1'), gh('2')], ['github'], { complete },
    )
    expect(result.map((t) => t.bookmarkId)).toEqual(['1', '2'])
  })

  it('标签全空时不发请求', async () => {
    const complete = vi.fn()
    const result = await designTagFolders([tag('1', NO_TOPIC)], [blog('1')], [], { complete })
    expect(complete).not.toHaveBeenCalled()
    expect(result[0]!.primaryTopic).toBe(NO_TOPIC)
  })

  it('取消后跳过剩余摊子，已发出的那摊结果仍然生效，未处理的摊子原样保留', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }],
    })
    let cancelled = false
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '智能体框架')],
      [blog('1'), gh('2')], ['github'], { complete },
      {
        isCancelled: () => {
          const value = cancelled
          cancelled = true
          return value
        },
      },
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result[0]!.primaryTopic).toBe('LLM 原理')
    expect(result[1]!.primaryTopic).toBe('智能体框架')
  })

  it('同一个 bookmarkId 出现两次时，两条各自独立映射，不互相覆盖', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [
        { title: 'A', topics: ['a'], children: [] },
        { title: 'B', topics: ['b'], children: [] },
      ],
    })
    const result = await designTagFolders(
      [tag('1', 'a'), tag('1', 'b')], [blog('1')], [], { complete },
    )
    expect(result[0]!.primaryTopic).toBe('A')
    expect(result[1]!.primaryTopic).toBe('B')
  })
})

describe('nameMergedFolder', () => {
  const topics = [{ topic: '前端', count: 10 }, { topic: '大模型', count: 6 }]

  it('返回模型给的名字', async () => {
    const client = { complete: vi.fn().mockResolvedValue({ name: 'AI 与前端' }) }
    const name = await nameMergedFolder(topics, ['NiceG', 'b_llm'], client, 'zh_CN')
    expect(name).toBe('AI 与前端')
  })

  it('提示词里带上源目录名与主题', async () => {
    const complete = vi.fn().mockResolvedValue({ name: 'X' })
    await nameMergedFolder(topics, ['NiceG', 'b_llm'], { complete }, 'zh_CN')
    const prompt = JSON.stringify(complete.mock.calls[0])
    expect(prompt).toContain('NiceG')
    expect(prompt).toContain('b_llm')
    expect(prompt).toContain('前端')
  })

  it('请求失败返回 null', async () => {
    const client = { complete: vi.fn().mockRejectedValue(new Error('boom')) }
    expect(await nameMergedFolder(topics, ['a', 'b'], client, 'zh_CN')).toBeNull()
  })

  it('模型返回空名字时返回 null', async () => {
    const client = { complete: vi.fn().mockResolvedValue({ name: '   ' }) }
    expect(await nameMergedFolder(topics, ['a', 'b'], client, 'zh_CN')).toBeNull()
  })

  it('没有主题时不发请求', async () => {
    const complete = vi.fn()
    expect(await nameMergedFolder([], ['a', 'b'], { complete }, 'zh_CN')).toBeNull()
    expect(complete).not.toHaveBeenCalled()
  })

  it('返回的名字去掉编号前缀与首尾空白', async () => {
    const client = { complete: vi.fn().mockResolvedValue({ name: ' 01 AI 学习 ' }) }
    expect(await nameMergedFolder(topics, ['a', 'b'], client, 'zh_CN')).toBe('AI 学习')
  })
})

describe('nameNewTopics', () => {
  const clusters = [
    { key: '语音合成', title: '语音合成', bookmarkIds: ['1', '2', '3'] },
    { key: '数据竞赛', title: '数据竞赛', bookmarkIds: ['4', '5', '6'] },
  ]

  it('每个簇都拿到模型给的名字', async () => {
    const client = {
      complete: vi.fn().mockResolvedValue({
        names: [{ key: '语音合成', name: '语音与音频' }, { key: '数据竞赛', name: '竞赛与数据集' }],
      }),
    }
    const names = await nameNewTopics(clusters, ['01 GitHub'], client, 'zh_CN')
    expect(names.get('语音合成')).toBe('语音与音频')
    expect(names.get('数据竞赛')).toBe('竞赛与数据集')
  })

  it('模型漏了某个簇，那个簇退回自己的主题名', async () => {
    const client = { complete: vi.fn().mockResolvedValue({ names: [{ key: '语音合成', name: '语音与音频' }] }) }
    const names = await nameNewTopics(clusters, [], client, 'zh_CN')
    expect(names.get('数据竞赛')).toBe('数据竞赛')
  })

  it('整个调用失败时全部退回主题名，不抛出——一次起名失败不该毁掉整次分析', async () => {
    const client = { complete: vi.fn().mockRejectedValue(new Error('boom')) }
    const names = await nameNewTopics(clusters, [], client, 'zh_CN')
    expect(names.get('语音合成')).toBe('语音合成')
    expect(names.get('数据竞赛')).toBe('数据竞赛')
  })

  it('模型给的名字撞上已有目录名时退回主题名——新目录绝不能与已有目录重名', async () => {
    const client = { complete: vi.fn().mockResolvedValue({ names: [{ key: '语音合成', name: '01 GitHub' }] }) }
    const names = await nameNewTopics(clusters, ['01 GitHub'], client, 'zh_CN')
    expect(names.get('语音合成')).toBe('语音合成')
  })

  it('两个簇拿到同一个名字时，后一个退回自己的主题名', async () => {
    const client = {
      complete: vi.fn().mockResolvedValue({
        names: [{ key: '语音合成', name: '通用' }, { key: '数据竞赛', name: '通用' }],
      }),
    }
    const names = await nameNewTopics(clusters, [], client, 'zh_CN')
    expect(names.get('语音合成')).toBe('通用')
    expect(names.get('数据竞赛')).toBe('数据竞赛')
  })

  it('剥掉模型带上的编号前缀', async () => {
    const client = { complete: vi.fn().mockResolvedValue({ names: [{ key: '语音合成', name: '07 语音与音频' }] }) }
    const names = await nameNewTopics(clusters, [], client, 'zh_CN')
    expect(names.get('语音合成')).toBe('语音与音频')
  })

  it('没有簇时一次调用都不发', async () => {
    const complete = vi.fn()
    const names = await nameNewTopics([], [], { complete }, 'zh_CN')
    expect(complete).not.toHaveBeenCalled()
    expect(names.size).toBe(0)
  })
})
