import { describe, it, expect, beforeEach, vi } from 'vitest'
import { progressPortName, type ProgressEvent } from '@/background/events'
import type { IncomingMessage, Response } from '@/background/messages'
import type { HandlerDeps } from '@/background/handlers'

/**
 * service-worker.ts 是把 chrome 的三个监听器接到 sessions/handlers 上的那层接线。
 * 它一直没有测试——多窗口串台那个 bug 能活下来，靠的正是这个空档。
 *
 * 这里把 chrome 的监听器注册截下来，再手动喂消息进去，于是「两个窗口」在
 * node 环境里就能复现：两条 Port、两个 clientId，不需要真的开浏览器。
 */

interface FakePort {
  name: string
  postMessage: (event: ProgressEvent) => void
  onMessage: { addListener: (fn: () => void) => void }
  onDisconnect: { addListener: (fn: () => void) => void }
  /** 测试侧攥着，用来模拟侧栏关闭。 */
  disconnect: () => void
  received: ProgressEvent[]
}

let onConnect: (port: FakePort) => void
let onMessage: (
  message: IncomingMessage,
  sender: unknown,
  sendResponse: (response: Response) => void,
) => boolean

/** handle() 每次被调用时留下的现场，测试据此驱动进度与收尾。 */
interface Call {
  deps: HandlerDeps
  resolve: (response: Response) => void
}
let calls: Call[]

const handle = vi.fn((_ports: unknown, _request: unknown, deps: HandlerDeps) =>
  new Promise<Response>((resolve) => { calls.push({ deps, resolve }) }),
)

vi.mock('@/background/handlers', () => ({ handle: (...args: unknown[]) =>
  handle(args[0], args[1], args[2] as HandlerDeps) }))

function fakePort(clientId: string): FakePort {
  const received: ProgressEvent[] = []
  let disconnectHandler = (): void => {}
  return {
    name: progressPortName(clientId),
    postMessage: (event) => received.push(event),
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: (fn) => { disconnectHandler = fn } },
    disconnect: () => disconnectHandler(),
    received,
  }
}

/** 发一条消息，返回后台的响应（同步回的那种）。 */
function send(message: IncomingMessage): Response | null {
  let response: Response | null = null
  onMessage(message, {}, (r) => { response = r })
  return response
}

beforeEach(async () => {
  calls = []
  handle.mockClear()
  vi.resetModules()

  const chromeStub = {
    runtime: {
      onConnect: { addListener: (fn: (port: FakePort) => void) => { onConnect = fn } },
      onMessage: { addListener: (fn: typeof onMessage) => { onMessage = fn } },
      onInstalled: { addListener: () => {} },
    },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
  }
  ;(globalThis as unknown as { chrome: unknown }).chrome = chromeStub

  await import('@/background/service-worker')
})

describe('进度事件按窗口路由', () => {
  it('A 发起的请求，进度只回到 A', () => {
    const a = fakePort('win-a')
    const b = fakePort('win-b')
    onConnect(a)
    onConnect(b)

    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })
    calls[0]!.deps.onEvent?.({ phase: 'classify', message: '分到一半', done: 1, total: 10 })

    expect(a.received.map((e) => e.message)).toEqual(['分到一半'])
    expect(b.received).toEqual([])
  })

  it('B 后连上来不会顶掉 A 正在用的通道', () => {
    const a = fakePort('win-a')
    onConnect(a)
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })

    onConnect(fakePort('win-b'))
    calls[0]!.deps.onEvent?.({ phase: 'classify', message: 'B 连上之后' })

    expect(a.received.map((e) => e.message)).toEqual(['B 连上之后'])
  })

  it('apply 这类不吃取消的请求，进度同样按窗口回', () => {
    const a = fakePort('win-a')
    const b = fakePort('win-b')
    onConnect(a)
    onConnect(b)

    send({ kind: 'undo', clientId: 'win-b' })
    calls[0]!.deps.onEvent?.({ phase: 'undo', message: '正在还原' })

    expect(b.received.map((e) => e.message)).toEqual(['正在还原'])
    expect(a.received).toEqual([])
  })
})

describe('取消不跨窗口', () => {
  it('在 B 点取消，掐不到 A 那一轮', () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })
    const aDeps = calls[0]!.deps

    send({ kind: 'cancel', clientId: 'win-b' })

    expect(aDeps.isCancelled?.()).toBe(false)
    expect(aDeps.signal?.aborted).toBe(false)
  })

  it('在自己窗口点取消，标记与信号都到位', () => {
    onConnect(fakePort('win-a'))
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })
    const aDeps = calls[0]!.deps

    send({ kind: 'cancel', clientId: 'win-a' })

    expect(aDeps.isCancelled?.()).toBe(true)
    expect(aDeps.signal?.aborted).toBe(true)
  })

  it('取消的日志只发给点取消的那个窗口，且没有自己那一轮时不发', () => {
    const a = fakePort('win-a')
    const b = fakePort('win-b')
    onConnect(a)
    onConnect(b)
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })

    send({ kind: 'cancel', clientId: 'win-b' })
    expect(b.received).toEqual([])

    send({ kind: 'cancel', clientId: 'win-a' })
    expect(a.received).toHaveLength(1)
    expect(a.received[0]!.level).toBe('warn')
  })
})

describe('一次只放一轮长任务', () => {
  it('别的窗口占着时回绝，并且不去调 handle', () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })
    expect(handle).toHaveBeenCalledTimes(1)

    const response = send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-b' })

    expect(response?.ok).toBe(false)
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('A 跑完之后 B 就能开跑', async () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })

    calls[0]!.resolve({ ok: false, error: 'done' })
    // 放开占用发生在 then→catch→finally 这条链的末尾，要把微任务队列走干净再断言
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-b' })).toBeNull()
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('handle 抛异常也要放开占用，不能把后台永久锁死', async () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    handle.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })

    await vi.waitFor(() => {
      expect(send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-b' })).toBeNull()
    })
  })

  /**
   * apply 与 undo 共用 engine/snapshot.ts 里唯一那个 SNAPSHOT_KEY：两个窗口同时落地，
   * 后写的快照会把先写的整个盖掉，先落地那一次再也撤销不回去。所以它们必须独占。
   */
  it('A 在落地时，B 的落地被挡下来，一个书签都不碰', () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    send({ kind: 'apply', plan: {} as never, accepted: [], clientId: 'win-a' })
    expect(handle).toHaveBeenCalledTimes(1)

    const response = send({ kind: 'apply', plan: {} as never, accepted: [], clientId: 'win-b' })

    expect(response?.ok).toBe(false)
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('A 在落地时，B 的撤销也被挡下来', () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    send({ kind: 'apply', plan: {} as never, accepted: [], clientId: 'win-a' })

    expect(send({ kind: 'undo', clientId: 'win-b' })?.ok).toBe(false)
  })

  it('A 在分析时，B 的落地被挡下来——方案是对着改之前那棵树算的', () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })

    expect(send({ kind: 'apply', plan: {} as never, accepted: [], clientId: 'win-b' })?.ok).toBe(false)
  })

  it('导入与清理落地同样独占', () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    send({ kind: 'import', nodes: [], targetName: 'x', clientId: 'win-a' })

    expect(send({ kind: 'apply_cleanup', input: {} as never, clientId: 'win-b' })?.ok).toBe(false)
  })

  it('落地跑完之后位子放开', async () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))
    send({ kind: 'apply', plan: {} as never, accepted: [], clientId: 'win-a' })

    calls[0]!.resolve({ ok: false, error: 'done' })
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(send({ kind: 'undo', clientId: 'win-b' })).toBeNull()
  })

  it('落地不吃取消信号，点取消也不受理', () => {
    const a = fakePort('win-a')
    onConnect(a)
    send({ kind: 'apply', plan: {} as never, accepted: [], clientId: 'win-a' })

    send({ kind: 'cancel', clientId: 'win-a' })

    // 没有信号可给，也不该打一句「正在取消」——它取消不了
    expect(calls[0]!.deps.signal).toBeUndefined()
    expect(calls[0]!.deps.isCancelled?.()).toBe(false)
    expect(a.received).toEqual([])
  })

  it('短请求不占用这个位子', () => {
    onConnect(fakePort('win-a'))
    onConnect(fakePort('win-b'))

    send({ kind: 'get_tree', clientId: 'win-a' })

    expect(send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-b' })).toBeNull()
    expect(handle).toHaveBeenCalledTimes(2)
  })

  it('短请求拿不到正在跑那一轮的取消信号', () => {
    onConnect(fakePort('win-a'))
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })
    send({ kind: 'get_settings', clientId: 'win-a' })

    expect(calls[1]!.deps.signal).toBeUndefined()
  })
})

describe('没报身份的老侧栏', () => {
  it('裸连接名与不带 clientId 的消息落在同一个匿名槽里，仍然收得到进度', () => {
    const legacy = fakePort('')
    legacy.name = 'reshelve:progress'
    onConnect(legacy)

    send({ kind: 'analyze', scopeRootIds: ['1'] } as IncomingMessage)
    calls[0]!.deps.onEvent?.({ phase: 'classify', message: '老侧栏也收得到' })

    expect(legacy.received.map((e) => e.message)).toEqual(['老侧栏也收得到'])
  })

  it('不是进度通道的连接一概不理', () => {
    const stranger = fakePort('x')
    stranger.name = 'someone-else'

    expect(() => onConnect(stranger)).not.toThrow()
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'x' })
    calls[0]!.deps.onEvent?.({ phase: 'classify', message: '不该到达' })

    expect(stranger.received).toEqual([])
  })
})

describe('侧栏关闭', () => {
  it('关掉窗口不中止在跑的那一轮，事件丢掉即可', () => {
    const a = fakePort('win-a')
    onConnect(a)
    send({ kind: 'analyze', scopeRootIds: ['1'], clientId: 'win-a' })
    const aDeps = calls[0]!.deps

    a.disconnect()
    aDeps.onEvent?.({ phase: 'classify', message: '无人接收' })

    expect(aDeps.signal?.aborted).toBe(false)
    expect(a.received).toEqual([])
  })
})
