import { describe, it, expect, vi } from 'vitest'
import {
  collectTopics,
  applyDesign,
  designFolders as designFoldersRaw,
  designTagFolders as designTagFoldersRaw,
  nameMergedFolder,
  nameNewTopics,
  isCompoundName,
  fragmentedFamilies,
  type FolderDesign,
  type DesignOptions,
} from '@/llm/folders'
import { NO_TOPIC } from '@/llm/tags'
import type { TagResult } from '@/core/types'
import type { LlmClient } from '@/llm/client'
import { MAX_SIBLINGS } from '@/core/tree'
import { SHAPE_MAX_SIBLINGS } from '@/core/shape'

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
  client: LlmClient,
  options?: DesignOptions,
): Promise<TagResult[]> {
  return designTagFoldersRaw(tags, client, 'zh_CN', options)
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

  // oneLevel 只用于聚合组内部，上限固定用 SHAPE_MAX_SIBLINGS——与 core/tree.ts 组内
  // 子目录截断对齐，不再借用（这里没传的）maxTopFolders（final-review.md I3）
  it('oneLevel 时子目录超过上限按 SHAPE_MAX_SIBLINGS 截断，不留「其他」位', async () => {
    const many = Array.from({ length: SHAPE_MAX_SIBLINGS + 3 }, (_, i) => ({
      title: `目录${i}`, topics: [`标签${i}`], children: [],
    }))
    const complete = vi.fn().mockResolvedValue({ folders: many })
    const result = await designFolders(topics, { complete }, { oneLevel: true })
    expect(result!.folders).toHaveLength(SHAPE_MAX_SIBLINGS)
    expect(result!.mapping.has(`标签${SHAPE_MAX_SIBLINGS + 1}`)).toBe(false)
  })

  it('oneLevel 时忽略 maxTopFolders，仍然固定用 SHAPE_MAX_SIBLINGS（I3）', async () => {
    const many = Array.from({ length: SHAPE_MAX_SIBLINGS + 3 }, (_, i) => ({
      title: `目录${i}`, topics: [`标签${i}`], children: [],
    }))
    const complete = vi.fn().mockResolvedValue({ folders: many })
    // 传一个远大于 SHAPE_MAX_SIBLINGS 的值（模拟主题预算 topWithFallback + 1 传下来），
    // oneLevel 时应该被无视——提示词与实际截断都不跟着它走
    const result = await designFolders(topics, { complete }, { oneLevel: true, maxTopFolders: 30 })
    expect(result!.folders).toHaveLength(SHAPE_MAX_SIBLINGS)
    expect(complete.mock.calls[0]![0]).toContain(`子目录不超过 ${SHAPE_MAX_SIBLINGS} 个`)
  })

  it('maxTopFolders 覆盖截断上限，非 oneLevel 时仍给「其他」留位', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `目录${i}`, topics: [`标签${i}`], children: [],
    }))
    const complete = vi.fn().mockResolvedValue({ folders: many })
    const result = await designFolders(topics, { complete }, { maxTopFolders: 5 })
    expect(result!.folders).toHaveLength(4)
  })

  // 丢弃是静默的话，用户的第 5 个主题连同它吸收的标签一起变成未映射、落进「其他」，
  // 而链路上没有任何一处会告诉他这件事发生过（organize-audit-holes 06 票判准 C）
  it('超出上限被丢弃的目录要出一条警告，不能静默', async () => {
    const onLog = vi.fn()
    const many = ['前端', '后端', '数据库', '运维', '测试', '设计', '产品', '安全', '监控'].map(
      (title, i) => ({ title, topics: [`标签${i}`], children: [] }),
    )
    const complete = vi.fn().mockResolvedValue({ folders: many })
    await designFolders(topics, { complete }, { maxTopFolders: 5, onLog })
    const warnCalls = onLog.mock.calls.filter(([, level]) => level === 'warn')
    expect(warnCalls).toHaveLength(1)
    // 丢了 9 - 4 = 5 个，且要点名是哪几个，不能只说一个数字
    expect(warnCalls[0]![0]).toContain('5')
    expect(warnCalls[0]![0]).toContain('监控')
  })

  it('没有目录被丢弃时不产生警告', async () => {
    const onLog = vi.fn()
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: '前端', topics: ['标签0'], children: [] }],
    })
    await designFolders(topics, { complete }, { maxTopFolders: 5, onLog })
    expect(onLog.mock.calls.some(([, level]) => level === 'warn')).toBe(false)
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

  it('中文「及」「以及」与斜杠系列连接词同样算复合名——换连接词不算取舍', () => {
    // 模型被禁用「与」「和」之后最省力的逃逸口（见 issues review I2）
    expect(isCompoundName('配置及排错', 'zh_CN')).toBe(true)
    expect(isCompoundName('记忆以及检索', 'zh_CN')).toBe(true)
    expect(isCompoundName('语音识别/合成', 'zh_CN')).toBe(true)
    expect(isCompoundName('前端 / 后端', 'zh_CN')).toBe(true)
    expect(isCompoundName('记忆＆检索', 'zh_CN')).toBe(true)
    expect(isCompoundName('Agent+RAG', 'zh_CN')).toBe(true)
  })

  it('扩表之后真实的非复合名仍然放过', () => {
    expect(isCompoundName('饱和度', 'zh_CN')).toBe(false)
    expect(isCompoundName('共和国', 'zh_CN')).toBe(false)
    expect(isCompoundName('中和反应', 'zh_CN')).toBe(false)
    expect(isCompoundName('A/B 测试', 'zh_CN')).toBe(false)
  })

  it('英文不带空格的斜杠——短缩写放过，真正的复合名认得出', () => {
    expect(isCompoundName('CI/CD', 'en')).toBe(false)
    expect(isCompoundName('I/O', 'en')).toBe(false)
    expect(isCompoundName('TCP/IP', 'en')).toBe(false)
    expect(isCompoundName('A/B', 'en')).toBe(false)
    expect(isCompoundName('Speech synthesis/cloning', 'en')).toBe(true)
  })

  it('英文逗号列举也算复合名', () => {
    expect(isCompoundName('Memory, vector storage', 'en')).toBe(true)
  })
})

describe('designFolders 的复合名重问', () => {
  // 这里用原始导出而非本文件顶部的中文便捷包装：包装函数其实容得下 onLog
  // （它就在第 3 个参数 options 里，同文件其他用例已经这么用），真实原因是
  // 下面这些用例把 'zh_CN' 显式写成了第 3 个位置参数，与包装的 options 位冲突。
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

  it('重问回来复合名比第一版少（变好了）就用重问那一版并留一条警告', async () => {
    // 第一版两个目录都是复合名，重问版只剩一个——remain(1) < compound(2)，
    // 说明重问确实起了作用，即便没能清零也该用它
    const logs: Array<[string, string]> = []
    const complete = vi.fn()
      .mockResolvedValueOnce({
        folders: [
          { title: '记忆与向量存储', topics: ['KV Cache'], children: [] },
          { title: '前端与后端', topics: [], children: [] },
        ],
      })
      .mockResolvedValueOnce({ folders: [{ title: '记忆与检索', topics: ['KV Cache'], children: [] }] })
    const result = await designFolders(topics, { complete }, 'zh_CN', {
      onLog: (message, level) => logs.push([message, level]),
    })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result!.folders).toEqual([{ title: '记忆与检索', children: [] }])
    expect(logs.some(([m, l]) => l === 'warn' && m.includes('记忆与检索'))).toBe(true)
  })

  it('重问回来复合名不比第一版少（没变好）就退回第一版——不能收下更差的一版', async () => {
    // 两版都只有一个复合名：remain(1) >= compound(1)，说明重问没有让情况变好，
    // 「收手」不等于「必须用第二版」（见 issues review M8）
    const logs: Array<[string, string]> = []
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: '记忆与向量存储', topics: ['KV Cache'], children: [] }] })
      .mockResolvedValueOnce({ folders: [{ title: '记忆与检索', topics: ['KV Cache'], children: [] }] })
    const result = await designFolders(topics, { complete }, 'zh_CN', {
      onLog: (message, level) => logs.push([message, level]),
    })

    expect(complete).toHaveBeenCalledTimes(2)
    expect(result!.folders).toEqual([{ title: '记忆与向量存储', children: [] }])
    expect(logs.some(([m, l]) => l === 'warn' && m.includes('记忆与向量存储'))).toBe(true)
  })

  it('重问失败时打一条新的 warn，不是「保留原始标签」那条 error（I1）', async () => {
    // 第一版被保留了，根本没有退回原始标签，不能沿用 logFoldersFailed 的文案
    const logs: Array<[string, string]> = []
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: '记忆与向量存储', topics: ['KV Cache'], children: [] }] })
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { retryable: false }))
    await designFolders(topics, { complete }, 'zh_CN', {
      onLog: (message, level) => logs.push([message, level]),
    })

    expect(logs.some(([m, l]) => l === 'error' && m.includes('保留原始标签'))).toBe(false)
    expect(logs.some(([m, l]) => l === 'warn' && m.includes('timeout'))).toBe(true)
  })

  it('不管重不重问，logFoldersDone 只打一次，数字取自最终采用的那一版（I1）', async () => {
    const logs: Array<[string, string]> = []
    const complete = vi.fn()
      .mockResolvedValueOnce({ folders: [{ title: '记忆与向量存储', topics: ['KV Cache'], children: [] }] })
      .mockResolvedValueOnce({ folders: [{ title: '向量存储', topics: ['KV Cache'], children: [] }] })
    await designFolders(topics, { complete }, 'zh_CN', {
      onLog: (message, level) => logs.push([message, level]),
    })

    const done = logs.filter(([, l]) => l === 'info')
    expect(done).toHaveLength(1)
    expect(done[0]![0]).toContain('1 个目录')
  })

  it('重问失败时也只打一次 logFoldersDone，数字来自第一版（I1）', async () => {
    const logs: Array<[string, string]> = []
    const complete = vi.fn()
      .mockResolvedValueOnce({
        folders: [
          { title: '记忆与向量存储', topics: ['KV Cache'], children: [] },
          { title: '注意力', topics: ['注意力机制'], children: [] },
        ],
      })
      .mockRejectedValueOnce(Object.assign(new Error('x'), { retryable: false }))
    await designFolders(
      [{ topic: 'KV Cache', count: 3 }, { topic: '注意力机制', count: 2 }],
      { complete }, 'zh_CN',
      { onLog: (message, level) => logs.push([message, level]) },
    )

    const done = logs.filter(([, l]) => l === 'info')
    expect(done).toHaveLength(1)
    expect(done[0]![0]).toContain('2 个目录')
  })

  it('重问之前查一次取消，取消了就不再发这次请求，用第一版（I3）', async () => {
    const complete = vi.fn().mockResolvedValueOnce({
      folders: [{ title: '记忆与向量存储', topics: ['KV Cache'], children: [] }],
    })
    const result = await designFolders(topics, { complete }, 'zh_CN', {
      isCancelled: () => true,
    })

    expect(complete).toHaveBeenCalledTimes(1)
    expect(result!.folders).toEqual([{ title: '记忆与向量存储', children: [] }])
  })
})

// D4（issues/38）取消域名聚合之后，designTagFolders 只剩一种形态：
// 全部标签走一次设计。原来的「组内先跑、主题在后」「组名喂给主题那一轮」
// 那一整套用例随机制一起删掉了。
describe('designTagFolders', () => {
  it('全部标签走一次设计', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'LLM 原理', topics: ['KV Cache', '注意力机制'], children: [] }],
    })
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '注意力机制')], { complete },
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.map((t) => t.primaryTopic)).toEqual(['LLM 原理', 'LLM 原理'])
  })

  // 这一条钉的是 D4 本身：github.com 的书签不再被任何规则单独拎走，
  // 它和讲它的那篇博客一起参与同一次主题设计、落进同一个目录。
  it('github.com 的书签不再被单独拎走，和讲它的博客进同一个目录', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: '语音合成', topics: ['GPT-SoVITS'], children: [] }],
    })
    const result = await designTagFolders(
      [tag('repo', 'GPT-SoVITS'), tag('post', 'GPT-SoVITS')], { complete },
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.map((t) => t.primaryTopic)).toEqual(['语音合成', '语音合成'])
  })

  it('设计失败时整摊标签原样保留', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await designTagFolders([tag('1', 'KV Cache')], { complete })
    expect(result[0]!.primaryTopic).toBe('KV Cache')
  })

  it('保持输入顺序与条数', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [
        { title: 'A', topics: ['a'], children: [] },
        { title: 'B', topics: ['b'], children: [] },
      ],
    })
    const result = await designTagFolders([tag('1', 'b'), tag('2', 'a')], { complete })
    expect(result.map((t) => t.bookmarkId)).toEqual(['1', '2'])
    expect(result.map((t) => t.primaryTopic)).toEqual(['B', 'A'])
  })

  it('标签全空时不发请求', async () => {
    const complete = vi.fn()
    const result = await designTagFolders([tag('1', NO_TOPIC)], { complete })
    expect(complete).not.toHaveBeenCalled()
    expect(result[0]!.primaryTopic).toBe(NO_TOPIC)
  })

  it('取消时不发请求，标签原样保留', async () => {
    const complete = vi.fn()
    const result = await designTagFolders(
      [tag('1', 'KV Cache')], { complete }, { isCancelled: () => true },
    )
    expect(complete).not.toHaveBeenCalled()
    expect(result[0]!.primaryTopic).toBe('KV Cache')
  })

  it('同一个 bookmarkId 出现两次时，两条各自独立映射，不互相覆盖', async () => {
    const complete = vi.fn().mockResolvedValue({
      folders: [
        { title: 'A', topics: ['a'], children: [] },
        { title: 'B', topics: ['b'], children: [] },
      ],
    })
    const result = await designTagFolders([tag('1', 'a'), tag('1', 'b')], { complete })
    expect(result[0]!.primaryTopic).toBe('A')
    expect(result[1]!.primaryTopic).toBe('B')
  })

  it('有标签映射不到目录时打一条 info 日志，说明去处交给分类阶段（I5）', async () => {
    const logs: string[] = []
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }],
    })
    const result = await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', '注意力机制')], { complete },
      { onLog: (message) => logs.push(message) },
    )
    expect(result[1]!.primaryTopic).toBe(NO_TOPIC)
    expect(logs.filter((m) => m.includes('没有映射到任何目录'))).toEqual([
      '主题设计完成后有 1 个标签没有映射到任何目录，去处由分类阶段决定',
    ])
  })

  it('没有标签失去归属时不打这条 info 日志（I5）', async () => {
    const logs: string[] = []
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }],
    })
    await designTagFolders(
      [tag('1', 'KV Cache')], { complete }, { onLog: (message) => logs.push(message) },
    )
    expect(logs.filter((m) => m.includes('没有映射到任何目录'))).toEqual([])
  })

  it('原本就是空主题的标签不算「新失去归属」，不触发那条日志', async () => {
    const logs: string[] = []
    const complete = vi.fn().mockResolvedValue({
      folders: [{ title: 'LLM 原理', topics: ['KV Cache'], children: [] }],
    })
    await designTagFolders(
      [tag('1', 'KV Cache'), tag('2', NO_TOPIC)], { complete },
      { onLog: (message) => logs.push(message) },
    )
    expect(logs.filter((m) => m.includes('没有映射到任何目录'))).toEqual([])
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

describe('fragmentedFamilies', () => {
  type Spec = Array<{ title: string; children?: string[] }>

  function designWith(spec: Spec): FolderDesign {
    return {
      folders: spec.map((f) => ({ title: f.title, children: f.children ?? [] })),
      mapping: new Map(),
    }
  }
  const flat = (titles: string[]): FolderDesign => designWith(titles.map((title) => ({ title })))

  // D1（issues/38）：判据只剩「同主体」一条，尺寸那一关整个撤了。
  it('同一个主体拆成几个并列目录时点名', () => {
    const families = fragmentedFamilies(
      flat(['FastAPI教程', 'FastAPI实战', 'FastAPI数据库', 'FastAPI用户认证']), 3,
    )
    expect(families).toHaveLength(1)
    expect(families[0]!.prefix).toBe('FastAPI')
    expect(families[0]!.titles).toEqual([
      'FastAPI教程', 'FastAPI实战', 'FastAPI数据库', 'FastAPI用户认证',
    ])
  })

  // 这一条是 D1 的核心：改判之前它是「同族但个个装得满就放过」。
  // 真实产出里 FastAPI 那四个正是被尺寸这一关放行的——四个成员里有两个装了
  // 6 条以上，就够不上「多数偏小」，于是一个主体占掉四个一级位子。
  it('同族就算一族，尺寸再健康也照样点名', () => {
    const families = fragmentedFamilies(flat(['语音识别', '语音合成', '语音对话']), 3)
    expect(families).toHaveLength(1)
    expect(families[0]!.prefix).toBe('语音')
    expect(families[0]!.titles).toEqual(['语音识别', '语音合成', '语音对话'])
  })

  it('只有一个成不了族', () => {
    expect(fragmentedFamilies(flat(['FastAPI教程', 'Docker部署']), 3)).toEqual([])
  })

  it('一个名字就是另一个的前缀时算同族', () => {
    expect(fragmentedFamilies(flat(['FastAPI', 'FastAPI教程']), 3)[0]!.prefix).toBe('FastAPI')
  })

  it('公共前缀落在单词中间不算同族', () => {
    // Prometheus / Protobuf 共享 Pro 三个字母，但那是半个单词
    expect(fragmentedFamilies(flat(['Prometheus监控', 'Protobuf序列化']), 3)).toEqual([])
  })

  it('英文前缀不足三个字母不算同族', () => {
    expect(fragmentedFamilies(flat(['CI/CD', 'CLI 工具']), 3)).toEqual([])
  })

  it('中文前缀不足两个字不算同族', () => {
    expect(fragmentedFamilies(flat(['模型部署', '模块化设计']), 3)).toEqual([])
  })

  it('minFolderSize 缺席时一概不检测——用户关掉了这项约束', () => {
    expect(fragmentedFamilies(flat(['FastAPI教程', 'FastAPI实战']))).toEqual([])
  })

  it('只在同一层的兄弟之间比，一级不会和别人的二级凑成族', () => {
    const design = designWith([
      { title: 'FastAPI教程' },
      { title: '容器', children: ['FastAPI实战'] },
    ])
    expect(fragmentedFamilies(design, 3)).toEqual([])
  })

  it('同一个父目录下的二级目录之间照样检测', () => {
    const design = designWith([
      { title: '容器', children: ['Docker基础', 'Docker网络', 'Docker存储'] },
    ])
    const families = fragmentedFamilies(design, 3)
    expect(families).toHaveLength(1)
    expect(families[0]!.titles).toEqual(['Docker基础', 'Docker网络', 'Docker存储'])
  })

  // 撤掉尺寸那一关之后，「一级目录的条数把子目录的一并算上」这条豁免也随之消失：
  // 分出了子目录的同族一级目录照样要合并。合并之后目录太大不必怕——
  // core/audit.ts 的 findOversizedFolders 会按落成后的真实占用把它再切开。
  it('分了子目录的同族一级目录同样点名', () => {
    const design = designWith([
      { title: 'FastAPI教程', children: ['入门', '进阶'] },
      { title: 'FastAPI实战', children: ['案例', '踩坑'] },
    ])
    expect(fragmentedFamilies(design, 3)[0]!.titles).toEqual(['FastAPI教程', 'FastAPI实战'])
  })
})

describe('designFolders 的同族碎片重问', () => {
  // 同上面那个 describe：这里显式把 'zh_CN' 写在第 3 个位置参数上，用原始导出。
  const designFolders = designFoldersRaw
  const topics = [
    { topic: 'FastAPI 入门', count: 3 },
    { topic: 'FastAPI 部署', count: 3 },
  ]
  const splitApart = {
    folders: [
      { title: 'FastAPI教程', topics: ['FastAPI 入门'], children: [] },
      { title: 'FastAPI实战', topics: ['FastAPI 部署'], children: [] },
    ],
  }
  const mergedUp = {
    folders: [{ title: 'FastAPI', topics: ['FastAPI 入门', 'FastAPI 部署'], children: [] }],
  }

  it('出现同族碎片时点名重问一次，用重问那一版', async () => {
    const complete = vi.fn().mockResolvedValueOnce(splitApart).mockResolvedValueOnce(mergedUp)
    const result = await designFolders(topics, { complete }, 'zh_CN', { minFolderSize: 3 })

    expect(complete).toHaveBeenCalledTimes(2)
    // 反馈要点名到目录，也要点名到主体——模型得知道并成什么
    expect(complete.mock.calls[1]![0]).toContain('FastAPI教程')
    expect(complete.mock.calls[1]![0]).toContain('FastAPI实战')
    expect(result!.folders).toEqual([{ title: 'FastAPI', children: [] }])
  })

  it('minFolderSize 缺席时不重问', async () => {
    const complete = vi.fn().mockResolvedValue(splitApart)
    await designFolders(topics, { complete }, 'zh_CN')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('重问回来还是一样碎就退回第一版，不采用更差或等同的一版', async () => {
    const complete = vi.fn().mockResolvedValueOnce(splitApart).mockResolvedValueOnce({
      folders: [
        { title: 'FastAPI入门', topics: ['FastAPI 入门'], children: [] },
        { title: 'FastAPI上线', topics: ['FastAPI 部署'], children: [] },
      ],
    })
    const result = await designFolders(topics, { complete }, 'zh_CN', { minFolderSize: 3 })
    expect(result!.folders.map((f) => f.title)).toEqual(['FastAPI教程', 'FastAPI实战'])
  })

  it('复合名与同族碎片同时出现时只重问一次，反馈里两样都点名', async () => {
    const both = {
      folders: [
        { title: 'FastAPI教程与实战', topics: ['FastAPI 入门'], children: [] },
        { title: 'FastAPI部署', topics: ['FastAPI 部署'], children: [] },
      ],
    }
    const complete = vi.fn().mockResolvedValueOnce(both).mockResolvedValueOnce(mergedUp)
    await designFolders(topics, { complete }, 'zh_CN', { minFolderSize: 3 })

    expect(complete).toHaveBeenCalledTimes(2)
    const feedback = complete.mock.calls[1]![0] as string
    expect(feedback).toContain('两个概念')
    expect(feedback).toContain('FastAPI教程与实战')
    expect(feedback).toContain('FastAPI部署')
  })

  it('日志点名到同族目录', async () => {
    const logs: string[] = []
    const complete = vi.fn().mockResolvedValueOnce(splitApart).mockResolvedValueOnce(mergedUp)
    await designFolders(topics, { complete }, 'zh_CN', {
      minFolderSize: 3,
      onLog: (message) => logs.push(message),
    })
    expect(logs.some((m) => m.includes('FastAPI教程') && m.includes('FastAPI实战'))).toBe(true)
  })

  it('重问后仍碎时打「仍碎」那条，不打「已要求重出」那条的复读', async () => {
    const logs: string[] = []
    const complete = vi.fn().mockResolvedValueOnce(splitApart).mockResolvedValueOnce(splitApart)
    await designFolders(topics, { complete }, 'zh_CN', {
      minFolderSize: 3,
      onLog: (message) => logs.push(message),
    })
    expect(logs.some((m) => m.includes('仍有目录把同一个主体拆着'))).toBe(true)
  })
})

// D1 之前这一组验的是「组内放开尺寸、一级不放开」。两摊现在用同一把尺子，
// 剩下要钉的是：一级目录那一摊也真的会为尺寸健康的同族重问。
describe('designFolders 一级与单层用同一把同族尺子', () => {
  const designFolders = designFoldersRaw
  const topics = [
    { topic: '语音识别', count: 6 },
    { topic: '语音合成', count: 6 },
  ]
  const splitApart = {
    folders: [
      { title: '语音识别', topics: ['语音识别'], children: [] },
      { title: '语音合成', topics: ['语音合成'], children: [] },
    ],
  }
  const mergedUp = {
    folders: [{ title: '语音', topics: ['语音识别', '语音合成'], children: [] }],
  }

  it('一级目录那一摊：同主体就重问，尺寸再健康也算', async () => {
    const complete = vi.fn().mockResolvedValueOnce(splitApart).mockResolvedValueOnce(mergedUp)
    const result = await designFolders(topics, { complete }, 'zh_CN', { minFolderSize: 3 })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(result!.folders).toEqual([{ title: '语音', children: [] }])
  })

  it('单层那一摊（下切时用）同样重问', async () => {
    const complete = vi.fn().mockResolvedValueOnce(splitApart).mockResolvedValueOnce(mergedUp)
    await designFolders(topics, { complete }, 'zh_CN', {
      minFolderSize: 3, oneLevel: true, parentTitle: 'FastAPI',
    })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('minFolderSize 缺席时两摊都不重问', async () => {
    const complete = vi.fn().mockResolvedValue(splitApart)
    await designFolders(topics, { complete }, 'zh_CN', {})
    await designFolders(topics, { complete }, 'zh_CN', { oneLevel: true, parentTitle: 'FastAPI' })
    expect(complete).toHaveBeenCalledTimes(2)
  })
})
