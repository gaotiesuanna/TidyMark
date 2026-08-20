import { describe, it, expect } from 'vitest'
import { LOCALES } from '@/core/locale'
import {
  fallbackReason, logBatch, logBatchDone, logBatchFailed,
  logCompoundNames, logCompoundNamesRemain, logDuplicateTopics, logFoldersDone, logFoldersFailed,
  logFoldersRetryFailed, logNoTopicMapped,
} from '@/llm/logs'

describe('llm 日志文案双语', () => {
  it('每种语言下每条日志都非空且带上关键数字', () => {
    for (const locale of LOCALES) {
      expect(logBatch(locale, 'x', 0, 3, 20)).toContain('1/3')
      expect(logBatchDone(locale, 0, 3, 20, 18, 500)).toContain('18')
      expect(logBatchFailed(locale, 'x', 0, 3, 'boom')).toContain('boom')
      expect(logFoldersDone(locale, 6, 40)).toContain('6')
      expect(logFoldersFailed(locale, 'boom')).toContain('boom')
      expect(logDuplicateTopics(locale, 'x')).toContain('x')
    }
  })

  it('批次序号从 1 开始展示，不是从 0', () => {
    expect(logBatch('zh_CN', '分类批次', 0, 3, 20)).toContain('1/3')
    expect(logBatch('en', 'Classify', 2, 3, 20)).toContain('3/3')
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
