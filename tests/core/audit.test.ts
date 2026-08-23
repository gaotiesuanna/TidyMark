import { describe, it, expect } from 'vitest'
import { collapseSameNameFolders, findOversizedFolders } from '@/core/audit'
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
      { id: 'tmp:1', title: '软件工程', count: MAX_LEAF + 1, level: 1 },
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

  it('兜底目录「其他」豁免——它是收容所，切它没有意义', () => {
    const result = findOversizedFolders({
      ...base,
      candidates: [cand('tmp:1', ['09 其他'])],
      newFolders: [top('tmp:1', '09 其他')],
      classifications: into('tmp:1', 63),
    })
    expect(result).toEqual([])
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
    expect(result).toEqual([{ id: 'real-1', title: '我的收藏', count: 63, level: 1 }])
  })

  it('英文兜底目录名 Other 同样豁免', () => {
    const result = findOversizedFolders({
      candidates: [cand('tmp:1', ['09 Other'])],
      newFolders: [top('tmp:1', '09 Other')],
      classifications: into('tmp:1', 63),
      locale: 'en',
    })
    expect(result).toEqual([])
  })
})
