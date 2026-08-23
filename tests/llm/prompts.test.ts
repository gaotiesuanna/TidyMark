import { describe, it, expect } from 'vitest'
import {
  BROAD_WORDS,
  classifyPrompt,
  foldersPrompt,
  mergeNamePrompt,
  newFolderNamesPrompt,
  tagsPrompt,
} from '@/llm/prompts'
import { LOCALES } from '@/core/locale'

describe('提示词双语', () => {
  it('每种语言的每套提示词都非空', () => {
    for (const locale of LOCALES) {
      expect(classifyPrompt(locale).join('').trim()).not.toBe('')
      expect(tagsPrompt(locale).join('').trim()).not.toBe('')
      expect(foldersPrompt(locale, { total: 10, maxSiblings: 8 }).join('').trim()).not.toBe('')
      expect(mergeNamePrompt(locale, ['NiceG', 'b_llm']).join('').trim()).not.toBe('')
    }
  })

  it('英文提示词明确要求用英文作答——漏了这条英文界面会生成中文目录', () => {
    expect(tagsPrompt('en').join(' ')).toMatch(/in English/i)
    expect(foldersPrompt('en', { total: 10, maxSiblings: 8 }).join(' ')).toMatch(/in English/i)
    expect(classifyPrompt('en').join(' ')).toMatch(/in English/i)
  })

  it('中文提示词明确要求用中文作答', () => {
    expect(tagsPrompt('zh_CN').join(' ')).toContain('中文')
    expect(foldersPrompt('zh_CN', { total: 10, maxSiblings: 8 }).join(' ')).toContain('中文')
    expect(classifyPrompt('zh_CN').join(' ')).toContain('中文')
  })

  it('宽泛词表两种语言各自独立，不是互译', () => {
    expect(BROAD_WORDS.zh_CN).toContain('人工智能')
    expect(BROAD_WORDS.en.toLowerCase()).toContain('misc')
    expect(BROAD_WORDS.en).not.toContain('人工智能')
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

  it('合并起名提示词也要求一个名字一个概念（M7）', () => {
    const zh = mergeNamePrompt('zh_CN', ['NiceG', 'b_llm']).join(' ')
    const en = mergeNamePrompt('en', ['NiceG', 'b_llm']).join(' ')
    expect(zh).toContain('一个名字只装一个概念')
    expect(en).toMatch(/one concept per name/i)
  })
})

describe('foldersPrompt 再分一层的开关', () => {
  it('allowChildren=false 时要求只输出一层', () => {
    expect(foldersPrompt('zh_CN', { total: 10, maxSiblings: 8, allowChildren: false }).join(' '))
      .toContain('children 一律返回空数组')
    expect(foldersPrompt('en', { total: 10, maxSiblings: 8, allowChildren: false }).join(' '))
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

/**
 * 标签清单里带着每个标签的书签数，模型有依据判断某个目录会不会太小。
 * 这是「不要出现只装一个链接的目录」在源头的第一道拦截，另两道在
 * core/tree.ts（按标签数过滤）和 core/prune.ts（分类后按真实归属兜底）。
 */
describe('foldersPrompt 目录下限', () => {
  it('给出 minFolderSize 时要求模型不要建装不满的目录，并报出这个数字', () => {
    const zh = foldersPrompt('zh_CN', { total: 30, maxSiblings: 8, minFolderSize: 3 }).join(' ')
    expect(zh).toContain('3')
    expect(zh).toContain('不要建')

    const en = foldersPrompt('en', { total: 30, maxSiblings: 8, minFolderSize: 3 }).join(' ')
    expect(en).toContain('3')
    expect(en).toMatch(/at least 3 bookmarks/i)
  })

  // 关掉开关时这条规则整个不该出现，否则模型仍会照它设计
  it('不传 minFolderSize 时不提这回事', () => {
    expect(foldersPrompt('zh_CN', { total: 30, maxSiblings: 8 }).join(' ')).not.toContain('不要建')
    expect(foldersPrompt('en', { total: 30, maxSiblings: 8 }).join(' ')).not.toMatch(/at least \d+ bookmarks/i)
  })

  // 聚合组内部那一层同样会冒出独苗子目录，两个分支都要有
  it('聚合组内部（带 parentTitle）也带上这条', () => {
    const zh = foldersPrompt('zh_CN', { total: 30, parentTitle: 'GitHub', maxSiblings: 8, minFolderSize: 4 }).join(' ')
    expect(zh).toContain('4')
    expect(zh).toContain('不要建')

    const en = foldersPrompt('en', { total: 30, parentTitle: 'GitHub', maxSiblings: 8, minFolderSize: 4 }).join(' ')
    expect(en).toMatch(/at least 4 bookmarks/i)
  })

  // 规则是编号列表，插进去不能把后面几条的号码搞重或跳号
  it('规则编号仍然连续', () => {
    for (const locale of ['zh_CN', 'en'] as const) {
      const text = foldersPrompt(locale, { total: 30, maxSiblings: 8, minFolderSize: 3 }).join('\n')
      const numbers = [...text.matchAll(/^(\d+)\./gm)].map((m) => Number(m[1]))
      expect(numbers).toEqual(numbers.map((_, i) => i + 1))
    }
  })
})

describe('foldersPrompt 的复合名禁令', () => {
  it('一级目录那次带上「一个目录一个概念」，并给出反例', () => {
    const lines = foldersPrompt('zh_CN', { total: 30, maxSiblings: 8 }).join('\n')
    expect(lines).toContain('一个目录只装一个概念')
    expect(lines).toContain('与')
    expect(lines).toContain('记忆与向量存储')
  })

  it('聚合组那次（parentTitle 在场）同样带上', () => {
    const lines = foldersPrompt('zh_CN', { total: 30, maxSiblings: 8, parentTitle: 'GitHub' }).join('\n')
    expect(lines).toContain('一个目录只装一个概念')
  })

  it('英文那份不是直译，用 and / & / 斜杠说事', () => {
    const lines = foldersPrompt('en', { total: 30, maxSiblings: 8 }).join('\n')
    expect(lines).toContain('One concept per folder')
    expect(lines).toContain('"and"')
    expect(lines).toContain('&')
  })

  it('可选规则按实际出现顺序连排编号——没有 minFolderSize 时到第 8 条为止', () => {
    const lines = foldersPrompt('zh_CN', { total: 30, maxSiblings: 8 }).join('\n')
    expect(lines).toContain('7. 一个目录只装一个概念')
    expect(lines).not.toContain('9. ')
  })

  it('有 minFolderSize 时它排在最后，编号连排到 9', () => {
    const lines = foldersPrompt('zh_CN', { total: 30, maxSiblings: 8, minFolderSize: 3 }).join('\n')
    expect(lines).toContain('7. 一个目录只装一个概念')
    expect(lines).toContain('9. 不要建只装得下不到 3 个书签的目录')
  })

  it('中文规则把「及」「/」也列进连接词，不只是「与」「和」（I2）', () => {
    const lines = foldersPrompt('zh_CN', { total: 30, maxSiblings: 8 }).join('\n')
    expect(lines).toContain('及')
    expect(lines).toContain('/')
  })

  it('英文规则把逗号也列进连接词', () => {
    const lines = foldersPrompt('en', { total: 30, maxSiblings: 8 }).join('\n')
    expect(lines).toContain('comma')
  })
})

describe('classifyPrompt 的 topic 规则', () => {
  it('中文提示词说明 null 时要带回主题', () => {
    expect(classifyPrompt('zh_CN').join('\n')).toContain('topic')
  })
  it('英文提示词说明 null 时要带回主题', () => {
    expect(classifyPrompt('en').join('\n')).toContain('topic')
  })

  // 推翻模式传 includeTopicRule=false：候选目录是刚设计出来的，用不上这条规则，
  // 提示词也不该因为这个工作流而发生任何变化——推翻模式的分类稳定性正是要保护的东西。
  it('includeTopicRule 为 false 时不出现第 5 条规则，也不提 topic', () => {
    for (const locale of ['zh_CN', 'en'] as const) {
      const withRule = classifyPrompt(locale, true)
      const withoutRule = classifyPrompt(locale, false)
      expect(withoutRule.join('\n')).not.toContain('topic')
      expect(withoutRule).toHaveLength(withRule.length - 1)
      // 前 4 条规则逐字节不变——不是重新组织了句子，只是少了最后一条
      expect(withoutRule).toEqual(withRule.slice(0, -1))
    }
  })

  it('不传第二个参数时默认带上第 5 条——调用点省略参数不能悄悄改变行为', () => {
    for (const locale of ['zh_CN', 'en'] as const) {
      expect(classifyPrompt(locale)).toEqual(classifyPrompt(locale, true))
    }
  })
})

describe('classifyPrompt 的理由约束', () => {
  it('中文那份禁止在理由里提别的书签 id', () => {
    expect(classifyPrompt('zh_CN').join('\n')).toContain('不要提别的书签的 id')
  })

  it('英文那份同样', () => {
    expect(classifyPrompt('en').join('\n')).toContain('Do not mention other bookmarks')
  })
})

/**
 * 层级按绝对位置算：勾「其他书签」时模型建的是二级目录，不是一级。
 * 提示词里的称呼跟着走，否则模型会照着「一级目录要具体」的标准去命名一批二级目录。
 */
describe('foldersPrompt 绝对层级', () => {
  it('不传 startLevel 时仍说「一级目录」——默认就是勾书签栏那种情况', () => {
    expect(foldersPrompt('zh_CN', { total: 10, maxSiblings: 8 }).join(' ')).toContain('一级目录')
    expect(foldersPrompt('en', { total: 10, maxSiblings: 8 }).join(' ')).toMatch(/top-level folders/i)
  })

  it('startLevel=2 时全篇改口叫二级目录，不再出现「一级目录」', () => {
    const zh = foldersPrompt('zh_CN', { total: 10, maxSiblings: 8, startLevel: 2 }).join(' ')
    expect(zh).toContain('二级目录')
    expect(zh).not.toContain('一级目录')

    const en = foldersPrompt('en', { total: 10, maxSiblings: 8, startLevel: 2 }).join(' ')
    expect(en).toMatch(/level-2 folders/i)
    expect(en).not.toMatch(/top-level folders/i)
  })

  it('允许再分时，下一层的称呼也跟着推——二级下面是三级', () => {
    const zh = foldersPrompt('zh_CN', { total: 10, maxSiblings: 8, startLevel: 2, allowChildren: true }).join(' ')
    expect(zh).toContain('三级')

    const en = foldersPrompt('en', { total: 10, maxSiblings: 8, startLevel: 2, allowChildren: true }).join(' ')
    expect(en).toMatch(/level-3/i)
  })

  it('给出容器名时告诉模型这批目录会落在哪儿', () => {
    expect(foldersPrompt('zh_CN', { total: 10, maxSiblings: 8, startLevel: 2, containerTitle: '其他书签' }).join(' '))
      .toContain('其他书签')
    expect(foldersPrompt('en', { total: 10, maxSiblings: 8, startLevel: 2, containerTitle: 'Other Bookmarks' }).join(' '))
      .toContain('Other Bookmarks')
  })

  // 聚合组内部是「某个目录下面的子目录」，那套文案本来就是相对的，不该被绝对层级搅进来
  it('聚合组内部（带 parentTitle）不受 startLevel 影响', () => {
    const zh = foldersPrompt('zh_CN', { total: 5, parentTitle: 'GitHub', maxSiblings: 8, startLevel: 3 }).join(' ')
    expect(zh).toContain('子目录')
    expect(zh).not.toContain('三级目录')
  })
})

describe('newFolderNamesPrompt', () => {
  it('两种语言都把已有目录名列出来，并要求不要重名', () => {
    for (const locale of ['zh_CN', 'en'] as const) {
      const text = newFolderNamesPrompt(locale, ['01 GitHub', '02 语音合成']).join('\n')
      expect(text).toContain('01 GitHub')
      expect(text).toContain('02 语音合成')
    }
  })
})

describe('foldersPrompt 的同族拆分禁令', () => {
  it('带上「同一个主体不要按侧面拆开」，并给出反例', () => {
    const lines = foldersPrompt('zh_CN', { total: 30, maxSiblings: 8 }).join('\n')
    expect(lines).toContain('同一个主体')
    expect(lines).toContain('FastAPI')
  })

  it('英文版同样有，且整段不含中文', () => {
    const lines = foldersPrompt('en', { total: 30, maxSiblings: 8 }).join('\n')
    expect(lines).toContain('FastAPI')
    expect(/[一-鿿]/.test(lines)).toBe(false)
  })

  it('紧跟在复合名那条后面——两条治的是同一件事的两面', () => {
    const lines = foldersPrompt('zh_CN', { total: 30, maxSiblings: 8 }).join('\n')
    expect(lines).toContain('7. 一个目录只装一个概念')
    expect(lines).toMatch(/^8\. 同一个主体/m)
  })

  /** 组内那一摊 children 恒为空数组，提它只会让模型以为还有分层这个选项。 */
  it('只出一层时这条规则不提 children', () => {
    for (const opts of [
      { total: 30, parentTitle: 'GitHub', maxSiblings: 8 },
      { total: 30, maxSiblings: 8, allowChildren: false },
    ]) {
      const rule = foldersPrompt('zh_CN', opts).find((line) => line.includes('同一个主体'))
      expect(rule).toBeDefined()
      expect(rule).not.toContain('children')
    }
  })
})
