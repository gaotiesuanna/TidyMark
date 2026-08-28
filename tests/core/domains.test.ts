import { describe, it, expect } from 'vitest'
import { bookmarkUrls, clampTopDomainCount, domainFolderTree, rankDomains } from '@/core/domains'
import type { BookmarkNode } from '@/core/ports'

describe('rankDomains', () => {
  it('按域名聚合并按次数降序取前 N 个', () => {
    expect(rankDomains([
      { url: 'https://github.com/a' },
      { url: 'https://github.com/b' },
      { url: 'https://github.com/c' },
      { url: 'https://bilibili.com/1' },
      { url: 'https://example.com/' },
    ], 2)).toEqual([
      { domain: 'github.com', count: 3, sampleUrl: 'https://github.com/a' },
      { domain: 'bilibili.com', count: 1, sampleUrl: 'https://bilibili.com/1' },
    ])
  })

  it('www 与裸域算同一个域名', () => {
    expect(rankDomains([
      { url: 'https://www.github.com/a' },
      { url: 'https://github.com/b' },
    ])).toEqual([
      { domain: 'github.com', count: 2, sampleUrl: 'https://www.github.com/a' },
    ])
  })

  it('丢掉无法解析的和非 http(s) 的 URL', () => {
    expect(rankDomains([
      { url: 'javascript:alert(1)' },
      { url: 'chrome://extensions' },
      { url: 'not a url' },
      { url: 'https://ok.com/' },
    ])).toEqual([
      { domain: 'ok.com', count: 1, sampleUrl: 'https://ok.com/' },
    ])
  })

  it('把 weight 加总作为次数，缺省为 1', () => {
    expect(rankDomains([
      { url: 'https://github.com/a', weight: 10 },
      { url: 'https://github.com/b', weight: 5 },
      { url: 'https://example.com/', weight: 12 },
    ]).map((row) => [row.domain, row.count])).toEqual([
      ['github.com', 15],
      ['example.com', 12],
    ])
  })

  it('weight 为 0 或负数的项不计入', () => {
    expect(rankDomains([
      { url: 'https://a.com/', weight: 0 },
      { url: 'https://b.com/', weight: -3 },
      { url: 'https://c.com/' },
    ])).toEqual([
      { domain: 'c.com', count: 1, sampleUrl: 'https://c.com/' },
    ])
  })

  it('次数相同按域名升序，结果稳定', () => {
    expect(rankDomains([
      { url: 'https://zeta.com/' },
      { url: 'https://alpha.com/' },
    ]).map((row) => row.domain)).toEqual(['alpha.com', 'zeta.com'])
  })

  it('空列表返回空数组', () => {
    expect(rankDomains([])).toEqual([])
  })

  it('默认只留前 15 个域名', () => {
    const items = Array.from({ length: 18 }, (_, i) => ({
      url: `https://d${String(i).padStart(2, '0')}.com/`,
      weight: 18 - i,
    }))
    const ranked = rankDomains(items)
    expect(ranked).toHaveLength(15)
    expect(ranked[0]!.domain).toBe('d00.com')
    expect(ranked[14]!.domain).toBe('d14.com')
  })
})

describe('clampTopDomainCount', () => {
  it('缺省与非法值回落到 15', () => {
    expect(clampTopDomainCount(undefined)).toBe(15)
    expect(clampTopDomainCount(Number.NaN)).toBe(15)
    expect(clampTopDomainCount('8')).toBe(15)
  })

  it('小于下限按 1 收，大于上限按 50 收', () => {
    expect(clampTopDomainCount(0)).toBe(1)
    expect(clampTopDomainCount(-3)).toBe(1)
    expect(clampTopDomainCount(999)).toBe(50)
  })

  it('合法整数原样返回，小数四舍五入', () => {
    expect(clampTopDomainCount(8)).toBe(8)
    expect(clampTopDomainCount(8.4)).toBe(8)
    expect(clampTopDomainCount(8.6)).toBe(9)
  })
})

describe('bookmarkUrls', () => {
  it('从书签树抽出所有带 url 的节点，跳过文件夹', () => {
    const tree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: '1', title: 'bar', children: [
          { id: '10', title: 'a', url: 'https://github.com/a' },
          { id: '11', title: 'folder', children: [
            { id: '110', title: 'b', url: 'https://example.com/b' },
          ]},
        ]},
      ]},
    ]
    expect(bookmarkUrls(tree)).toEqual([
      { url: 'https://github.com/a' },
      { url: 'https://example.com/b' },
    ])
  })

  it('深度优先保持树内顺序，先走完子树再处理下一个兄弟', () => {
    const tree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'a', title: 'a', url: 'https://a.com/' },
        { id: 'f', title: 'folder', children: [
          { id: 'b', title: 'b', url: 'https://b.com/' },
        ]},
        { id: 'c', title: 'c', url: 'https://c.com/' },
      ]},
    ]
    expect(bookmarkUrls(tree).map((item) => item.url)).toEqual([
      'https://a.com/',
      'https://b.com/',
      'https://c.com/',
    ])
  })

  it('空树返回空数组', () => {
    expect(bookmarkUrls([])).toEqual([])
  })
})

describe('domainFolderTree', () => {
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: 'bar', title: '书签栏', children: [
        { id: 'dev', title: '开发', children: [
          { id: 'gh', title: 'GitHub', children: [
            { id: 'a', title: 'a', url: 'https://github.com/a' },
            { id: 'b', title: 'b', url: 'https://www.github.com/b' },
          ]},
        ]},
        { id: 'tmp', title: '临时', children: [
          { id: 'c', title: 'c', url: 'https://github.com/c' },
        ]},
        { id: 'd', title: 'd', url: 'https://bilibili.com/1' },
        { id: 'e', title: 'e', url: 'javascript:alert(1)' },
      ]},
      { id: 'other', title: '其他书签', children: [
        { id: 'f', title: 'f', url: 'https://github.com/f' },
      ]},
    ]},
  ]

  it('按文件夹层级建树，子孙数汇总到父级，过道文件夹折叠', () => {
    expect(domainFolderTree(tree, 'github.com')).toEqual([
      {
        id: 'bar', title: '书签栏', count: 3, directCount: 0, bookmarks: [], children: [
          {
            id: 'gh', title: '开发 / GitHub', count: 2, directCount: 2, children: [],
            bookmarks: [
              { id: 'a', title: 'a', url: 'https://github.com/a' },
              { id: 'b', title: 'b', url: 'https://www.github.com/b' },
            ],
          },
          {
            id: 'tmp', title: '临时', count: 1, directCount: 1, children: [],
            bookmarks: [{ id: 'c', title: 'c', url: 'https://github.com/c' }],
          },
        ],
      },
      {
        id: 'other', title: '其他书签', count: 1, directCount: 1, children: [],
        bookmarks: [{ id: 'f', title: 'f', url: 'https://github.com/f' }],
      },
    ])
  })

  it('每个文件夹带上其中的书签标题和 URL，保持树内顺序', () => {
    const gh = domainFolderTree(tree, 'github.com')[0]?.children.find((n) => n.id === 'gh')
    expect(gh?.bookmarks).toEqual([
      { id: 'a', title: 'a', url: 'https://github.com/a' },
      { id: 'b', title: 'b', url: 'https://www.github.com/b' },
    ])
  })

  it('www 与裸域计入同一 domain', () => {
    const [bar] = domainFolderTree(tree, 'github.com')
    expect(bar?.children[0]?.count).toBe(2)
  })

  it('根下书签落在根文件夹自己名下，空标题根不成行', () => {
    expect(domainFolderTree(tree, 'bilibili.com')).toEqual([
      {
        id: 'bar', title: '书签栏', count: 1, directCount: 1, children: [],
        bookmarks: [{ id: 'd', title: 'd', url: 'https://bilibili.com/1' }],
      },
    ])
  })

  it('同层按 count 降序，同数按标题稳定', () => {
    const tied: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'z', title: 'zeta', children: [
          { id: 'z1', title: 'z1', url: 'https://x.com/1' },
        ]},
        { id: 'a', title: 'alpha', children: [
          { id: 'a1', title: 'a1', url: 'https://x.com/2' },
        ]},
      ]},
    ]
    expect(domainFolderTree(tied, 'x.com').map((n) => n.title)).toEqual([
      'alpha',
      'zeta',
    ])
  })

  it('无关域名和非 http(s) 不进结果', () => {
    expect(domainFolderTree(tree, 'example.com')).toEqual([])
    expect(domainFolderTree(tree, 'javascript:alert(1)')).toEqual([])
  })

  it('根节点 count 等于该域名在树上的书签总数', () => {
    const total = domainFolderTree(tree, 'github.com').reduce((n, node) => n + node.count, 0)
    expect(total).toBe(4)
  })

  it('自己有书签又有子文件夹的分支不折叠，directCount 反映直接书签', () => {
    const mixed: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'p', title: '项目', children: [
          { id: 'p1', title: 'p1', url: 'https://x.com/1' },
          { id: 'sub', title: '子', children: [
            { id: 's1', title: 's1', url: 'https://x.com/2' },
          ]},
        ]},
      ]},
    ]
    expect(domainFolderTree(mixed, 'x.com')).toEqual([
      {
        id: 'p', title: '项目', count: 2, directCount: 1,
        bookmarks: [{ id: 'p1', title: 'p1', url: 'https://x.com/1' }],
        children: [
          {
            id: 'sub', title: '子', count: 1, directCount: 1, children: [],
            bookmarks: [{ id: 's1', title: 's1', url: 'https://x.com/2' }],
          },
        ],
      },
    ])
  })
})
