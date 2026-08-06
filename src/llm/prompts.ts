import type { Locale } from '@/core/locale'

/**
 * 禁止模型使用的宽泛词。中英各自独立成表——英文的宽泛词不是中文表的翻译，
 * 而是英文语境里真正没有区分度的那些词。
 */
export const BROAD_WORDS: Record<Locale, string> = {
  zh_CN: 'AI、人工智能、开发、编程、技术、工具、学习、资源、其他',
  en: 'AI, tech, technology, tools, dev, development, learning, resources, misc, other',
}

export function classifyPrompt(locale: Locale): string[] {
  if (locale === 'zh_CN') {
    return [
      '你是一个书签整理助手。为每个书签从下面的候选目录中选择最合适的一个。',
      '',
      '规则：',
      '1. 只能从候选目录里选，绝不能创造新目录。',
      '2. 如果没有任何目录合适，target_category_id 返回 null。',
      '3. confidence 是 0 到 1 之间的数字，表示你的把握程度。',
      '4. reason 用一句中文说明判断依据。',
    ]
  }
  return [
    'You are a bookmark organizing assistant. For each bookmark, pick the single best folder from the candidates below.',
    '',
    'Rules:',
    '1. Only pick from the candidate folders. Never invent a new one.',
    '2. If no folder fits, return null for target_category_id.',
    '3. confidence is a number between 0 and 1 expressing how sure you are.',
    '4. Write reason as one short sentence in English.',
  ]
}

export function tagsPrompt(locale: Locale): string[] {
  if (locale === 'zh_CN') {
    return [
      '为每个书签抽取一个具体主题，供后续归并使用。',
      '',
      '规则：',
      '1. 主题回答「这个书签讲什么、解决什么问题」，要具体。',
      `2. 禁止使用这些宽泛词：${BROAD_WORDS.zh_CN}。`,
      '3. 例如「Claude Code」「KV Cache」「终端工具」「提示工程」，而不是「AI」「开发」。',
      '4. 主题名用中文，2 到 8 个字；专有技术名词（React、RAG、MCP）可直接用原文。',
      '5. 尽量复用已出现过的主题名，不要为同一概念创造多个说法。',
    ]
  }
  return [
    'Extract one specific topic for each bookmark, to be merged into folders later.',
    '',
    'Rules:',
    '1. The topic answers "what is this about, what problem does it solve". Be specific.',
    `2. Never use these vague words: ${BROAD_WORDS.en}.`,
    '3. Good: "Claude Code", "KV Cache", "Terminal tools", "Prompt engineering". Bad: "AI", "Dev".',
    '4. Write topics in English, 1 to 4 words. Established technical names (React, RAG, MCP) stay as they are.',
    '5. Reuse topics you have already produced. Do not invent several names for one concept.',
  ]
}

export function groupTagsPrompt(locale: Locale, groupTitle: string): string[] {
  if (locale === 'zh_CN') {
    return [
      `下面这些书签全部来自「${groupTitle}」。这个共同点已经体现在目录名上，不要再拿它当分类依据。`,
      '为每个书签抽取一个「功能域」标签，回答「它解决什么问题」。',
      '',
      '规则：',
      `1. 禁止使用这些宽泛词：${BROAD_WORDS.zh_CN}。`,
      '2. 用具体的问题域，例如「文档解析」「RAG 检索」「模型微调」「语音合成」「Agent 框架」「可观测性」。',
      '3. title 通常是「作者/仓库名: 一句话简介」，简介是判断用途最可靠的依据。',
      '4. 标签用中文，2 到 6 个字；专有技术名词（RAG、MCP、TTS）可直接用原文。',
      '5. 尽量复用已出现过的标签名，不要为同一概念创造多个说法。',
    ]
  }
  return [
    `Every bookmark below comes from "${groupTitle}". That shared trait is already in the folder name, so do not use it as the basis for classification.`,
    'Extract one capability-domain label for each bookmark, answering "what problem does it solve".',
    '',
    'Rules:',
    `1. Never use these vague words: ${BROAD_WORDS.en}.`,
    '2. Use concrete problem domains, e.g. "Document parsing", "RAG retrieval", "Model fine-tuning", "Speech synthesis", "Agent frameworks", "Observability".',
    '3. The title is usually "owner/repo: one-line description". That description is the most reliable signal.',
    '4. Write labels in English, 1 to 3 words. Established technical names (RAG, MCP, TTS) stay as they are.',
    '5. Reuse labels you have already produced. Do not invent several names for one concept.',
  ]
}

/**
 * `maxSiblings` 直接照数字写进提示词，不在这里做任何加减——`MAX_SIBLINGS - 1`
 * 这类换算（给「其他」目录留位）由调用方（folders.ts）算好了再传进来，这里只管渲染。
 */
export function foldersPrompt(
  locale: Locale,
  opts: { total: number; parentTitle?: string; maxSiblings: number },
): string[] {
  const { total, parentTitle, maxSiblings } = opts

  if (locale === 'zh_CN') {
    const head = parentTitle !== undefined
      ? [
          `下面这些标签来自「${parentTitle}」目录里的 ${total} 个书签，需要为它们设计子目录。`,
          '这个共同点已经写在父目录名上，不要再拿它当分类依据。',
        ]
      : [`下面是从 ${total} 个书签中抽出的主题标签，每个标签后面是它的书签数。请据此设计目录结构。`]

    const body = parentTitle !== undefined
      ? [
          '1. 合并同义或高度重叠的标签，用一个子目录容纳它们。',
          '2. 只输出一层目录，children 一律返回空数组。',
          `3. 子目录不超过 ${maxSiblings} 个。`,
          `4. 目录名要具体，禁止使用这些宽泛词：${BROAD_WORDS.zh_CN}。`,
        ]
      : [
          '1. 合并同义或高度重叠的标签，用一个目录容纳它们。',
          `2. 一级目录不超过 ${maxSiblings} 个。`,
          '3. 书签少时只给一层目录，不要硬凑二级目录；只有当某个一级目录下确实存在多个清晰的子主题、书签数量也撑得起来时，才用 children 分出二级。',
          `4. 一级目录名要具体，禁止使用这些宽泛词：${BROAD_WORDS.zh_CN}。「Claude Code」「LLM 原理」「终端工具」是好名字，「AI」「开发」不是。`,
        ]

    return [
      ...head,
      '',
      '规则：',
      ...body,
      '5. 每个标签必须出现在恰好一个目录的 topics 里，不要遗漏、不要重复。直接归入某个一级目录的标签写在它自己的 topics 里，归入子目录的写在子目录的 topics 里。',
      '6. 目录名用中文，专有技术名词（React、RAG、MCP）可直接用原文。',
    ]
  }

  const head = parentTitle !== undefined
    ? [
        `The labels below come from ${total} bookmarks inside the "${parentTitle}" folder. Design subfolders for them.`,
        'That shared trait is already in the parent folder name, so do not use it as the basis for classification.',
      ]
    : [`Below are topic labels extracted from ${total} bookmarks, each followed by its bookmark count. Design a folder structure from them.`]

  const body = parentTitle !== undefined
    ? [
        '1. Merge synonymous or heavily overlapping labels into one subfolder.',
        '2. Output only one level. Always return an empty array for children.',
        `3. At most ${maxSiblings} subfolders.`,
        `4. Folder names must be specific. Never use these vague words: ${BROAD_WORDS.en}.`,
      ]
    : [
        '1. Merge synonymous or heavily overlapping labels into one folder.',
        `2. At most ${maxSiblings} top-level folders.`,
        '3. With few bookmarks, produce a single level. Only use children when a top-level folder genuinely contains several distinct subtopics with enough bookmarks to justify them.',
        `4. Top-level folder names must be specific. Never use these vague words: ${BROAD_WORDS.en}. "Claude Code", "LLM internals", "Terminal tools" are good names; "AI", "Dev" are not.`,
      ]

  return [
    ...head,
    '',
    'Rules:',
    ...body,
    '5. Every label must appear in the topics of exactly one folder — none missing, none duplicated. Labels going directly into a top-level folder belong in its own topics; labels going into a subfolder belong in that subfolder.',
    '6. Write folder names in English. Established technical names (React, RAG, MCP) stay as they are.',
  ]
}
