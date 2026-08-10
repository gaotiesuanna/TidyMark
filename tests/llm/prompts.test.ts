import { describe, it, expect } from 'vitest'
import { BROAD_WORDS, classifyPrompt, foldersPrompt, groupTagsPrompt, mergeNamePrompt, tagsPrompt } from '@/llm/prompts'
import { LOCALES } from '@/core/locale'

describe('提示词双语', () => {
  it('每种语言的每套提示词都非空', () => {
    for (const locale of LOCALES) {
      expect(classifyPrompt(locale).join('').trim()).not.toBe('')
      expect(tagsPrompt(locale).join('').trim()).not.toBe('')
      expect(groupTagsPrompt(locale, 'GitHub').join('').trim()).not.toBe('')
      expect(foldersPrompt(locale, { total: 10, maxSiblings: 8 }).join('').trim()).not.toBe('')
      expect(mergeNamePrompt(locale, ['NiceG', 'b_llm']).join('').trim()).not.toBe('')
    }
  })

  it('英文提示词明确要求用英文作答——漏了这条英文界面会生成中文目录', () => {
    expect(tagsPrompt('en').join(' ')).toMatch(/in English/i)
    expect(groupTagsPrompt('en', 'GitHub').join(' ')).toMatch(/in English/i)
    expect(foldersPrompt('en', { total: 10, maxSiblings: 8 }).join(' ')).toMatch(/in English/i)
    expect(classifyPrompt('en').join(' ')).toMatch(/in English/i)
  })

  it('中文提示词明确要求用中文作答', () => {
    expect(tagsPrompt('zh_CN').join(' ')).toContain('中文')
    expect(foldersPrompt('zh_CN', { total: 10, maxSiblings: 8 }).join(' ')).toContain('中文')
    expect(classifyPrompt('zh_CN').join(' ')).toContain('中文')
    expect(groupTagsPrompt('zh_CN', 'GitHub').join(' ')).toContain('中文')
  })

  it('宽泛词表两种语言各自独立，不是互译', () => {
    expect(BROAD_WORDS.zh_CN).toContain('人工智能')
    expect(BROAD_WORDS.en.toLowerCase()).toContain('misc')
    expect(BROAD_WORDS.en).not.toContain('人工智能')
  })

  it('聚合组提示词会带上组名，并叮嘱不要拿它当分类依据', () => {
    expect(groupTagsPrompt('zh_CN', 'GitHub').join(' ')).toContain('GitHub')
    expect(groupTagsPrompt('en', 'GitHub').join(' ')).toContain('GitHub')
  })

  it('目录设计提示词带上数量上限', () => {
    expect(foldersPrompt('zh_CN', { total: 10, maxSiblings: 8 }).join(' ')).toContain('8')
    expect(foldersPrompt('en', { total: 10, maxSiblings: 8 }).join(' ')).toContain('8')
  })

  it('有父目录时提示词会说明不要重复用父目录这个共同点', () => {
    const zh = foldersPrompt('zh_CN', { total: 5, parentTitle: 'GitHub', maxSiblings: 8 }).join(' ')
    const en = foldersPrompt('en', { total: 5, parentTitle: 'GitHub', maxSiblings: 8 }).join(' ')
    expect(zh).toContain('GitHub')
    expect(en).toContain('GitHub')
  })

  it('合并起名提示词会带上每个源目录名，两种语言都能定位到', () => {
    const zh = mergeNamePrompt('zh_CN', ['NiceG', 'b_llm']).join(' ')
    const en = mergeNamePrompt('en', ['NiceG', 'b_llm']).join(' ')
    expect(zh).toContain('NiceG')
    expect(zh).toContain('b_llm')
    expect(en).toContain('NiceG')
    expect(en).toContain('b_llm')
  })

  it('合并起名提示词的英文分支是英文，且带齐编号前缀/引号/JSON 回复形状这几条约束', () => {
    const en = mergeNamePrompt('en', ['NiceG', 'b_llm']).join(' ')
    expect(en).toContain('No numbering prefix')
    expect(en).toContain('No quotes')
    expect(en).toContain('Reply with JSON')
    // 英文分支混入中文字符，说明两个分支的文案被改串了
    expect(en).not.toMatch(/[一-鿿]/)
  })

  it('合并起名提示词的中文分支带齐对应的编号前缀/引号/JSON 回复形状这几条约束', () => {
    const zh = mergeNamePrompt('zh_CN', ['NiceG', 'b_llm']).join(' ')
    expect(zh).toContain('不要编号前缀')
    expect(zh).toContain('不要引号')
    expect(zh).toContain('JSON')
  })
})

describe('foldersPrompt 二级目录开关', () => {
  it('allowSubfolders=false 时要求只输出一层', () => {
    expect(foldersPrompt('zh_CN', { total: 10, maxSiblings: 8, allowSubfolders: false }).join(' '))
      .toContain('children 一律返回空数组')
    expect(foldersPrompt('en', { total: 10, maxSiblings: 8, allowSubfolders: false }).join(' '))
      .toMatch(/empty array for children/i)
  })

  it('默认（不传）仍留给模型自行决定要不要二级', () => {
    expect(foldersPrompt('zh_CN', { total: 10, maxSiblings: 8 }).join(' '))
      .toContain('只有当')
    expect(foldersPrompt('en', { total: 10, maxSiblings: 8 }).join(' '))
      .toMatch(/Only use children when/i)
  })

  // 顶层与聚合组内部是两套文案，别把开关接错分支
  it('聚合组内部（带 parentTitle）本来就是单层，不受开关影响', () => {
    const withParent = foldersPrompt('zh_CN', { total: 10, maxSiblings: 8, parentTitle: 'GitHub' })
    expect(withParent.join(' ')).toContain('children 一律返回空数组')
  })
})
