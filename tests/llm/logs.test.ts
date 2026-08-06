import { describe, it, expect } from 'vitest'
import { LOCALES } from '@/core/locale'
import {
  fallbackReason, logBatch, logBatchDone, logBatchFailed,
  logDuplicateTopics, logFoldersDone, logFoldersFailed,
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
})
