import { describe, it, expect, vi } from 'vitest'
import {
  collectTopics,
  applyDesign,
  designFolders as designFoldersRaw,
  designTagFolders as designTagFoldersRaw,
  nameMergedFolder,
  nameNewTopics,
  isCompoundName,
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

describe('isCompoundName', () => {
  it('中文用「与」「和」「、」捆起来的算复合名', () => {
    expect(isCompoundName('记忆与向量存储', 'zh_CN')).toBe(true)
    expect(isCompoundName('模型微调和部署', 'zh_CN')).toBe(true)
    expect(isCompoundName('前端、后端', 'zh_CN')).toBe(true)
  })

  it('连接词嵌在词里的不算——两侧各要求至少两个字', () => {
    // 「饱和度」是设计类书签里真实存在的目录名，误判它会让重问白跑一次
    expect(isCompoundName('饱和度', 'zh_CN')).toBe(false)
    expect(isCompoundName('语音合成', 'zh_CN')).toBe(false)
  })

  it('英文只认独立成词的 and / & / 斜杠', () => {
    expect(isCompoundName('Memory and vector storage', 'en')).toBe(true)
    expect(isCompoundName('Speech synthesis & cloning', 'en')).toBe(true)
    expect(isCompoundName('Design / research', 'en')).toBe(true)
  })

  it('不带空格的 & 放过——Q&A、AT&T 是一个概念', () => {
    expect(isCompoundName('Q&A', 'en')).toBe(false)
    expect(isCompoundName('Text-to-Speech', 'en')).toBe(false)
  })
})

describe('designFolders 的复合名重问', () => {
  // 这里用原始导出而非本文件顶部的中文便捷包装：重问用例要显式控制第 4 个参数
  // （onLog），包装函数的签名容不下它。
  const designFolders = designFoldersRaw
  const topics = [{ topic: 'KV Cache', count: 3 }]

  it('出现复合名时带着具体名字重问一次，用重问那一版', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: '记忆与向量存储', topics: ['KV Cache'], children: [] }] })
      .mockResolvedValueOnce({ folders: [{ title: '向量存储', topics: ['KV Cache'], children: [] }] })
    const result = await designFolders(topics, { complete }, 'zh_CN')

    expect(complete).toHaveBeenCalledTimes(2)
    // 反馈里要点名，不能只说「有复合名」——模型得知道是哪个
    expect(complete.mock.calls[1]![0]).toContain('记忆与向量存储')
    expect(result!.folders).toEqual([{ title: '向量存储', children: [] }])
  })

  it('没有复合名时不重问', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: '向量存储', topics: ['KV Cache'], children: [] }],
    })
    await designFolders(topics, { complete }, 'zh_CN')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('二级目录名同样算数', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        folders: [{ title: 'AI 工程', topics: [], children: [{ title: '记忆与检索', topics: ['KV Cache'] }] }],
      })
      .mockResolvedValueOnce({
        folders: [{ title: 'AI 工程', topics: [], children: [{ title: '向量检索', topics: ['KV Cache'] }] }],
      })
    await designFolders(topics, { complete }, 'zh_CN')
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0]).toContain('记忆与检索')
  })

  it('重问失败时保留第一版——名字不好看也好过整摊书签失去归属', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: '记忆与向量存储', topics: ['KV Cache'], children: [] }] })
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: false }))
    const result = await designFolders(topics, { complete }, 'zh_CN')

    expect(result!.folders).toEqual([{ title: '记忆与向量存储', children: [] }])
  })

  it('重问回来还是复合名就收手，用重问那一版并留一条警告', async () => {
    const logs: Array<[string, string]> = []
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: '记忆与向量存储', topics: ['KV Cache'], children: [] }] })
      .mockResolvedValueOnce({ folders: [{ title: '记忆与检索', topics: ['KV Cache'], children: [] }] })
    const result = await designFolders(topics, { complete }, 'zh_CN', {
      onLog: (message, level) => logs.push([message, level]),
    })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result!.folders).toEqual([{ title: '记忆与检索', children: [] }])
    expect(logs.some(([m, l]) => l === 'warn' && m.includes('记忆与检索'))).toBe(true)
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
      .mockResolvedValueOnce({ folders: [{ title: 'Agent 框架', topics: ['智能体框架'], children: [] }] })
      .mockResolvedValueOnce({ folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }] })
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '智能体框架')],
      [blog('1'), gh('2')], ['github'], { complete },
    )
    expect(complete).toHaveBeenCalledTimes(2)
    // 聚合组先跑，主题那次是第二次请求——它不该带上组内标签
    expect(complete.mock.calls[1]![0]).not.toContain('智能体框架')
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
    // 聚合组先跑，这里失败的是聚合组那摊
    const complete = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: false }))
      .mockResolvedValueOnce({ folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }] })
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
    // 聚合组先跑，因此这里让「已发出的那摊」变成聚合组那摊：
    // isCancelled 前两次探活（摊前总检查、组内逐摊检查）放行，组那摊跑完后
    // 第三次探活（主题那摊开始前）才报取消，主题那摊因此原样保留。
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'Agent 框架', topics: ['智能体框架'], children: [] }],
    })
    let calls = 0
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '智能体框架')],
      [blog('1'), gh('2')], ['github'], { complete },
      {
        isCancelled: () => {
          calls += 1
          return calls > 2
        },
      },
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result[1]!.primaryTopic).toBe('Agent 框架')
    expect(result[0]!.primaryTopic).toBe('KV Cache')
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

  it('聚合组那几摊先跑，主题那摊在后——先后关系是这条链路的全部意义', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: 'Agent 框架', topics: ['智能体框架'], children: [] }] })
      .mockResolvedValueOnce({ folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }] })
    await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '智能体框架')],
      [blog('1'), gh('2')], ['github'], { complete },
    )
    // 第一次是聚合组那摊：它认得组内的标签，也带着「只输出一层」
    expect(complete.mock.calls[0]![0]).toContain('智能体框架')
    expect(complete.mock.calls[0]![0]).toContain('只输出一层')
  })

  it('主题那次带上聚合组名与组内设计出来的子目录名', async () => {
    // 「语音合成与克隆」本身是复合名（Task 1/2 的重问逻辑会认出「与」两侧都够长），
    // 所以聚合组那摊会先重问一次；重问原样给回同一个标题，验的仍然是重问结束之后
    // 落地的最终产物——第三次调用才是主题那次
    const complete = vi.fn()
      .mockResolvedValueOnce({
        folders: [{ title: '语音合成与克隆', topics: ['智能体框架'], children: [] }],
      })
      .mockResolvedValueOnce({
        folders: [{ title: '语音合成与克隆', topics: ['智能体框架'], children: [] }],
      })
      .mockResolvedValueOnce({ folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }] })
    await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '智能体框架')],
      [blog('1'), gh('2')], ['github'], { complete },
    )
    const topicPrompt = complete.mock.calls[2]![0] as string
    expect(topicPrompt).toContain('GitHub')
    expect(topicPrompt).toContain('语音合成与克隆')
    expect(topicPrompt).toContain('语义重叠')
  })

  it('聚合组那摊设计失败时，主题那摊仍然知道组名，只是没有子目录名可报', async () => {
    const complete = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: false }))
      .mockResolvedValueOnce({ folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }] })
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '智能体框架')],
      [blog('1'), gh('2')], ['github'], { complete },
    )
    expect(complete.mock.calls[1]![0]).toContain('GitHub')
    // 失败那摊的标签原样保留
    expect(result[1]!.primaryTopic).toBe('智能体框架')
  })

  it('没勾选聚合组时，主题那次不带已有目录清单', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }],
    })
    await designTagFolders([tag('1', 'KV Cache')], [blog('1')], [], { complete })
    expect(complete.mock.calls[0]![0]).not.toContain('语义重叠')
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

  it('主题名自己也撞了已有目录名——整簇跳过，不造重名兄弟', async () => {
    const client = { complete: vi.fn().mockResolvedValue({ names: [{ key: '语音合成', name: '语音合成' }] }) }
    const names = await nameNewTopics(clusters, ['语音合成'], client, 'zh_CN')
    expect(names.has('语音合成')).toBe(false)
    // 没撞名的簇不受影响
    expect(names.get('数据竞赛')).toBe('数据竞赛')
  })

  it('模型的提议与退回的主题名都撞了——同样整簇跳过', async () => {
    const client = { complete: vi.fn().mockResolvedValue({ names: [{ key: '语音合成', name: '语音与音频' }] }) }
    const names = await nameNewTopics(clusters, ['语音与音频', '语音合成'], client, 'zh_CN')
    expect(names.has('语音合成')).toBe(false)
  })
})
