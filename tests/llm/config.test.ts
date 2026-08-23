import { describe, it, expect } from 'vitest'
import { isLocalBaseUrl, isModelConfigured } from '@/llm/config'
import { DEFAULT_SETTINGS, PRESETS, activeLlm } from '@/storage/settings'

describe('isLocalBaseUrl', () => {
  it('认 localhost 与 127.0.0.1，端口随便填', () => {
    expect(isLocalBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLocalBaseUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalBaseUrl('http://localhost/v1')).toBe(true)
  })

  it('不认 manifest 没声明的那些本机写法——放行了也过不了权限申请那一关', () => {
    // optional_host_permissions 里只有 http://localhost/* 与 http://127.0.0.1/*
    expect(isLocalBaseUrl('http://[::1]:11434/v1')).toBe(false)
    expect(isLocalBaseUrl('http://0.0.0.0:11434/v1')).toBe(false)
    expect(isLocalBaseUrl('http://192.168.1.7:11434/v1')).toBe(false)
  })

  it('不把远程域名里出现的 localhost 当本机', () => {
    expect(isLocalBaseUrl('https://localhost.evil.example.com/v1')).toBe(false)
    expect(isLocalBaseUrl('https://api.openai.com/v1')).toBe(false)
  })

  it('地址还没填成形时是 false——那时确实还不算配好', () => {
    expect(isLocalBaseUrl('')).toBe(false)
    expect(isLocalBaseUrl('localhost:11434')).toBe(false)
  })
})

describe('isModelConfigured', () => {
  it('远程厂商要 Key：空 Key 不算配好，填了才算', () => {
    const llm = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
    expect(isModelConfigured({ ...llm, apiKey: '' })).toBe(false)
    expect(isModelConfigured({ ...llm, apiKey: '   ' })).toBe(false)
    expect(isModelConfigured({ ...llm, apiKey: 'sk-x' })).toBe(true)
  })

  it('本机服务器不要 Key：点完「本地 Ollama」预设、一个字都不再填，就算配好了', () => {
    // 直接拿 PRESETS 里那一项，不抄一份 URL——预设改了这条用例要跟着红
    const ollama = PRESETS.find((preset) => preset.baseUrl.includes('localhost'))!
    const llm = { ...activeLlm(DEFAULT_SETTINGS), baseUrl: ollama.baseUrl, model: ollama.model }
    expect(llm.apiKey).toBe('')
    expect(isModelConfigured(llm)).toBe(true)
  })

  it('默认设置（全新安装）不算配好——否则第一次进来就没人提示他去配', () => {
    expect(isModelConfigured(activeLlm(DEFAULT_SETTINGS))).toBe(false)
  })
})
