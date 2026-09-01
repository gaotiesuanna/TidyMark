import { describe, it, expect } from 'vitest'
import { classifyByRules } from '@/core/rules'
import type { BookmarkItem } from '@/core/types'

function item(url: string, title = 'T'): BookmarkItem {
  return { id: '1', title, url, parentId: '10', index: 0, currentPath: [] }
}

describe('classifyByRules', () => {
  it('识别 GitHub 仓库并抽出 owner 与 repo', () => {
    const r = classifyByRules(item('https://github.com/facebook/react'), 'zh_CN')!
    expect(r.resourceType).toBe('repository')
    expect(r.tags).toEqual(['GitHub', 'facebook', 'react'])
  })
  it('skill 仓库优先识别为独立技能类型', () => {
    const r = classifyByRules(
      item('https://github.com/op7418/Claude-to-IM-skill', 'Claude-to-IM-skill'),
      'zh_CN',
    )!
    expect(r.tags).toEqual(['技能'])
    expect(r.resourceType).toBe('tool')
  })

  it('GitHub 首页不抽 owner/repo', () => {
    const r = classifyByRules(item('https://github.com'), 'zh_CN')!
    expect(r.tags).toEqual(['GitHub'])
  })

  it('识别论文站点', () => {
    expect(classifyByRules(item('https://arxiv.org/abs/2301.00001'), 'zh_CN')!.resourceType).toBe('paper')
    expect(classifyByRules(item('https://openreview.net/forum'), 'zh_CN')!.resourceType).toBe('paper')
  })

  it('识别视频站点', () => {
    expect(classifyByRules(item('https://www.youtube.com/watch'), 'zh_CN')!.resourceType).toBe('video')
    expect(classifyByRules(item('https://www.bilibili.com/video/BV1'), 'zh_CN')!.resourceType).toBe('video')
  })

  it('识别 docs./developer. 子域为文档', () => {
    const r = classifyByRules(item('https://docs.python.org/3/'), 'zh_CN')!
    expect(r.resourceType).toBe('documentation')
    expect(r.tags).toContain('官方文档')
    expect(classifyByRules(item('https://developer.mozilla.org/zh-CN/'), 'zh_CN')!.resourceType)
      .toBe('documentation')
  })

  it('识别已知工具站点', () => {
    expect(classifyByRules(item('https://www.figma.com/file/x'), 'zh_CN')!.tags).toContain('设计')
    expect(classifyByRules(item('https://www.notion.so/x'), 'zh_CN')!.tags).toContain('Notion')
  })

  it('未命中任何规则时返回 null', () => {
    expect(classifyByRules(item('https://blog.someone.dev/post/1'), 'zh_CN')).toBeNull()
  })

  it('无法清洗的 URL 返回 null', () => {
    expect(classifyByRules(item('chrome://bookmarks'), 'zh_CN')).toBeNull()
  })

  it('每条命中都带可读的分类原因', () => {
    const r = classifyByRules(item('https://github.com/facebook/react'), 'zh_CN')!
    expect(r.reason).toContain('github.com')
  })
})

describe('classifyByRules 双语', () => {
  const paper = { id: '1', title: 'x', url: 'https://arxiv.org/abs/1706.03762', parentId: '0', index: 0, currentPath: [] }
  const video = { id: '2', title: 'y', url: 'https://youtube.com/watch', parentId: '0', index: 0, currentPath: [] }
  const docs = { id: '3', title: 'z', url: 'https://docs.python.org/3/', parentId: '0', index: 0, currentPath: [] }

  it('中文 locale 给出中文标签', () => {
    expect(classifyByRules(paper, 'zh_CN')!.tags).toEqual(['论文'])
    expect(classifyByRules(video, 'zh_CN')!.tags).toEqual(['视频'])
    expect(classifyByRules(docs, 'zh_CN')!.tags).toEqual(['官方文档'])
  })

  it('英文 locale 给出英文标签', () => {
    expect(classifyByRules(paper, 'en')!.tags).toEqual(['Papers'])
    expect(classifyByRules(video, 'en')!.tags).toEqual(['Videos'])
    expect(classifyByRules(docs, 'en')!.tags).toEqual(['Docs'])
  })

  it('专有名词两种语言相同，不做翻译', () => {
    const gh = { id: '4', title: 'g', url: 'https://github.com/a/b', parentId: '0', index: 0, currentPath: [] }
    expect(classifyByRules(gh, 'zh_CN')!.tags).toEqual(['GitHub', 'a', 'b'])
    expect(classifyByRules(gh, 'en')!.tags).toEqual(['GitHub', 'a', 'b'])
  })

  it('判定理由也跟随语言', () => {
    expect(classifyByRules(paper, 'zh_CN')!.reason).toContain('域名规则')
    expect(classifyByRules(paper, 'en')!.reason).toContain('domain rule')
  })
})

/**
 * 平台名（GitHub / GitLab / Notion / StackOverflow）说的是「托管在哪」，
 * 不是「这是什么」。它不该决定归属，否则一个叫「GitHub」的目录会把库里
 * 每一条 github.com 书签都吸过去，模型一次都轮不到。
 */
describe('平台名不参与归属判定', () => {
  it('GitHub 仓库只把 owner/repo 交给归属判定，平台名留在 tags 里', () => {
    const r = classifyByRules(item('https://github.com/facebook/react'), 'zh_CN')!
    expect(r.tags).toEqual(['GitHub', 'facebook', 'react'])
    expect(r.placement).toEqual(['facebook', 'react'])
    expect(r.semantic).toBe(false)
  })

  it('路径不足两段的 GitHub 链接没有任何可判定的名字', () => {
    const r = classifyByRules(item('https://github.com'), 'zh_CN')!
    expect(r.tags).toEqual(['GitHub'])
    expect(r.placement).toEqual([])
  })

  it.each([
    ['https://gitlab.com/a/b', 'GitLab'],
    ['https://www.notion.so/x', 'Notion'],
    ['https://stackoverflow.com/questions/1', 'StackOverflow'],
  ])('%s 的平台名不进 placement', (url, tag) => {
    const r = classifyByRules(item(url), 'zh_CN')!
    expect(r.tags).toEqual([tag])
    expect(r.placement).toEqual([])
  })

  it.each([
    ['https://arxiv.org/abs/2301.00001', '论文'],
    ['https://www.youtube.com/watch', '视频'],
    ['https://www.figma.com/file/x', '设计'],
    ['https://docs.python.org/3/', '官方文档'],
  ])('%s 是语义规则，照旧参与判定', (url, tag) => {
    const r = classifyByRules(item(url), 'zh_CN')!
    expect(r.placement).toEqual([tag])
    expect(r.semantic).toBe(true)
  })

  it('skill 仓库是语义规则，不受平台名退让影响', () => {
    const r = classifyByRules(
      item('https://github.com/op7418/Claude-to-IM-skill', 'Claude-to-IM-skill'),
      'zh_CN',
    )!
    expect(r.placement).toEqual(['技能'])
    expect(r.semantic).toBe(true)
  })
})
