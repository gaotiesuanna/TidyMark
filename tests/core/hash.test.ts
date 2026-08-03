import { describe, it, expect } from 'vitest'
import { djb2 } from '@/core/hash'

describe('djb2', () => {
  it('同一输入产生同一输出', () => {
    expect(djb2('https://react.dev')).toBe(djb2('https://react.dev'))
  })
  it('不同输入产生不同输出', () => {
    expect(djb2('a')).not.toBe(djb2('b'))
  })
  it('输出是非空字符串', () => {
    expect(djb2('x')).toMatch(/^[a-z0-9]+$/)
  })
})
