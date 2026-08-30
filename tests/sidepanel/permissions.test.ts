import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import {
  ensureAllHostsPermission, ensureHostPermission, hasHostPermission,
} from '@/sidepanel/lib/permissions'

const chromeGlobal = globalThis as unknown as { chrome: { permissions: unknown } }
const originalPermissions = chromeGlobal.chrome?.permissions

/** 记下每次拿到的 origins，断言的重点是「申请的是哪个模式」而不只是「申请了没有」。 */
let asked: string[][]
let contains: ReturnType<typeof vi.fn>
let request: ReturnType<typeof vi.fn>

beforeEach(() => {
  asked = []
  contains = vi.fn(({ origins }: { origins: string[] }) => {
    asked.push(origins)
    return Promise.resolve(false)
  })
  request = vi.fn(({ origins }: { origins: string[] }) => {
    asked.push(origins)
    return Promise.resolve(true)
  })
  chromeGlobal.chrome = { ...chromeGlobal.chrome, permissions: { contains, request } }
})

afterAll(() => {
  chromeGlobal.chrome.permissions = originalPermissions
})

/**
 * 这一组守的是那个「静默炸掉」的 bug：Chrome 的 match pattern 里 host 一段没有端口
 * 语法，把 URL.origin 原样拼进去，permissions API 会当场抛，而 analyze() 那条路上
 * 没人接——点按钮界面一动不动。
 */
describe('带端口的端点', () => {
  it('拼出的 match pattern 不带端口', async () => {
    await ensureHostPermission('https://proxy.example.com:8443/v1')

    expect(asked).toEqual([
      ['https://proxy.example.com/*'],
      ['https://proxy.example.com/*'],
    ])
  })

  it('端口不同但主机相同时问的是同一个模式', async () => {
    await hasHostPermission('https://proxy.example.com:8443/v1')
    await hasHostPermission('https://proxy.example.com/v1')

    expect(asked).toEqual([
      ['https://proxy.example.com/*'],
      ['https://proxy.example.com/*'],
    ])
  })

  it('已经授权过就不再弹第二次', async () => {
    contains.mockResolvedValue(true)

    expect(await ensureHostPermission('https://proxy.example.com:8443/v1')).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('permissions API 抛异常时', () => {
  it('contains 抛出来时答「没有权限」而不是把异常放出去', async () => {
    contains.mockRejectedValue(new Error('Invalid value for origins[0]'))

    await expect(hasHostPermission('https://proxy.example.com:8443/v1')).resolves.toBe(false)
  })

  it('request 抛出来时答「没申请到」而不是把异常放出去', async () => {
    contains.mockResolvedValue(false)
    request.mockRejectedValue(new Error('Invalid value for origins[0]'))

    await expect(ensureHostPermission('https://proxy.example.com:8443/v1')).resolves.toBe(false)
  })

  it('IPv6 字面量这类 hostPattern 没挡住的地址同样只是答 false', async () => {
    // 模式非法时 contains 与 request 都会抛，两个都要挡住才算真的不往外放异常
    contains.mockRejectedValue(new Error('Invalid value for origins[0]'))
    request.mockRejectedValue(new Error('Invalid value for origins[0]'))

    await expect(ensureHostPermission('http://[::1]:11434/v1')).resolves.toBe(false)
  })
})

describe('拼不出模式的地址', () => {
  it('地址还在敲一半时不惊动 permissions API', async () => {
    expect(await ensureHostPermission('http')).toBe(false)
    expect(contains).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('非 http(s) 协议直接答 false——它没有对应的 match pattern', async () => {
    expect(await ensureHostPermission('file:///models/v1')).toBe(false)
    expect(contains).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
})

/**
 * 本机模型服务器**不再短路**。以前对 localhost 直接答 true、一次权限都不申请，
 * 结果是后台那次 fetch 退化成普通跨源请求，落到 Ollama 的 CORS 上——而它默认
 * 不放行扩展源（实测 chrome-extension:// 的预检 403）。于是 README 承诺支持的
 * 本机模型这条路整个打不开，用户只看得到一句 Failed to fetch。
 */
describe('本地模型服务器', () => {
  it('localhost 照常申请权限，拼出的模式与 manifest 里那条一致', async () => {
    await ensureHostPermission('http://localhost:11434/v1')

    expect(asked).toEqual([
      ['http://localhost/*'],
      ['http://localhost/*'],
    ])
  })

  it('127.0.0.1 同样要申请', async () => {
    await hasHostPermission('http://127.0.0.1:1234/v1')

    expect(asked).toEqual([['http://127.0.0.1/*']])
  })

  it('已经授权过的本机端点不再重复弹窗', async () => {
    contains.mockResolvedValue(true)

    expect(await ensureHostPermission('http://localhost:11434/v1')).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('用户拒绝时如实答 false，而不是假装本机不用授权', async () => {
    contains.mockResolvedValue(false)
    request.mockResolvedValue(false)

    expect(await ensureHostPermission('http://localhost:11434/v1')).toBe(false)
  })
})

describe('「访问所有网站」是另一条路', () => {
  it('申请的是两条通配模式，与端点那条互不相干', async () => {
    await ensureAllHostsPermission()

    expect(asked).toEqual([
      ['https://*/*', 'http://*/*'],
      ['https://*/*', 'http://*/*'],
    ])
  })
})
