import { describe, it, expect } from 'vitest'
import { DOMAIN_GROUPS, matchDomainGroup } from '@/core/domainGroups'
import type { BookmarkItem } from '@/core/types'

function item(url: string): BookmarkItem {
  return { id: '1', title: 't', url, parentId: '0', index: 0, currentPath: [] }
}

const ALL = DOMAIN_GROUPS.map((g) => g.key)

describe('matchDomainGroup', () => {
  it('github.com 命中 github 组', () => {
    const url = 'https://github.com/jnMetaCode/superpowers-zh/blob/main/docs/README.codex.md'
    expect(matchDomainGroup(item(url), ALL)?.key).toBe('github')
  })

  it('www 前缀不影响匹配', () => {
    expect(matchDomainGroup(item('https://www.github.com/a/b'), ALL)?.key).toBe('github')
  })

  it('域名出现在路径里不算命中', () => {
    expect(matchDomainGroup(item('https://evil.com/github.com/x'), ALL)).toBeNull()
  })

  it('子域不算命中 github', () => {
    expect(matchDomainGroup(item('https://gist.github.com/a'), ALL)).toBeNull()
  })

  it('docs. 与 developer. 前缀命中 docs 组', () => {
    expect(matchDomainGroup(item('https://docs.python.org/3/'), ALL)?.key).toBe('docs')
    expect(matchDomainGroup(item('https://developer.mozilla.org/en-US/'), ALL)?.key).toBe('docs')
  })

  it('视频与论文组各自命中', () => {
    expect(matchDomainGroup(item('https://www.youtube.com/watch'), ALL)?.key).toBe('video')
    expect(matchDomainGroup(item('https://www.bilibili.com/video/1'), ALL)?.key).toBe('video')
    expect(matchDomainGroup(item('https://arxiv.org/abs/2401.00001'), ALL)?.key).toBe('paper')
  })

  it('未勾选的组不匹配', () => {
    expect(matchDomainGroup(item('https://github.com/a/b'), [])).toBeNull()
    expect(matchDomainGroup(item('https://github.com/a/b'), ['paper'])).toBeNull()
  })

  it('非 http(s) 与非法 URL 返回 null', () => {
    expect(matchDomainGroup(item('chrome://bookmarks'), ALL)).toBeNull()
    expect(matchDomainGroup(item('not a url'), ALL)).toBeNull()
  })

  it('组 key 唯一', () => {
    expect(new Set(ALL).size).toBe(ALL.length)
  })
})
