import { describe, it, expect, vi, afterEach } from 'vitest'
import { describeSendError } from '@/sidepanel/lib/send'
import { startKeepalive, KEEPALIVE_INTERVAL_MS } from '@/sidepanel/lib/progress'

describe('describeSendError', () => {
  it('通道提前关闭时给出可操作的说明', () => {
    const message = describeSendError(
      'Error: A listener indicated an asynchronous response by returning true, ' +
        'but the message channel closed before a response was received',
    )
    expect(message).toContain('重试')
    expect(message).not.toContain('listener')
  })

  it('扩展被重新加载时提示重开侧栏', () => {
    expect(describeSendError('Error: Extension context invalidated.')).toContain('重新打开')
  })

  it('连不上后台时指向扩展管理页', () => {
    expect(describeSendError('Could not establish connection. Receiving end does not exist.'))
      .toContain('chrome://extensions')
  })

  it('无法识别的错误原样透出，不遮蔽真实信息', () => {
    expect(describeSendError('TypeError: boom')).toBe('TypeError: boom')
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startKeepalive', () => {
  it('按固定间隔 ping，停止后不再 ping', () => {
    vi.useFakeTimers()
    const ping = vi.fn()
    const stop = startKeepalive({ ping, disconnect: vi.fn() })

    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 3)
    expect(ping).toHaveBeenCalledTimes(3)

    stop()
    vi.advanceTimersByTime(KEEPALIVE_INTERVAL_MS * 3)
    expect(ping).toHaveBeenCalledTimes(3)
  })

  it('没有连接时返回一个无害的停止函数', () => {
    expect(() => startKeepalive(null)()).not.toThrow()
  })
})
