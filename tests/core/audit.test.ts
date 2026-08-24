import { describe, it, expect } from 'vitest'
import {
  collapseSameNameFolders, dropFallbackFromCandidates, findOversizedFolders, measureFallbackShare,
} from '@/core/audit'
import type { CollapseInput } from '@/core/audit'
import type { NewFolderSpec } from '@/core/plan'
import { MAX_LEAF } from '@/core/shape'
import type { CategoryCandidate, Classification } from '@/core/types'

const rootId = 'root'
/** 范围根自己就叫「01 GitHub」——用户截图里的那一格。 */
const existingFolders = [{ id: rootId, title: '01 GitHub' }]

function cand(id: string, path: string[]): CategoryCandidate {
  return { id, path }
}
function top(temporaryId: string, title: string): NewFolderSpec {
  return { temporaryId, parentId: rootId, parentTemporaryId: null, title }
}
function child(temporaryId: string, parentTemporaryId: string, title: string): NewFolderSpec {
  return { temporaryId, parentId: null, parentTemporaryId, title }
}
function into(targetCategoryId: string | null, n: number): Classification[] {
  return Array.from({ length: n }, (_, i) => ({
    bookmarkId: `${targetCategoryId}#${i}`,
    targetCategoryId,
    confidence: 0.9,
    reason: '模型判断',
    source: 'llm' as const,
  }))
}
function collapse(input: Partial<CollapseInput> & Pick<CollapseInput, 'candidates' | 'newFolders'>) {
  return collapseSameNameFolders({
    classifications: [],
    existingFolders,
    mergeRootTemporaryId: null,
    ...input,
  })
}

describe('collapseSameNameFolders', () => {
  it('范围根叫 GitHub 时，组目录「01 GitHub」被塌掉，子目录上提并重编号', () => {
    const result = collapse({
      candidates: [
        cand('tmp:1', ['01 GitHub']),
        cand('tmp:2', ['01 GitHub', '01 软件工程']),
        cand('tmp:3', ['01 GitHub', '02 大模型']),
      ],
      newFolders: [top('tmp:1', '01 GitHub'), child('tmp:2', 'tmp:1', '01 软件工程'), child('tmp:3', 'tmp:1', '02 大模型')],
      classifications: [...into('tmp:1', 2), ...into('tmp:2', 5)],
    })

    expect(result.collapsedTitles).toEqual(['01 GitHub'])
    expect(result.newFolders.map((f) => f.title)).toEqual(['01 软件工程', '02 大模型'])
    // 子目录改挂范围根这个真实目录
    expect(result.newFolders.every((f) => f.parentId === rootId && f.parentTemporaryId === null)).toBe(true)
    // path 摘掉被塌掉的那一节
    expect(result.candidates.map((c) => c.path)).toEqual([['01 软件工程'], ['02 大模型']])
    // 原本挂在组根上的书签改指范围根
    expect(result.classifications.filter((c) => c.targetCategoryId === rootId)).toHaveLength(2)
    expect(result.classifications.filter((c) => c.targetCategoryId === 'tmp:2')).toHaveLength(5)
  })

  it('编号不同但基名相同照样算同名', () => {
    const result = collapse({
      candidates: [cand('tmp:1', ['07 GitHub'])],
      newFolders: [top('tmp:1', '07 GitHub')],
    })
    expect(result.collapsedTitles).toEqual(['07 GitHub'])
  })

  it('父子不同名时原样返回', () => {
    const result = collapse({
      candidates: [cand('tmp:1', ['01 前端'])],
      newFolders: [top('tmp:1', '01 前端')],
    })
    expect(result.collapsedTitles).toEqual([])
    expect(result.newFolders.map((f) => f.title)).toEqual(['01 前端'])
  })

  it('用户已有的同名目录不动——它不在 newFolders 里', () => {
    const result = collapseSameNameFolders({
      candidates: [cand('real-1', ['01 GitHub'])],
      newFolders: [],
      classifications: [],
      existingFolders: [...existingFolders, { id: 'real-1', title: '01 GitHub' }],
      mergeRootTemporaryId: null,
    })
    expect(result.collapsedTitles).toEqual([])
    expect(result.candidates).toHaveLength(1)
  })

  it('合并模式的容器目录不动', () => {
    const result = collapse({
      candidates: [cand('tmp:1', ['01 GitHub'])],
      newFolders: [top('tmp:1', '01 GitHub')],
      mergeRootTemporaryId: 'tmp:1',
    })
    expect(result.collapsedTitles).toEqual([])
  })

  it('连续两层同名迭代到不动点', () => {
    const result = collapse({
      candidates: [
        cand('tmp:1', ['01 GitHub']),
        cand('tmp:2', ['01 GitHub', '01 GitHub']),
        cand('tmp:3', ['01 GitHub', '01 GitHub', '01 软件工程']),
      ],
      newFolders: [
        top('tmp:1', '01 GitHub'),
        child('tmp:2', 'tmp:1', '01 GitHub'),
        child('tmp:3', 'tmp:2', '01 软件工程'),
      ],
    })
    expect(result.collapsedTitles).toEqual(['01 GitHub', '01 GitHub'])
    expect(result.newFolders.map((f) => f.title)).toEqual(['01 软件工程'])
    expect(result.candidates.map((c) => c.path)).toEqual([['01 软件工程']])
  })

})

describe('measureFallbackShare', () => {
  const base = { locale: 'zh_CN' as const }

  it('量的是「其他」整个子树，不是它直接装的那几条', () => {
    // 切开之后直属只剩 4 条，但子树仍是 4+8+8=20 条——份额不该因为切开就凭空变小
    const result = measureFallbackShare({
      ...base,
      candidates: [
        cand('tmp:9', ['05 其他']),
        cand('tmp:10', ['05 其他', '01 甲']),
        cand('tmp:11', ['05 其他', '02 乙']),
      ],
      classifications: [...into('tmp:9', 4), ...into('tmp:10', 8), ...into('tmp:11', 8)],
      total: 100,
    })
    expect(result).toEqual({ count: 20, total: 100, share: 0.2 })
  })

  it('没有一级的「其他」时返回 null', () => {
    const result = measureFallbackShare({
      ...base,
      candidates: [cand('tmp:1', ['01 甲'])],
      classifications: into('tmp:1', 10),
      total: 100,
    })
    expect(result).toBeNull()
  })

  it('英文库认 Other', () => {
    const result = measureFallbackShare({
      locale: 'en',
      candidates: [cand('tmp:9', ['05 Other'])],
      classifications: into('tmp:9', 15),
      total: 100,
    })
    expect(result?.count).toBe(15)
  })

  // 二级的「其他」不是 A5 要量的东西：A5 问的是「顶层设计有没有覆盖住这个库」
  it('二级的「其他」不算——A5 量的是顶层的覆盖', () => {
    const result = measureFallbackShare({
      ...base,
      candidates: [cand('tmp:1', ['01 甲']), cand('tmp:2', ['01 甲', '09 其他'])],
      classifications: [...into('tmp:1', 5), ...into('tmp:2', 15)],
      total: 100,
    })
    expect(result).toBeNull()
  })
})

describe('findOversizedFolders', () => {
  const base = { locale: 'zh_CN' as const }

  // 阈值就是 MAX_LEAF，不写死数字——issues/38 的 D2 把它从 20 收到了 12，
  // 写死的话下次再调这个判准，测试会先于实现「通过」，把改动放过去。
  it('装超过 MAX_LEAF 条的新建目录进清单，正好装满的不进', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:1', ['01 软件工程']), cand('tmp:2', ['02 大模型'])],
      newFolders: [top('tmp:1', '01 软件工程'), top('tmp:2', '02 大模型')],
      classifications: [...into('tmp:1', MAX_LEAF + 1), ...into('tmp:2', MAX_LEAF)],
    })
    expect(result).toEqual([
      { id: 'tmp:1', title: '软件工程', count: MAX_LEAF + 1, level: 1, kind: 'capacity' },
    ])
  })

  // D2 的行为变化本身也要有人盯着：装 20 条的目录，改判之前安然无恙、改判之后要切。
  // 真实数据里 `02 语音合成`、`03 界面与显示` 各 13 条，正是被这一格捞起来的那批。
  it('装 13 条的目录现在算超标——判准 A1 由 8–20 改判 8–12', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:1', ['01 语音合成'])],
      newFolders: [top('tmp:1', '01 语音合成')],
      classifications: into('tmp:1', 13),
    })
    expect(result.map((f) => f.title)).toEqual(['语音合成'])
  })

  it('清单按占用从大到小排，同一轮里先切最撑的那个', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:1', ['01 甲']), cand('tmp:2', ['02 乙'])],
      newFolders: [top('tmp:1', '01 甲'), top('tmp:2', '02 乙')],
      classifications: [...into('tmp:1', 25), ...into('tmp:2', 40)],
    })
    expect(result.map((f) => f.id)).toEqual(['tmp:2', 'tmp:1'])
  })

  it('已经在第 3 层的目录不再进清单——3 层封顶', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:3', ['01 甲', '01 乙', '01 丙'])],
      newFolders: [child('tmp:3', 'tmp:2', '01 丙')],
      classifications: into('tmp:3', 63),
    })
    expect(result).toEqual([])
  })

  it('第 2 层的目录仍可下切', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:2', ['01 甲', '01 乙'])],
      newFolders: [child('tmp:2', 'tmp:1', '01 乙')],
      classifications: into('tmp:2', 63),
    })
    expect(result.map((f) => f.level)).toEqual([2])
  })

  // 曾经这里豁免「其他」，理由是「收容所没有主题可言，切了只是把杂物摊成几堆杂物」。
  // 真实一遍的证据推翻了那个前提：69 条里 74% 归得进 9 个成建制的族，最大一族 12 条
  // 本身就够格单独成目录（organize-audit-holes 01 票 → 02 票定案）。
  it('兜底目录「其他」不再豁免，跟普通目录一样按占用下切', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:1', ['09 其他'])],
      newFolders: [top('tmp:1', '09 其他')],
      classifications: into('tmp:1', 63),
    })
    expect(result.map((f) => f.id)).toEqual(['tmp:1'])
  })

  // 豁免摘得干净：不留「一级豁免、二级不豁免」这种按层级分档的残留（02 票判准 B）
  it('二级的「其他」同样按占用下切', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:2', ['01 甲', '09 其他'])],
      newFolders: [child('tmp:2', 'tmp:1', '09 其他')],
      classifications: into('tmp:2', 63),
    })
    expect(result.map((f) => f.id)).toEqual(['tmp:2'])
  })

  it('scope 默认只看新建目录，用户已有的目录不进清单', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('real-1', ['我的收藏'])],
      newFolders: [],
      classifications: into('real-1', 63),
    })
    expect(result).toEqual([])
  })

  it("scope 为 'all' 时用户已有目录也算——additive 模式出警告用", () => {
    const result = findOversizedFolders({
      ...base,
      scope: 'all',
      candidates: [cand('real-1', ['我的收藏'])],
      newFolders: [],
      classifications: into('real-1', 63),
    })
    expect(result).toEqual([{ id: 'real-1', title: '我的收藏', count: 63, level: 1, kind: 'capacity' }])
  })

  // 下切之后父目录还留着一摊比任何子目录都大的散书签时，这一层仍然「下不去手」（判准 B3）。
  // 只看「留守有没有超过 MAX_LEAF」会放过它：04 Web工程 切完剩 15 条、子目录各 3 条，
  // 15 ≤ 20 曾被判成合格（organize-audit-holes 04 票判准 A）。
  it('留守比最大的子目录还多时仍进清单，哪怕没超过 MAX_LEAF', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [
        cand('tmp:1', ['01 甲']),
        cand('tmp:2', ['01 甲', '01 乙']),
        cand('tmp:3', ['01 甲', '02 丙']),
      ],
      newFolders: [top('tmp:1', '01 甲'), child('tmp:2', 'tmp:1', '01 乙'), child('tmp:3', 'tmp:1', '02 丙')],
      classifications: [...into('tmp:1', 7), ...into('tmp:2', 3), ...into('tmp:3', 3)],
    })
    expect(result.map((f) => f.id)).toEqual(['tmp:1'])
    // 触发原因要分得清：7 条并没有超过 MAX_LEAF，拿「超过上限」的文案去报它是说谎
    expect(result[0]!.kind).toBe('leftovers')
  })

  it('超过 MAX_LEAF 触发的标成 capacity，与留守触发区分开', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:1', ['01 甲'])],
      newFolders: [top('tmp:1', '01 甲')],
      classifications: into('tmp:1', MAX_LEAF + 1),
    })
    expect(result.map((f) => f.kind)).toEqual(['capacity'])
  })

  it('留守不多于最大的子目录时不进清单', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [
        cand('tmp:1', ['01 甲']),
        cand('tmp:2', ['01 甲', '01 乙']),
      ],
      newFolders: [top('tmp:1', '01 甲'), child('tmp:2', 'tmp:1', '01 乙')],
      classifications: [...into('tmp:1', 6), ...into('tmp:2', 8)],
    })
    expect(result).toEqual([])
  })

  // 下限 = 2 × MIN_FOLDER_BOOKMARKS：再问一次模型至少要能切出两个站得住的子目录，
  // 5 条切不出两个 ≥3 的桶，触发它只是白花一次调用
  it('留守太少切不动时不进清单，不为它白花一次调用', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [
        cand('tmp:1', ['01 甲']),
        cand('tmp:2', ['01 甲', '01 乙']),
      ],
      newFolders: [top('tmp:1', '01 甲'), child('tmp:2', 'tmp:1', '01 乙')],
      classifications: [...into('tmp:1', 5), ...into('tmp:2', 3)],
    })
    expect(result).toEqual([])
  })

  it('英文兜底目录名 Other 同样不再豁免', () => {
    const result = findOversizedFolders({
      candidates: [cand('tmp:1', ['09 Other'])],
      newFolders: [top('tmp:1', '09 Other')],
      classifications: into('tmp:1', 63),
      locale: 'en',
    })
    expect(result).toEqual([{ id: 'tmp:1', title: 'Other', count: 63, level: 1, kind: 'capacity' }])
  })
})

describe('dropFallbackFromCandidates', () => {
  const folders = [
    { id: '1', parentId: '0', title: '书签栏' },
    { id: '10', parentId: '1', title: '前端' },
    { id: '11', parentId: '1', title: '02 其他' },
    { id: '12', parentId: '10', title: '其他' },
  ]
  const candidates = [
    cand('10', ['书签栏', '前端']),
    cand('11', ['书签栏', '02 其他']),
    cand('12', ['书签栏', '前端', '其他']),
  ]

  // 上一轮推翻重建留下的「其他」带着建树期给的编号。编号是 TidyMark 自己加的，
  // 认名字时不剥它，这条修复在真实的第二轮上就一次都触发不了
  it('剥掉编号再认名字：「02 其他」也是那个收容所', () => {
    const kept = dropFallbackFromCandidates(candidates, folders, ['1'], 'zh_CN')
    expect(kept.map((c) => c.id)).toEqual(['10', '12'])
  })

  it('英文库认的是 Other', () => {
    const enFolders = [
      { id: '10', parentId: '1', title: 'Frontend' },
      { id: '11', parentId: '1', title: '02 Other' },
    ]
    const enCandidates = [cand('10', ['Bar', 'Frontend']), cand('11', ['Bar', '02 Other'])]
    expect(dropFallbackFromCandidates(enCandidates, enFolders, ['1'], 'en').map((c) => c.id))
      .toEqual(['10'])
    // 中文语境下 Other 不是收容所的名字，不该被误剔
    expect(dropFallbackFromCandidates(enCandidates, enFolders, ['1'], 'zh_CN').map((c) => c.id))
      .toEqual(['10', '11'])
  })

  it('剔光了就原样返回——一个候选都没有的提示词只会换回一堆 null', () => {
    const only = [cand('11', ['书签栏', '02 其他'])]
    expect(dropFallbackFromCandidates(only, folders, ['1'], 'zh_CN')).toEqual(only)
  })

  // A5 只认一级的「其他」，这里跟着同一条线：某个主题目录下面自己带一个「其他」
  // 是那个主题内部的事，不是收容所
  it('只认范围根的直接子目录，更深一层的「其他」照旧当候选', () => {
    const nested = [cand('10', ['书签栏', '前端']), cand('12', ['书签栏', '前端', '其他'])]
    const noTopFallback = folders.filter((f) => f.id !== '11')
    expect(dropFallbackFromCandidates(nested, noTopFallback, ['1'], 'zh_CN').map((c) => c.id))
      .toEqual(['10', '12'])
  })
})
