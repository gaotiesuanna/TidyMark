import { describe, it, expect } from 'vitest'
import {
  bookmarkUrls,
  siteName,
  clampTopDomainCount,
  domainFolderTree,
  rankDomains,
  visitFolderTree,
  visitSplitTree,
} from '@/core/domains'
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
      { url: 'https://github.com/a', title: 'a' },
      { url: 'https://example.com/b', title: 'b' },
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

describe('visitFolderTree', () => {
  it('nests pages by URL path and sums visit weights on each folder', () => {
    const tree = visitFolderTree([
      { url: 'https://localhost/analysis/library', title: 'Lib', weight: 315 },
      { url: 'https://localhost/analysis/library/5', title: 'Lib5', weight: 155 },
      { url: 'https://localhost/home', title: 'Home', weight: 242 },
    ], 'localhost')

    expect(tree.map((node) => [node.title, node.count])).toEqual([
      ['analysis / library', 470],
      ['home', 242],
    ])
    const library = tree[0]
    expect(library?.bookmarks).toEqual([
      { id: 'https://localhost/analysis/library', title: 'Lib', url: 'https://localhost/analysis/library', weight: 315 },
    ])
    expect(library?.children).toEqual([
      {
        id: 'analysis/library/5',
        title: '5',
        count: 155,
        directCount: 1,
        children: [],
        pageOnly: true,
        bookmarks: [
          { id: 'https://localhost/analysis/library/5', title: 'Lib5', url: 'https://localhost/analysis/library/5', weight: 155 },
        ],
      },
    ])
  })

  it('keeps a folder that has both a page and children', () => {
    const tree = visitFolderTree([
      { url: 'https://localhost/settings', title: 'Settings', weight: 121 },
      { url: 'https://localhost/settings/tasks', title: 'Tasks', weight: 210 },
    ], 'localhost')

    expect(tree).toEqual([
      {
        id: 'settings',
        title: 'settings',
        count: 331,
        directCount: 1,
        bookmarks: [
          { id: 'https://localhost/settings', title: 'Settings', url: 'https://localhost/settings', weight: 121 },
        ],
        children: [
          {
            id: 'settings/tasks',
            title: 'tasks',
            count: 210,
            directCount: 1,
            children: [],
            pageOnly: true,
            bookmarks: [
              { id: 'https://localhost/settings/tasks', title: 'Tasks', url: 'https://localhost/settings/tasks', weight: 210 },
            ],
          },
        ],
      },
    ])
  })

  it('keeps the domain root page on a nameless node', () => {
    const tree = visitFolderTree([
      { url: 'https://localhost/', title: 'Root', weight: 213 },
    ], 'localhost')

    expect(tree).toEqual([
      {
        id: '/',
        title: '',
        count: 213,
        directCount: 1,
        children: [],
        bookmarks: [
          { id: 'https://localhost/', title: 'Root', url: 'https://localhost/', weight: 213 },
        ],
      },
    ])
  })

  it('ignores other domains and non-positive weights', () => {
    expect(visitFolderTree([
      { url: 'https://github.com/a', title: 'A', weight: 9 },
      { url: 'https://localhost/x', title: 'X', weight: 0 },
    ], 'localhost')).toEqual([])
  })

  it('merges query variants of the same path and sums visits', () => {
    const tree = visitFolderTree([
      { url: 'https://localhost/analysis/library?tab=a', title: '短标题', weight: 40 },
      { url: 'https://localhost/analysis/library', title: '墨析 · 小说拆解工作台', weight: 315 },
      { url: 'https://localhost/analysis/library?x=1#h', title: 'Other', weight: 94 },
    ], 'localhost')

    expect(tree).toHaveLength(1)
    expect(tree[0]?.count).toBe(449)
    expect(tree[0]?.directCount).toBe(1)
    expect(tree[0]?.bookmarks).toEqual([
      {
        id: 'https://localhost/analysis/library',
        title: '墨析 · 小说拆解工作台',
        url: 'https://localhost/analysis/library',
        weight: 449,
      },
    ])
  })
})

describe('visitFolderTree 单页目录', () => {
  it('路径段底下只有一个页面、再没别的分支时标成 pageOnly', () => {
    const tree = visitFolderTree([
      { url: 'https://192.168.5.39/task', title: 'PalClaw', weight: 741 },
      { url: 'https://192.168.5.39/', title: 'PalClaw', weight: 343 },
      { url: 'https://192.168.5.39/mailbox', title: 'PalClaw', weight: 1 },
      { url: 'https://192.168.5.39/mailbox/inbox', title: 'PalClaw', weight: 124 },
      { url: 'https://192.168.5.39/mailbox/all', title: 'PalClaw', weight: 24 },
    ], '192.168.5.39')

    const task = tree.find((node) => node.title === 'task')
    expect(task?.pageOnly).toBe(true)
    expect(task?.bookmarks.map((b) => b.url)).toEqual(['https://192.168.5.39/task'])

    // mailbox 底下有别的分支，仍然是个目录
    const mailbox = tree.find((node) => node.title === 'mailbox')
    expect(mailbox?.pageOnly).toBeUndefined()
    expect(mailbox?.children.map((child) => [child.title, child.pageOnly])).toEqual([
      ['inbox', true],
      ['all', true],
    ])
  })

  it('pageOnly 的节点仍按次数排在同层里，不被提到页面堆里', () => {
    const tree = visitFolderTree([
      { url: 'https://localhost/a', title: 'A', weight: 10 },
      { url: 'https://localhost/b', title: 'B', weight: 30 },
      { url: 'https://localhost/c/1', title: 'C1', weight: 20 },
      { url: 'https://localhost/c/2', title: 'C2', weight: 1 },
    ], 'localhost')

    expect(tree.map((node) => [node.title, node.count])).toEqual([
      ['c', 21],
      ['b', 30],
      ['a', 10],
    ].sort((x, y) => (y[1] as number) - (x[1] as number)))
  })

  it('过道折叠出来的单页节点也算 pageOnly', () => {
    const tree = visitFolderTree([
      { url: 'https://localhost/a/b/c', title: 'ABC', weight: 5 },
    ], 'localhost')

    expect(tree).toHaveLength(1)
    expect(tree[0]?.title).toBe('a / b / c')
    expect(tree[0]?.pageOnly).toBe(true)
  })
})

describe('visitSplitTree', () => {
  const tree: BookmarkNode[] = [
    { id: '0', title: '', children: [
      { id: 'bar', title: '书签栏', children: [
        { id: 'dev', title: '开发', children: [
          { id: 'lib', title: '墨析 · 小说拆解工作台', url: 'https://localhost/analysis/library' },
        ]},
        { id: 'home', title: '首页', url: 'https://localhost/home' },
      ]},
    ]},
  ]

  it('已收藏的页面单列一段，带上所在文件夹路径', () => {
    const split = visitSplitTree([
      { url: 'https://localhost/analysis/library', title: 'Lib', weight: 502 },
      { url: 'https://localhost/home', title: 'Home', weight: 90 },
      { url: 'https://localhost/analysis/upload', title: 'Upload', weight: 62 },
    ], tree, 'localhost')

    expect(split.saved).toEqual([
      {
        id: 'https://localhost/analysis/library',
        title: '墨析 · 小说拆解工作台',
        url: 'https://localhost/analysis/library',
        weight: 502,
        folderPath: ['书签栏', '开发'],
      },
      {
        id: 'https://localhost/home',
        title: '首页',
        url: 'https://localhost/home',
        weight: 90,
        folderPath: ['书签栏'],
      },
    ])
  })

  it('没收藏的页面还是按 URL 路径搭树，且不含已收藏的那些', () => {
    const split = visitSplitTree([
      { url: 'https://localhost/analysis/library', title: 'Lib', weight: 502 },
      { url: 'https://localhost/analysis/upload', title: 'Upload', weight: 62 },
      { url: 'https://localhost/analysis/single', title: 'Single', weight: 13 },
    ], tree, 'localhost')

    expect(split.unsaved).toHaveLength(1)
    expect(split.unsaved[0]?.title).toBe('analysis')
    expect(split.unsaved[0]?.count).toBe(75)
    expect(split.unsaved[0]?.children.map((child) => child.title)).toEqual(['upload', 'single'])
    expect(split.unsaved[0]?.children.flatMap((child) => child.bookmarks.map((b) => b.url))).toEqual([
      'https://localhost/analysis/upload',
      'https://localhost/analysis/single',
    ])
  })

  it('带 query/hash 的访问算命中同一条书签，次数合并', () => {
    const split = visitSplitTree([
      { url: 'https://localhost/analysis/library?tab=a', title: 'A', weight: 40 },
      { url: 'https://localhost/analysis/library', title: 'B', weight: 315 },
    ], tree, 'localhost')

    expect(split.saved).toHaveLength(1)
    expect(split.saved[0]?.weight).toBe(355)
    expect(split.unsaved).toEqual([])
  })

  it('躺在根目录的书签给空路径，其它域名和 0 次访问都丢掉', () => {
    const flat: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'x', title: '首页', url: 'https://localhost/home' },
      ]},
    ]
    const split = visitSplitTree([
      { url: 'https://localhost/home', title: 'Home', weight: 9 },
      { url: 'https://github.com/a', title: 'A', weight: 99 },
      { url: 'https://localhost/dead', title: 'Dead', weight: 0 },
    ], flat, 'localhost')

    expect(split.saved).toEqual([
      {
        id: 'https://localhost/home',
        title: '首页',
        url: 'https://localhost/home',
        weight: 9,
        folderPath: [],
      },
    ])
    expect(split.unsaved).toEqual([])
  })

  it('书签标题为空时退回访问记录里的页面标题', () => {
    const untitled: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'x', title: '   ', url: 'https://localhost/home' },
      ]},
    ]
    const split = visitSplitTree(
      [{ url: 'https://localhost/home', title: 'Home', weight: 4 }],
      untitled,
      'localhost',
    )

    expect(split.saved[0]?.title).toBe('Home')
  })
})

describe('visitFolderTree 同形 ID 段合并', () => {
  const palclaw = (path: string, weight: number, title = 'PalClaw 7x24 AI专属顾问') =>
    ({ url: `https://192.168.5.39${path}`, title, weight })

  it('同层三个以上的 ID 段并成一行，次数求和、标题取共有那个', () => {
    const tree = visitFolderTree([
      palclaw('/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', 9),
      palclaw('/tasks/c69350df521240909ec967c712200cfa', 8),
      palclaw('/tasks/bd8c838b055c45dc984b0f28bef6684b', 7),
    ], '192.168.5.39')

    // tasks 自己没有页面、底下只剩这个合并行，两者并成一行，名字留 tasks 的
    expect(tree).toEqual([
      {
        id: 'tasks/*',
        title: 'tasks',
        pageTitle: 'PalClaw 7x24 AI专属顾问',
        grouped: true,
        count: 24,
        directCount: 3,
        children: [],
        bookmarks: [
          { id: 'https://192.168.5.39/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', title: 'PalClaw 7x24 AI专属顾问', url: 'https://192.168.5.39/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', weight: 9 },
          { id: 'https://192.168.5.39/tasks/c69350df521240909ec967c712200cfa', title: 'PalClaw 7x24 AI专属顾问', url: 'https://192.168.5.39/tasks/c69350df521240909ec967c712200cfa', weight: 8 },
          { id: 'https://192.168.5.39/tasks/bd8c838b055c45dc984b0f28bef6684b', title: 'PalClaw 7x24 AI专属顾问', url: 'https://192.168.5.39/tasks/bd8c838b055c45dc984b0f28bef6684b', weight: 7 },
        ],
      },
    ])
  })

  it('UUID、长 hex、纯数字混在一起算同一组', () => {
    const tree = visitFolderTree([
      palclaw('/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', 9),
      palclaw('/tasks/c69350df521240909ec967c712200cfa', 8),
      palclaw('/tasks/100234567', 7),
    ], '192.168.5.39')

    expect(tree.map((node) => [node.id, node.title, node.directCount]))
      .toEqual([['tasks/*', 'tasks', 3]])
  })

  it('只有两个 ID 段时不合并——那还看得过来', () => {
    const tree = visitFolderTree([
      palclaw('/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', 9),
      palclaw('/tasks/c69350df521240909ec967c712200cfa', 8),
    ], '192.168.5.39')

    expect(tree[0]?.children.map((node) => node.title)).toEqual([
      '019fb349-e6f2-7407-a254-1919171a8d4a',
      'c69350df521240909ec967c712200cfa',
    ])
  })

  it('读得懂的路径段不被卷进合并行，哪怕标题一模一样', () => {
    const tree = visitFolderTree([
      palclaw('/disease-ops/catalog', 118),
      palclaw('/disease-ops/cerebrovascular', 26),
      palclaw('/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', 9),
      palclaw('/tasks/c69350df521240909ec967c712200cfa', 8),
      palclaw('/tasks/bd8c838b055c45dc984b0f28bef6684b', 7),
      palclaw('/tasks/new', 5),
    ], '192.168.5.39')

    const diseaseOps = tree.find((node) => node.title === 'disease-ops')
    expect(diseaseOps?.children.map((node) => [node.title, node.count])).toEqual([
      ['catalog', 118],
      ['cerebrovascular', 26],
    ])

    // tasks 底下还有 new，合并行没被并进父段，自己一行、没有段名
    const tasks = tree.find((node) => node.title === 'tasks')
    expect(tasks?.children.map((node) => [node.title, node.pageTitle, node.count, node.grouped]))
      .toEqual([
        ['', 'PalClaw 7x24 AI专属顾问', 24, true],
        ['new', undefined, 5, undefined],
      ])
  })

  it('标题各不相同时合并行连页面标题也报不出，交给界面拿占位符顶上', () => {
    const tree = visitFolderTree([
      palclaw('/tasks/019fb349-e6f2-7407-a254-1919171a8d4a', 9, '任务甲'),
      palclaw('/tasks/c69350df521240909ec967c712200cfa', 8, '任务乙'),
      palclaw('/tasks/bd8c838b055c45dc984b0f28bef6684b', 7, '任务丙'),
      palclaw('/tasks/new', 5, '新建'),
    ], '192.168.5.39')

    const tasks = tree.find((node) => node.title === 'tasks')
    expect(tasks?.children.map((node) => [node.title, node.pageTitle, node.grouped]))
      .toEqual([['', undefined, true], ['new', undefined, undefined]])
  })

  it('一位两位的纯数字段也是编号，够三个就并', () => {
    const tree = visitFolderTree([
      { url: 'http://localhost/analysis/library/3', title: '墨析', weight: 193 },
      { url: 'http://localhost/analysis/library/6', title: '墨析', weight: 167 },
      { url: 'http://localhost/analysis/library/2', title: '墨析', weight: 141 },
    ], 'localhost')

    expect(tree.map((node) => [node.id, node.title, node.count, node.directCount])).toEqual([
      ['analysis/library/*', 'analysis / library', 501, 3],
    ])
  })

  it('底下还有分支的 ID 段照并，子树按段名合起来、次数求和', () => {
    const tree = visitFolderTree([
      { url: 'http://localhost/library/5', title: '墨析', weight: 300 },
      { url: 'http://localhost/library/5/read', title: '墨析', weight: 215 },
      { url: 'http://localhost/library/1', title: '墨析', weight: 154 },
      { url: 'http://localhost/library/1/read', title: '墨析', weight: 100 },
      { url: 'http://localhost/library/4', title: '墨析', weight: 10 },
      { url: 'http://localhost/library/4/read', title: '墨析', weight: 5 },
    ], 'localhost')

    expect(tree).toHaveLength(1)
    const group = tree[0]
    expect([group?.id, group?.title, group?.grouped, group?.count, group?.directCount]).toEqual([
      'library/*', 'library', true, 784, 3,
    ])
    // 三个 read 并成一个，三条地址原样留在里面——哪条属于哪本小说还看得出来
    expect(group?.children.map((node) => [node.title, node.count])).toEqual([['read', 320]])
    expect(group?.children[0]?.bookmarks.map((b) => b.url)).toEqual([
      'http://localhost/library/5/read',
      'http://localhost/library/1/read',
      'http://localhost/library/4/read',
    ])
  })

  it('编号段不被过道折叠拼进子段名里——拼完就不像编号，会躲过聚合', () => {
    const tree = visitFolderTree([
      { url: 'http://localhost/settings/019fb349-e6f2-7407-a254-1919171a8d4a/edit', title: '墨析', weight: 40 },
      { url: 'http://localhost/settings/c69350df521240909ec967c712200cfa/edit', title: '墨析', weight: 30 },
      { url: 'http://localhost/settings/bd8c838b055c45dc984b0f28bef6684b/edit', title: '墨析', weight: 20 },
    ], 'localhost')

    expect(tree).toHaveLength(1)
    const group = tree[0]
    expect([group?.id, group?.title, group?.grouped, group?.count])
      .toEqual(['settings/*', 'settings', true, 90])
    expect(group?.children.map((node) => [node.title, node.count])).toEqual([['edit', 90]])
  })

  it('父段自己没有页面、底下只剩一个合并行时并成一行，留父段的名字', () => {
    const tree = visitFolderTree([
      { url: 'http://localhost:5629/works/019fb349-e6f2-7407-a254-1919171a8d4a', title: '墨析', weight: 100 },
      { url: 'http://localhost:5629/works/c69350df521240909ec967c712200cfa', title: '墨析', weight: 56 },
      { url: 'http://localhost:5629/works/bd8c838b055c45dc984b0f28bef6684b', title: '墨析', weight: 30 },
    ], 'localhost:5629')

    // 从前是 works 186 一行、合并行 186 又一行，同一个数字印两遍
    expect(tree).toHaveLength(1)
    expect([tree[0]?.title, tree[0]?.grouped, tree[0]?.count, tree[0]?.directCount])
      .toEqual(['works', true, 186, 3])
  })

  it('再往上还是过道就接成「甲 / 乙」，不把上一层的名字也吃掉', () => {
    const tree = visitFolderTree([
      { url: 'http://localhost:5629/analysis/library/3', title: '墨析', weight: 193 },
      { url: 'http://localhost:5629/analysis/library/6', title: '墨析', weight: 167 },
      { url: 'http://localhost:5629/analysis/library/2', title: '墨析', weight: 141 },
    ], 'localhost:5629')

    expect(tree.map((node) => [node.title, node.grouped, node.count])).toEqual([
      ['analysis / library', true, 501],
    ])
  })

  it('父段自己有页面时两行照旧——它们本来就是两个东西', () => {
    const tree = visitFolderTree([
      { url: 'http://localhost:5629/library', title: '墨析', weight: 502 },
      { url: 'http://localhost:5629/library/3', title: '墨析', weight: 193 },
      { url: 'http://localhost:5629/library/6', title: '墨析', weight: 167 },
      { url: 'http://localhost:5629/library/2', title: '墨析', weight: 141 },
    ], 'localhost:5629')

    expect(tree.map((node) => [node.title, node.count])).toEqual([['library', 1003]])
    expect(tree[0]?.children.map((node) => [node.grouped, node.count])).toEqual([[true, 501]])
  })

  it('顶层的 ID 段一样并成一行', () => {
    const tree = visitFolderTree([
      palclaw('/019fb349-e6f2-7407-a254-1919171a8d4a', 9),
      palclaw('/c69350df521240909ec967c712200cfa', 8),
      palclaw('/bd8c838b055c45dc984b0f28bef6684b', 7),
      palclaw('/documents', 190),
    ], '192.168.5.39')

    expect(tree.map((node) => [node.id, node.count])).toEqual([
      ['documents', 190],
      ['/*', 24],
    ])
  })
})

describe('看板按来源聚合，端口算身份', () => {
  it('rankDomains 把一台机器上的两个端口排成两行', () => {
    expect(rankDomains([
      { url: 'http://localhost:5173/settings' },
      { url: 'http://localhost:5173/settings/tasks' },
      { url: 'http://localhost:8501/settings/license' },
    ])).toEqual([
      { domain: 'localhost:5173', count: 2, sampleUrl: 'http://localhost:5173/settings' },
      { domain: 'localhost:8501', count: 1, sampleUrl: 'http://localhost:8501/settings/license' },
    ])
  })

  it('普通网站没变——默认端口不成为另一个来源', () => {
    expect(rankDomains([
      { url: 'https://github.com/a' },
      { url: 'https://github.com:443/b' },
      { url: 'https://www.github.com/c' },
    ])).toEqual([
      { domain: 'github.com', count: 3, sampleUrl: 'https://github.com/a' },
    ])
  })

  it('visitFolderTree 只收本端口的页面，两套路由不再叠在一起', () => {
    const tree = visitFolderTree([
      { url: 'http://localhost:5173/settings', title: '墨析', weight: 151 },
      { url: 'http://localhost:5173/settings/tasks', title: '墨析', weight: 210 },
      { url: 'http://localhost:8501/settings/license', title: '授权管理', weight: 4 },
    ], 'localhost:5173')

    expect(tree.map((node) => [node.title, node.count])).toEqual([['settings', 361]])
    expect(tree[0]?.children.map((node) => node.title)).toEqual(['tasks'])
  })

  it('visitSplitTree 也按端口分：另一个端口的书签不算这边收藏了', () => {
    const bookmarks: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'bar', title: '书签栏', children: [
          { id: 'a', title: '墨析设置', url: 'http://localhost:5173/settings' },
        ]},
      ]},
    ]
    const split = visitSplitTree([
      { url: 'http://localhost:8501/settings', title: '授权管理', weight: 4 },
    ], bookmarks, 'localhost:8501')

    expect(split.saved).toEqual([])
    expect(split.unsaved.map((node) => [node.title, node.count])).toEqual([['settings', 4]])
  })

  it('domainFolderTree 按端口挑书签', () => {
    const bookmarks: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'bar', title: '书签栏', children: [
          { id: 'a', title: '墨析', url: 'http://localhost:5173/settings' },
          { id: 'b', title: '授权', url: 'http://localhost:8501/settings' },
        ]},
      ]},
    ]

    expect(domainFolderTree(bookmarks, 'localhost:8501').map((node) => [node.title, node.count]))
      .toEqual([['书签栏', 1]])
    expect(domainFolderTree(bookmarks, 'localhost:8501')[0]?.bookmarks.map((b) => b.id))
      .toEqual(['b'])
  })
})

describe('siteName', () => {
  it('同源页面标题全一样时，整条就是站点名', () => {
    expect(siteName([
      '墨析 · 小说拆解工作台',
      '墨析 · 小说拆解工作台',
      '墨析 · 小说拆解工作台',
    ])).toBe('墨析 · 小说拆解工作台')
  })

  it('标题各不相同时取分隔符后的公共尾段', () => {
    expect(siteName([
      '授权管理 – TradingAgents-CN',
      '配置管理 – TradingAgents-CN',
      '数据导入管理 – TradingAgents-CN',
    ])).toBe('TradingAgents-CN')
  })

  it('公共尾巴不落在分隔符上就不算站点名——「管理」不是谁的名字', () => {
    expect(siteName(['授权管理', '配置管理', '数据导入管理'])).toBeUndefined()
  })

  it('没有公共部分就没有名字', () => {
    expect(siteName(['GitHub', 'Stack Overflow'])).toBeUndefined()
  })

  it('空标题不参与——剩下不足两个就报不出名字', () => {
    expect(siteName(['', '  ', ''])).toBeUndefined()
    expect(siteName(['', '墨析 · 小说拆解工作台'])).toBeUndefined()
    expect(siteName(['', '墨析 · 小说拆解工作台', '墨析 · 小说拆解工作台']))
      .toBe('墨析 · 小说拆解工作台')
  })

  it('只有一个页面时不报名字——那是页面标题，不是站点名', () => {
    expect(siteName(['研究报告 – TradingAgents-CN'])).toBeUndefined()
  })
})

describe('rankDomains 的站点名', () => {
  it('排行榜每一行带上站点名，取不到就不给', () => {
    expect(rankDomains([
      { url: 'http://localhost:5629/home', title: '墨析 · 小说拆解工作台' },
      { url: 'http://localhost:5629/settings', title: '墨析 · 小说拆解工作台' },
      { url: 'https://github.com/a', title: 'sst/opencode' },
      { url: 'https://github.com/b', title: 'openai/codex' },
    ])).toEqual([
      // 并列时按域名字典序，github.com 在前
      { domain: 'github.com', count: 2, sampleUrl: 'https://github.com/a' },
      {
        domain: 'localhost:5629',
        siteName: '墨析 · 小说拆解工作台',
        count: 2,
        sampleUrl: 'http://localhost:5629/home',
      },
    ])
  })
})

describe('bookmarkUrls 带上标题', () => {
  it('书签栏那一侧也能报站点名', () => {
    const tree: BookmarkNode[] = [
      { id: '0', title: '', children: [
        { id: 'bar', title: '书签栏', children: [
          { id: 'a', title: '授权管理 – TradingAgents-CN', url: 'http://localhost:8501/settings/license' },
          { id: 'b', title: '配置管理 – TradingAgents-CN', url: 'http://localhost:8501/settings/config' },
        ]},
      ]},
    ]

    expect(bookmarkUrls(tree)).toEqual([
      { url: 'http://localhost:8501/settings/license', title: '授权管理 – TradingAgents-CN' },
      { url: 'http://localhost:8501/settings/config', title: '配置管理 – TradingAgents-CN' },
    ])
    expect(rankDomains(bookmarkUrls(tree))[0]?.siteName).toBe('TradingAgents-CN')
  })
})
