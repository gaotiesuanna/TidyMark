import { describe, it, expect } from 'vitest'
import { detectMode } from '@/core/mode'
import type { BookmarkItem, FolderItem, ScanResult } from '@/core/types'

/** 只有 detectMode 真正读的字段有意义（id/title/parentId/depth），其余填成不影响判断的值。 */
function folder(id: string, title: string, parentId: string | null, depth: number): FolderItem {
  return { id, title, parentId, index: 0, path: [], depth, level: depth }
}

function bookmark(id: string, parentId: string): BookmarkItem {
  return { id, title: id, url: `https://example.com/${id}`, parentId, index: 0, currentPath: [] }
}

/** stats 一律照实填但不被读：detectMode 自己从 folders/bookmarks 数，见 core/mode.ts 的说明。 */
function scanOf(folders: FolderItem[], bookmarks: BookmarkItem[]): ScanResult {
  return {
    folders,
    bookmarks,
    stats: {
      totalBookmarks: bookmarks.length, totalFolders: folders.length, emptyFolders: 0,
      untitledBookmarks: 0, duplicateUrlGroups: 0, maxDepth: 0,
    },
  }
}

/** 范围根：勾中的那个目录，depth 为 0。 */
const ROOT = folder('1', '书签栏', null, 0)

/** 挂在范围根下、装了 count 条书签的一级目录。 */
function filled(id: string, title: string, count: number): [FolderItem, BookmarkItem[]] {
  return [
    folder(id, title, '1', 1),
    Array.from({ length: count }, (_, i) => bookmark(`${id}-${i}`, id)),
  ]
}

function build(parts: Array<[FolderItem, BookmarkItem[]]>, loose: BookmarkItem[] = []): ScanResult {
  return scanOf([ROOT, ...parts.map(([f]) => f)], [...parts.flatMap(([, b]) => b), ...loose])
}

describe('detectMode', () => {
  it('带编号前缀的目录过半——判已整理，理由点出数字（真实那一遍：16 个目录 15 个带编号）', () => {
    const numbered = Array.from({ length: 15 }, (_, i) =>
      filled(`f${i}`, `${String(i + 1).padStart(2, '0')} 主题${i}`, 8))
    const decision = detectMode(build([...numbered, filled('f15', '手工目录', 8)]), 'zh_CN')

    expect(decision.mode).toBe('additive')
    expect(decision.reason).toContain('15')
    expect(decision.reason).toContain('16')
  })

  it('编号占比刚好到一半就够，且它压过所有乱信号——那套结构正是这次要往里补的', () => {
    // 两个目录各只装 1 条（独苗比例 100%），根下还散着 10 条（散落比例 83%）：
    // 两条乱信号都成立，但编号占比 1/2 已经到线，直接定性
    const scan = build(
      [filled('f0', '01 前端', 1), filled('f1', '杂项', 1)],
      Array.from({ length: 10 }, (_, i) => bookmark(`loose${i}`, '1')),
    )
    expect(detectMode(scan, 'zh_CN').mode).toBe('additive')
  })

  it('编号不到一半就不算数，乱信号照旧生效', () => {
    const parts = [
      filled('f0', '01 前端', 1), filled('f1', '02 后端', 1),
      filled('f2', '杂项', 1), filled('f3', '收件箱', 1), filled('f4', '待读', 1),
    ]
    expect(detectMode(build(parts), 'zh_CN').mode).toBe('rebuild')
  })

  it('范围内一个目录都没有——判一团乱麻', () => {
    const scan = scanOf([ROOT], Array.from({ length: 5 }, (_, i) => bookmark(`b${i}`, '1')))
    expect(detectMode(scan, 'zh_CN').mode).toBe('rebuild')
  })

  it('范围根自己不算进目录数——它是勾选点，不是整理出来的目录', () => {
    // 判的两个目录里一个带编号，占比 1/2 到线 → 已整理。
    // 若把范围根也算进分母（1/3 不到线），就会落到独苗那条规则上翻成 rebuild
    const scan = build([filled('f0', '01 前端', 1), filled('f1', '杂项', 1)])
    expect(detectMode(scan, 'zh_CN').mode).toBe('additive')
  })

  it('根下直接散着的书签超过三成——判一团乱麻，理由带上比例', () => {
    // 4 个目录各 2 条 = 8 条，根下散着 4 条 → 4/12 = 33%
    const parts = Array.from({ length: 4 }, (_, i) => filled(`f${i}`, `目录${i}`, 2))
    const loose = Array.from({ length: 4 }, (_, i) => bookmark(`loose${i}`, '1'))
    const decision = detectMode(build(parts, loose), 'zh_CN')

    expect(decision.mode).toBe('rebuild')
    expect(decision.reason).toContain('33')
  })

  it('恰好三成不算超过——阈值是严格大于，边界上仍判已整理', () => {
    // 3/10 = 30%
    const scan = build(
      [filled('f0', '前端', 3), filled('f1', '后端', 4)],
      Array.from({ length: 3 }, (_, i) => bookmark(`loose${i}`, '1')),
    )
    expect(detectMode(scan, 'zh_CN').mode).toBe('additive')
  })

  it('多个范围根时合起来算一次，两边根下的散书签一起数', () => {
    const root2 = folder('2', '其他书签', null, 0)
    const [f0, inside] = filled('f0', '前端', 6)
    const loose = [
      ...Array.from({ length: 2 }, (_, i) => bookmark(`a${i}`, '1')),
      ...Array.from({ length: 2 }, (_, i) => bookmark(`b${i}`, '2')),
    ]
    // 只数第一个根的话是 2/10 = 20%，两个根一起数才是 4/10 = 40% 越线
    const scan = scanOf([ROOT, root2, f0], [...inside, ...loose])
    expect(detectMode(scan, 'zh_CN').mode).toBe('rebuild')
  })

  it('只装一条书签的目录超过四成——判一团乱麻', () => {
    const parts = [
      filled('f0', '独苗一', 1), filled('f1', '独苗二', 1), filled('f2', '独苗三', 1),
      filled('f3', '前端', 3), filled('f4', '后端', 3),
    ]
    const decision = detectMode(build(parts), 'zh_CN')

    expect(decision.mode).toBe('rebuild')
    expect(decision.reason).toContain('60')
  })

  it('恰好四成不算超过——同样是严格大于', () => {
    const parts = [
      filled('f0', '独苗一', 1), filled('f1', '独苗二', 1),
      filled('f2', '前端', 3), filled('f3', '后端', 3), filled('f4', '工具', 3),
    ]
    expect(detectMode(build(parts), 'zh_CN').mode).toBe('additive')
  })

  it('装着一条书签但还有子目录的不算独苗——那是导航目录，不是没分完的残留', () => {
    // 判的两个目录：A 带 1 条书签 + 一个子目录 B，B 装 3 条。
    // 把 A 算成独苗就是 1/2 = 50% 越线翻 rebuild，正确的算法是 0
    const a = folder('f0', '前端', '1', 1)
    const b = folder('f1', '框架', 'f0', 2)
    const scan = scanOf(
      [ROOT, a, b],
      [bookmark('x', 'f0'), ...Array.from({ length: 3 }, (_, i) => bookmark(`y${i}`, 'f1'))],
    )
    expect(detectMode(scan, 'zh_CN').mode).toBe('additive')
  })

  it('一条书签都没有时不除零，也不误判', () => {
    const scan = scanOf([ROOT, folder('f0', '前端', '1', 1), folder('f1', '后端', '1', 1)], [])
    const decision = detectMode(scan, 'zh_CN')

    expect(decision.mode).toBe('additive')
    expect(decision.reason).not.toBe('')
  })

  it('五条理由都双语——英文那份不含中文，中文那份不是英文原样', () => {
    const cjk = /[一-鿿]/
    const cases: ScanResult[] = [
      // 编号命中
      build([filled('f0', '01 前端', 3), filled('f1', '02 后端', 3)]),
      // 一个目录都没有
      scanOf([ROOT], [bookmark('b0', '1')]),
      // 根下散着（书签总数凑到 MIN_JUDGED_BOOKMARKS，不然被样本量护栏挡住走不到这条规则）
      build([filled('f0', '前端', 3)], Array.from({ length: 7 }, (_, i) => bookmark(`l${i}`, '1'))),
      // 独苗过多（目录数凑到 MIN_JUDGED_FOLDERS，理由同上）
      build([
        filled('f0', '独苗一', 1), filled('f1', '独苗二', 1),
        filled('f2', '独苗三', 1), filled('f3', '前端', 3),
      ]),
      // 保守兜底
      build([filled('f0', '前端', 5), filled('f1', '后端', 5)]),
    ]

    for (const scan of cases) {
      const zh = detectMode(scan, 'zh_CN').reason
      const en = detectMode(scan, 'en').reason
      expect(cjk.test(zh)).toBe(true)
      expect(cjk.test(en), `英文理由里混着中文：${en}`).toBe(false)
    }
  })

  it('样本量护栏：目录太少时，独苗比例再高也不足以判乱麻（I2）', () => {
    // 用户手建的「工作」目录下是「报销」（1 条）和「周报」（10 条）：1/2 = 50% > 40%，
    // 但只有 2 个目录，够不上 MIN_JUDGED_FOLDERS，落到保守兜底
    const scan = build([filled('f0', '报销', 1), filled('f1', '周报', 10)])
    expect(detectMode(scan, 'zh_CN').mode).toBe('additive')
  })

  it('样本量护栏：书签太少时，散落比例再高也不足以判乱麻（I2）', () => {
    // 1 个目录 2 条、根下散 3 条：3/5 = 60% > 30%，但书签总数 5 够不上
    // MIN_JUDGED_BOOKMARKS，落到保守兜底
    const scan = build(
      [filled('f0', '目录', 2)],
      Array.from({ length: 3 }, (_, i) => bookmark(`loose${i}`, '1')),
    )
    expect(detectMode(scan, 'zh_CN').mode).toBe('additive')
  })
})

describe('detectMode 对真实书签库形状的判断（回归 Recommendation 2）', () => {
  const shapes: Array<{ name: string; scan: () => ScanResult; expected: 'additive' | 'rebuild' }> = [
    {
      name: 'TidyMark 一层产物：一级目录全带编号，书签栏上另外堆着新书签 → additive',
      scan: () => build(
        Array.from({ length: 4 }, (_, i) =>
          filled(`f${i}`, `${String(i + 1).padStart(2, '0')} 主题${i}`, 4)),
        Array.from({ length: 8 }, (_, i) => bookmark(`loose${i}`, '1')),
      ),
      expected: 'additive',
    },
    {
      name: 'TidyMark 一层产物：一级全带编号，二级是用户自建的无编号目录，35% 散落 → additive（C1 回归）',
      scan: () => {
        // 分母若像修复前那样把二级也算进去：4 个一级 + 12 个无编号二级 = 16 个
        // 判断目录，编号比例只有 4/16 = 25%，够不上 0.5，会落到散落比例（约 37%）
        // 上翻成 rebuild——正是 C1 要堵的那个 bug。分母只取一级后是 4/4 = 100%，
        // 直接定性成 additive，二级目录、散落比例都不再有机会把它翻过去。
        const tops = Array.from({ length: 4 }, (_, i) =>
          folder(`f${i}`, `${String(i + 1).padStart(2, '0')} 主题${i}`, '1', 1))
        const subs = tops.flatMap((top) =>
          Array.from({ length: 3 }, (_, j) => folder(`${top.id}-s${j}`, `子目录${j}`, top.id, 2)))
        const subBookmarks = subs.map((s) => bookmark(`${s.id}-b`, s.id))
        const loose = Array.from({ length: 7 }, (_, i) => bookmark(`loose${i}`, '1'))
        return scanOf([ROOT, ...tops, ...subs], [...subBookmarks, ...loose])
      },
      expected: 'additive',
    },
    {
      name: '手工整理：没有编号，书签在几个目录间分布均匀 → additive',
      scan: () => build(Array.from({ length: 5 }, (_, i) => filled(`f${i}`, `目录${i}`, 4))),
      expected: 'additive',
    },
    {
      name: '全散：范围内一个目录都没有 → rebuild',
      scan: () => scanOf([ROOT], Array.from({ length: 6 }, (_, i) => bookmark(`b${i}`, '1'))),
      expected: 'rebuild',
    },
    {
      name: '目录很多，但大半是独苗 → rebuild',
      scan: () => build([
        filled('f0', '独苗一', 1), filled('f1', '独苗二', 1),
        filled('f2', '独苗三', 1), filled('f3', '独苗四', 1),
        filled('f4', '正常一', 3), filled('f5', '正常二', 3),
      ]),
      expected: 'rebuild',
    },
  ]

  it.each(shapes)('$name', ({ scan, expected }) => {
    expect(detectMode(scan(), 'zh_CN').mode).toBe(expected)
  })
})
