import { describe, it, expect } from 'vitest'
import { BROAD_WORDS, classifyPrompt, foldersPrompt, groupTagsPrompt, tagsPrompt } from '@/llm/prompts'
import { LOCALES } from '@/core/locale'

describe('提示词双语', () => {
  it('每种语言的每套提示词都非空', () => {
    for (const locale of LOCALES) {
      expect(classifyPrompt(locale).join('').trim()).not.toBe('')
      expect(tagsPrompt(locale).join('').trim()).not.toBe('')
      expect(groupTagsPrompt(locale, 'GitHub').join('').trim()).not.toBe('')
      expect(foldersPrompt(locale, { total: 10, maxSiblings: 8 }).join('').trim()).not.toBe('')
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
})
