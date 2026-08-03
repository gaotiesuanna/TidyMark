import { describe, it, expect } from 'vitest'
import { classifyByRules } from '@/core/rules'
import type { BookmarkItem } from '@/core/types'

function item(url: string, title = 'T'): BookmarkItem {
  return { id: '1', title, url, parentId: '10', index: 0, currentPath: [] }
}

describe('classifyByRules', () => {
  it('识别 GitHub 仓库并抽出 owner 与 repo', () => {
    const r = classifyByRules(item('https://github.com/facebook/react'))!
    expect(r.resourceType).toBe('repository')
    expect(r.tags).toEqual(['GitHub', 'facebook', 'react'])
  })

  it('GitHub 首页不抽 owner/repo', () => {
    const r = classifyByRules(item('https://github.com'))!
    expect(r.tags).toEqual(['GitHub'])
  })

  it('识别论文站点', () => {
    expect(classifyByRules(item('https://arxiv.org/abs/2301.00001'))!.resourceType).toBe('paper')
    expect(classifyByRules(item('https://openreview.net/forum'))!.resourceType).toBe('paper')
  })

  it('识别视频站点', () => {
    expect(classifyByRules(item('https://www.youtube.com/watch'))!.resourceType).toBe('video')
    expect(classifyByRules(item('https://www.bilibili.com/video/BV1'))!.resourceType).toBe('video')
  })

  it('识别 docs./developer. 子域为文档', () => {
    const r = classifyByRules(item('https://docs.python.org/3/'))!
    expect(r.resourceType).toBe('documentation')
    expect(r.tags).toContain('官方文档')
    expect(classifyByRules(item('https://developer.mozilla.org/zh-CN/'))!.resourceType)
      .toBe('documentation')
  })

  it('识别已知工具站点', () => {
    expect(classifyByRules(item('https://www.figma.com/file/x'))!.tags).toContain('设计')
    expect(classifyByRules(item('https://www.notion.so/x'))!.tags).toContain('Notion')
  })

  it('未命中任何规则时返回 null', () => {
    expect(classifyByRules(item('https://blog.someone.dev/post/1'))).toBeNull()
  })

  it('无法清洗的 URL 返回 null', () => {
    expect(classifyByRules(item('chrome://bookmarks'))).toBeNull()
  })

  it('每条命中都带可读的分类原因', () => {
    const r = classifyByRules(item('https://github.com/facebook/react'))!
    expect(r.reason).toContain('github.com')
  })
})
