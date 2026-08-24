import { describe, it, expect } from 'vitest'
import { LOCALES } from '@/core/locale'
import {
  fallbackReason, logBatch, logBatchDone, logBatchFailed,
  logCompoundNames, logCompoundNamesRemain, logDuplicateTopics, logFoldersDone, logFoldersFailed,
  logBatchPartFailed, logBatchSplit, logFamiliesRemain, logFragmentedFamilies,
  logFoldersRetryFailed, logNoTopicMapped,
} from '@/llm/logs'

describe('llm 日志文案双语', () => {
  it('每种语言下每条日志都非空且带上关键数字', () => {
    for (const locale of LOCALES) {
      expect(logBatch(locale, 'x', 0, 3, 20, { done: 1, inflight: [] })).toContain('1/3')
      expect(logBatchDone(locale, 0, 3, 20, 18, 500)).toContain('18')
      expect(logBatchFailed(locale, 'x', 0, 3, 'boom', 3)).toContain('boom')
      expect(logFoldersDone(locale, 6, 40)).toContain('6')
      expect(logFoldersFailed(locale, 'boom')).toContain('boom')
      expect(logDuplicateTopics(locale, 'x')).toContain('x')
    }
  })

  it('批次序号从 1 开始展示，不是从 0', () => {
    expect(logBatch('zh_CN', '分类批次', 0, 3, 20, { done: 1, inflight: [] })).toContain('第 1 批')
    expect(logBatch('en', 'Classify', 2, 3, 20, { done: 3, inflight: [] })).toContain('Classify 3')
    // 「还在跑」里的序号同样从 1 起
    expect(logBatch('zh_CN', '分类批次', 0, 3, 20, { done: 1, inflight: [1, 2] })).toContain('第 2、3 批')
  })

  it('两种语言的文案确实不同，不是同一份', () => {
    expect(logFoldersDone('zh_CN', 6, 40)).not.toBe(logFoldersDone('en', 6, 40))
  })

  it('兜底原因三种情形都有文案', () => {
    for (const locale of LOCALES) {
      for (const kind of ['noResult', 'failed', 'unprocessed'] as const) {
        expect(fallbackReason(locale, kind, 'boom').trim()).not.toBe('')
      }
    }
  })

  it('复合名的两条日志都双语', () => {
    expect(logCompoundNames('zh_CN', '记忆与向量存储')).toContain('记忆与向量存储')
    expect(/[一-鿿]/.test(logCompoundNames('en', 'x'))).toBe(false)
    expect(/[一-鿿]/.test(logCompoundNamesRemain('en', 'x'))).toBe(false)
  })

  it('重问失败的日志双语，且不是「保留原始标签」那条文案（I1）', () => {
    expect(logFoldersRetryFailed('zh_CN', 'timeout')).toContain('timeout')
    expect(logFoldersRetryFailed('zh_CN', 'timeout')).not.toContain('保留原始标签')
    expect(/[一-鿿]/.test(logFoldersRetryFailed('en', 'x'))).toBe(false)
    expect(logFoldersRetryFailed('zh_CN', 'x')).not.toBe(logFoldersRetryFailed('en', 'x'))
  })

  it('批次日志省略 asked 或 asked === size 时，文案与折叠不存在时一字不差', () => {
    expect(logBatchDone('zh_CN', 0, 1, 20, 18, 500)).toBe('分类批次 1/1：20 条，成功 18 条，耗时 500ms')
    expect(logBatchDone('en', 0, 1, 20, 18, 500)).toBe('Classify batch 1/1: 20 items, 18 succeeded, 500ms')
    // 绝大多数批次没有重复 URL，asked 会等于 size——那时不许多出任何一个字。
    expect(logBatchDone('zh_CN', 0, 1, 20, 18, 500, 20)).toBe(logBatchDone('zh_CN', 0, 1, 20, 18, 500))
    expect(logBatchDone('en', 0, 1, 20, 18, 500, 20)).toBe(logBatchDone('en', 0, 1, 20, 18, 500))
  })

  it('发生折叠时才多出一句解释，双语且英文里没有中文', () => {
    const zh = logBatchDone('zh_CN', 0, 1, 5, 5, 1, 2)
    const en = logBatchDone('en', 0, 1, 5, 5, 1, 2)
    // 「条」仍然指书签：5 条书签、成功 5 条，2 只出现在解释里。
    expect(zh).toContain('5 条')
    expect(zh).toContain('成功 5 条')
    expect(zh).toContain('2')
    expect(zh).not.toBe(logBatchDone('zh_CN', 0, 1, 5, 5, 1))
    expect(en).toContain('5 items')
    expect(en).toContain('5 succeeded')
    expect(en).toContain('2')
    expect(en).not.toBe(logBatchDone('en', 0, 1, 5, 5, 1))
    expect(/[一-鿿]/.test(en)).toBe(false)
    expect(zh).not.toBe(en)
  })

  it('未映射到目录的标签数日志双语，带上数字（I5）', () => {
    expect(logNoTopicMapped('zh_CN', 3)).toContain('3')
    expect(/[一-鿿]/.test(logNoTopicMapped('en', 3))).toBe(false)
    expect(logNoTopicMapped('zh_CN', 3)).not.toBe(logNoTopicMapped('en', 3))
  })
})

describe('截断拆批的两条日志', () => {
  it('拆批日志说清是第几批、多少条被拆', () => {
    for (const locale of LOCALES) {
      const line = logBatchSplit(locale, 'x', 0, 12, 25)
      expect(line).toContain('1/12')
      expect(line).toContain('25')
    }
  })

  it('拆开后仍失败的日志带上条数与错误详情', () => {
    for (const locale of LOCALES) {
      const line = logBatchPartFailed(locale, 'x', 2, 12, 13, 'boom')
      expect(line).toContain('3/12')
      expect(line).toContain('13')
      expect(line).toContain('boom')
    }
  })

  it('英文版不含中文，且两种语言确实是两份文案', () => {
    expect(/[一-鿿]/.test(logBatchSplit('en', 'x', 0, 12, 25))).toBe(false)
    expect(/[一-鿿]/.test(logBatchPartFailed('en', 'x', 0, 12, 13, 'boom'))).toBe(false)
    expect(logBatchSplit('zh_CN', 'x', 0, 12, 25)).not.toBe(logBatchSplit('en', 'x', 0, 12, 25))
  })

  it('拆批不是失败：文案里不能说这批书签被排除', () => {
    expect(logBatchSplit('zh_CN', 'x', 0, 12, 25)).not.toContain('不参与目录设计')
  })
})

describe('整批失败的日志', () => {
  it('说清一共问了几次，读日志的人不必猜有没有重试', () => {
    expect(logBatchFailed('zh_CN', 'x', 0, 12, 'boom', 3)).toContain('问了 3 次')
    expect(logBatchFailed('en', 'x', 0, 12, 'boom', 3)).toContain('3 attempts')
  })

  it('仍然说清是哪一批、丢的书签去了哪', () => {
    const line = logBatchFailed('zh_CN', 'x', 10, 12, 'boom', 3)
    expect(line).toContain('11/12')
    expect(line).toContain('不参与目录设计')
  })

  it('英文版不含中文', () => {
    expect(/[一-鿿]/.test(logBatchFailed('en', 'x', 0, 12, 'boom', 3))).toBe(false)
  })
})

describe('同族碎目录的两条日志', () => {
  it('点名到目录，并说清已经重问', () => {
    const line = logFragmentedFamilies('zh_CN', 'FastAPI教程、FastAPI实战')
    expect(line).toContain('FastAPI教程、FastAPI实战')
    expect(line).toContain('重')
  })

  it('重问后仍在的那条不能说反话——第一版仍在用，不是退回原始标签', () => {
    const line = logFamiliesRemain('zh_CN', 'FastAPI教程')
    expect(line).toContain('FastAPI教程')
    expect(line).not.toContain('保留原始标签')
  })

  it('两条都双语，英文版不含中文', () => {
    expect(/[一-鿿]/.test(logFragmentedFamilies('en', 'x'))).toBe(false)
    expect(/[一-鿿]/.test(logFamiliesRemain('en', 'x'))).toBe(false)
    expect(logFragmentedFamilies('zh_CN', 'x')).not.toBe(logFragmentedFamilies('en', 'x'))
  })

  it('两条文案确实不同，不是同一句', () => {
    expect(logFragmentedFamilies('zh_CN', 'x')).not.toBe(logFamiliesRemain('zh_CN', 'x'))
  })
})

describe('logBatch 报出还没回来的批次', () => {
  // 并发跑批时，只说「谁完成了」的日志逼用户自己拿完成集去减总集，才推得出卡的是哪几个。
  // 真实一遍里 8 批有 2 批永久挂起，用户看到的就是一串乱序的完成行，全靠肉眼做减法。
  it('点名仍在跑的批次', () => {
    const line = logBatch('zh_CN', '标签批次', 7, 8, 24, { done: 6, inflight: [4, 6] })
    expect(line).toContain('24')
    expect(line).toContain('6/8')
    expect(line).toContain('第 5、7 批还在跑')
  })

  it('没有在跑的批次时不缀那半句', () => {
    const line = logBatch('zh_CN', '标签批次', 7, 8, 24, { done: 8, inflight: [] })
    expect(line).toContain('8/8')
    expect(line).not.toContain('还在跑')
  })

  it('英文同源', () => {
    const line = logBatch('en', 'Tag batch', 7, 8, 24, { done: 6, inflight: [4, 6] })
    expect(line).toContain('6/8')
    expect(line).toContain('batches 5, 7 still running')
  })
})
