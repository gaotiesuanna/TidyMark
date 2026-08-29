import { describe, it, expect, vi } from 'vitest'
import { ANONYMOUS_CLIENT, createSessions } from '@/background/sessions'
import { clientIdFromPortName, PROGRESS_PORT, progressPortName } from '@/background/events'
import type { ProgressEvent } from '@/background/events'

function event(message: string): ProgressEvent {
  return { phase: 'classify', message }
}

/** 两个窗口的侧栏各连一条，返回各自收到的事件数组。 */
function twoWindows() {
  const sessions = createSessions()
  const a: ProgressEvent[] = []
  const b: ProgressEvent[] = []
  sessions.attach('win-a', (e) => a.push(e))
  sessions.attach('win-b', (e) => b.push(e))
  return { sessions, a, b }
}

describe('进度事件只回发起的那个窗口', () => {
  it('推给 A 的事件不会落到 B 手里', () => {
    const { sessions, a, b } = twoWindows()

    sessions.emit('win-a', event('A 的进度'))

    expect(a.map((e) => e.message)).toEqual(['A 的进度'])
    expect(b).toEqual([])
  })

  it('B 后连上来不会顶掉 A 的通道', () => {
    // 这是原来的事故：SW 里 progressPort 是单槽，B 一连上，A 的进度当场哑掉。
    const { sessions, a } = twoWindows()
    sessions.attach('win-c', () => {})

    sessions.emit('win-a', event('仍然收得到'))

    expect(a.map((e) => e.message)).toEqual(['仍然收得到'])
  })

  it('窗口关了之后推给它的事件被丢掉，不抛出去', () => {
    const { sessions, a } = twoWindows()
    sessions.detach('win-b')

    expect(() => sessions.emit('win-b', event('无人接收'))).not.toThrow()
    expect(a).toEqual([])
  })

  it('通道断了但 onDisconnect 还没到时，postMessage 抛出来也不外泄', () => {
    const sessions = createSessions()
    const post = vi.fn(() => { throw new Error('Attempting to use a disconnected port object') })
    sessions.attach('win-a', post)

    expect(() => sessions.emit('win-a', event('打在断口上'))).not.toThrow()
    // 抛过一次就注销，不必等 onDisconnect——第二次连调用都不会发生
    sessions.emit('win-a', event('第二条'))
    expect(post).toHaveBeenCalledTimes(1)
  })
})

describe('取消只掐自己那一轮', () => {
  it('A 点取消不影响 B 正在跑的那一轮', () => {
    // 原来的事故：cancelled 与 controller 都是全局单份，在 A 点取消
    // 掐掉的是 B 那轮已经花了钱、跑了几分钟的分析。
    const { sessions } = twoWindows()
    expect(sessions.beginRun('win-b', true)).toBe(true)
    const bSignal = sessions.signal('win-b')

    expect(sessions.cancel('win-a')).toBe(false)

    expect(sessions.isCancelled('win-b')).toBe(false)
    expect(bSignal?.aborted).toBe(false)
  })

  it('持有者点取消会置位并 abort 自己的信号', () => {
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', true)
    const signal = sessions.signal('win-a')

    expect(sessions.cancel('win-a')).toBe(true)
    expect(sessions.isCancelled('win-a')).toBe(true)
    expect(signal?.aborted).toBe(true)
  })

  it('没有自己那一轮时取消是无害的空操作', () => {
    const { sessions } = twoWindows()

    expect(sessions.cancel('win-a')).toBe(false)
    expect(sessions.isCancelled('win-a')).toBe(false)
  })
})

describe('一次只放一轮长任务', () => {
  it('别的窗口占着时认领失败', () => {
    const { sessions } = twoWindows()
    expect(sessions.beginRun('win-a', true)).toBe(true)

    expect(sessions.beginRun('win-b', true)).toBe(false)
  })

  it('持有者收工之后别人才能认领', () => {
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', true)
    sessions.endRun('win-a')

    expect(sessions.beginRun('win-b', true)).toBe(true)
  })

  it('同一个窗口再次认领算重开一轮，换一个没被 abort 过的信号', () => {
    // 上一轮取消过的 controller 已经 aborted，沿用它会让新一轮第一个请求当场断掉
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', true)
    sessions.cancel('win-a')

    expect(sessions.beginRun('win-a', true)).toBe(true)
    expect(sessions.isCancelled('win-a')).toBe(false)
    expect(sessions.signal('win-a')?.aborted).toBe(false)
  })

  it('非持有者的收尾不会把别人刚开的那轮抹掉', () => {
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', true)

    sessions.endRun('win-b')

    expect(sessions.beginRun('win-b', true)).toBe(false)
  })

  it('窗口关掉不中止已经在跑的那一轮，但那一轮结束后后台不会被永久占住', () => {
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', true)

    sessions.detach('win-a')
    expect(sessions.signal('win-a')?.aborted).toBe(false)
    expect(sessions.beginRun('win-b', true)).toBe(false)

    sessions.endRun('win-a')
    expect(sessions.beginRun('win-b', true)).toBe(true)
  })
})

/**
 * 「独占后台」与「吃取消信号」是两件事。apply / undo / import / apply_cleanup
 * 必须独占（它们在改同一棵书签树、共用同一个撤销快照键），但它们不可取消。
 */
describe('不可取消的独占任务', () => {
  it('照样独占：别人开不了新的一轮', () => {
    const { sessions } = twoWindows()
    expect(sessions.beginRun('win-a', false)).toBe(true)

    expect(sessions.beginRun('win-b', true)).toBe(false)
  })

  it('拿不到取消信号——没有 controller 可给', () => {
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', false)

    expect(sessions.signal('win-a')).toBeUndefined()
  })

  it('连自己点取消都不受理，免得日志说一句做不到的话', () => {
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', false)

    expect(sessions.cancel('win-a')).toBe(false)
    expect(sessions.isCancelled('win-a')).toBe(false)
  })

  it('收工之后位子照常放开', () => {
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', false)
    sessions.endRun('win-a')

    expect(sessions.beginRun('win-b', true)).toBe(true)
  })

  it('同一个窗口从不可取消换成可取消，信号就有了', () => {
    const { sessions } = twoWindows()
    sessions.beginRun('win-a', false)

    sessions.beginRun('win-a', true)

    expect(sessions.signal('win-a')?.aborted).toBe(false)
    expect(sessions.cancel('win-a')).toBe(true)
  })
})

describe('连接名里的身份', () => {
  it('拼出来的名字能原样解回 clientId', () => {
    expect(clientIdFromPortName(progressPortName('win-a'))).toBe('win-a')
  })

  it('不是进度通道时答 null，好让 onConnect 直接放行别的连接', () => {
    expect(clientIdFromPortName('something-else')).toBeNull()
  })

  it('老侧栏用的裸名字解出空串，由调用方退回匿名槽', () => {
    expect(clientIdFromPortName(PROGRESS_PORT)).toBe('')
    expect(ANONYMOUS_CLIENT).not.toBe('')
  })

  it('clientId 里带 # 也能完整解回来', () => {
    expect(clientIdFromPortName(progressPortName('a#b'))).toBe('a#b')
  })
})
