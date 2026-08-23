import type { Locale } from '@/core/locale'

/**
 * 禁止模型使用的宽泛词。中英各自独立成表——英文的宽泛词不是中文表的翻译，
 * 而是英文语境里真正没有区分度的那些词。
 *
 * 「其他」既在这张禁词表里、又是 core/tree.ts 的 FALLBACK_TITLE，看着打架，其实不是：
 * 禁词表约束的是**模型的产出**，兜底目录是**确定性产物**——建树时由代码补上，
 * 从不经过模型。两者作用对象不同，所以不改名（见 issues/04-folder-design-defects.md 末尾）。
 */
export const BROAD_WORDS: Record<Locale, string> = {
  zh_CN: 'AI、人工智能、开发、编程、技术、工具、学习、资源、其他',
  en: 'AI, tech, technology, tools, dev, development, learning, resources, misc, other',
}

/**
 * 第 5 条（无归属时带回 topic）只有非推翻模式用得上——推翻模式的候选目录是刚设计出来的，
 * 不存在放不进去。推翻模式的分类稳定性正是这个工作流要修的老问题，多一条模型用不上的
 * 规则也是对提示词的一次扰动，所以用参数把它挡在外面，让推翻模式拿到的提示词与加这条
 * 规则之前逐字节相同（调用点见 llm/classify.ts 的 buildBatchPrompt/ClassifyInput）。
 */
export function classifyPrompt(locale: Locale, includeTopicRule = true): string[] {
  if (locale === 'zh_CN') {
    return [
      '你是一个书签整理助手。为每个书签从下面的候选目录中选择最合适的一个。',
      '',
      '规则：',
      '1. 只能从候选目录里选，绝不能创造新目录。',
      '2. 如果没有任何目录合适，target_category_id 返回 null。',
      '3. confidence 是 0 到 1 之间的数字，表示你的把握程度。',
      '4. reason 用一句中文说明判断依据，不要提别的书签的 id 或编号——那串数字会原样显示给用户，而他看不懂。',
      ...(includeTopicRule
        ? ['5. 只有在 target_category_id 为 null 时，额外给出 topic：一个不超过 8 个字的主题词，说明这个书签属于什么类别。有合适目录时不要填 topic。']
        : []),
    ]
  }
  return [
    'You are a bookmark organizing assistant. For each bookmark, pick the single best folder from the candidates below.',
    '',
    'Rules:',
    '1. Only pick from the candidate folders. Never invent a new one.',
    '2. If no folder fits, return null for target_category_id.',
    '3. confidence is a number between 0 and 1 expressing how sure you are.',
    '4. Write reason as one short sentence in English. Do not mention other bookmarks by id or number — that string is shown to the user verbatim and means nothing to them.',
    ...(includeTopicRule
      ? ['5. Only when target_category_id is null, also return topic: a short subject label (at most 3 words) describing what this bookmark is about. Leave topic out when a folder fits.']
      : []),
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

/**
 * 层级的说法，按绝对层级（见 core/level.ts）。
 *
 * 英文第一级说 top-level 而不是 level-1：那是这个语言里的自然说法，
 * 而更深的层级没有同样自然的词，只能编号。中文四级以内有现成说法，超出就退回编号。
 */
function levelName(locale: Locale, level: number): string {
  if (locale === 'en') return level <= 1 ? 'top-level' : `level-${level}`
  return ['一', '二', '三', '四'][level - 1] ?? String(level)
}

/**
 * `maxSiblings` 直接照数字写进提示词，不在这里做任何加减——`MAX_SIBLINGS - 1`
 * 这类换算（给「其他」目录留位）由调用方（folders.ts）算好了再传进来，这里只管渲染。
 *
 * `startLevel` 同理是算好的绝对层级：这批目录建出来会落在第几层。勾书签栏时是 1，
 * 勾「其他书签」时是 2。不传按 1 算，也就是改造前唯一存在的那种情况。
 */
export function foldersPrompt(
  locale: Locale,
  opts: {
    total: number
    parentTitle?: string
    maxSiblings: number
    /** 允许模型用 children 再分一层。false 时提示词要求只输出一层。 */
    allowChildren?: boolean
    /** 这批目录的绝对层级。省略按 1 算。 */
    startLevel?: number
    /** 这批目录会被放进哪个目录，用于让模型知道自己在谁下面命名。 */
    containerTitle?: string
    /**
     * 目录至少要装下几个书签。省略表示不做这项要求（用户关掉了开关）。
     *
     * 标签清单里带着每个标签的书签数，模型有依据算出某个目录会不会太小。
     * 这只是第一道拦截：模型不一定照办，core/tree.ts 与 core/prune.ts 还会再收两次。
     */
    minFolderSize?: number
  },
): string[] {
  const {
    total, parentTitle, maxSiblings, allowChildren = true, startLevel = 1, containerTitle,
    minFolderSize,
  } = opts
  const here = levelName(locale, startLevel)
  const below = levelName(locale, startLevel + 1)
  // 尾部这几条规则里有可选项，编号必须按**实际出现**的顺序连排——写死编号的话，
  // 关掉某一条会在提示词里留下一个跳号，模型会以为自己漏看了一条规则。
  // 共有的第 5、6 条写死在下面两个分支里，所以这里从 7 起。
  const tailRules = (builders: Array<((index: number) => string) | null>): string[] => {
    const out: string[] = []
    let index = 7
    for (const build of builders) {
      if (build === null) continue
      out.push(build(index))
      index += 1
    }
    return out
  }

  // 复合名让互斥性必然破坏：两个名字各分一半语义给对方，就会抢同一批书签
  // （「Agent记忆与向量检索」撞「记忆与向量存储」，见 issues/04-folder-design-defects.md）。
  // 不做确定性强改——硬拆只会得到更宽泛、更容易撞禁词表的名字，所以只能在这里要求模型自己取舍。
  const compoundRule = (index: number): string =>
    locale === 'zh_CN'
      ? `${index}. 一个目录只装一个概念。禁止用「与」「和」「及」「/」这类连接词把两个概念捆成一个名字——「记忆与向量存储」「配置及排错」这种名字会和别的目录抢同一批书签，换个连接词不算取舍。必须挑一个概念，另一个要么单独开目录，要么并进别处。`
      : `${index}. One concept per folder. Never join two concepts with "and", "&", a slash, or a comma — a name like "Memory and vector storage" fights with other folders over the same bookmarks. Pick one concept; give the other its own folder, or fold it into an existing one.`

  // 与 compoundRule 是一对：那条禁「一个名字捆两个概念」，这条禁「一个概念摊成几个名字」。
  // 规则 1 只要求合并「同义或高度重叠」的标签，而「FastAPI教程」与「FastAPI用户认证」
  // 既不同义也不重叠——它们是同一个主体的不同侧面，不点破的话，模型照着规则 1 与
  // 规则 4（名字要具体）办事，反而正是会拆成这几个（见 llm/folders.ts 的 fragmentedFamilies）。
  const familyRule = (index: number): string => {
    // 只出一层的那几摊（下切时的分摊、allowChildren 关掉）children 恒为空数组，
    // 提它只会让模型以为还有分层这个选项。
    const layered = parentTitle === undefined && allowChildren
    if (locale === 'zh_CN') {
      return `${index}. 同一个主体不要按侧面拆成多个并列目录——「FastAPI教程」「FastAPI实战」「FastAPI数据库」应该合成一个「FastAPI」目录${layered ? '，并完之后书签多到撑得起来时，才用 children 把它分成侧面' : ''}。`
    }
    return `${index}. Never split one subject into parallel folders by aspect — "FastAPI tutorials", "FastAPI in practice" and "FastAPI database" should be a single "FastAPI" folder${layered ? ', and only once it holds enough bookmarks should you use children to split it by aspect' : ''}.`
  }

  const sizeRule = (index: number): string =>
    locale === 'zh_CN'
      ? `${index}. 不要建只装得下不到 ${minFolderSize} 个书签的目录；凑不满的标签并进相近的目录，没有相近的就不必给它单独开目录。`
      : `${index}. Only create a folder if it will hold at least ${minFolderSize} bookmarks. Merge labels that cannot fill one into a neighbouring folder; if none fits, leave them without a folder of their own.`

  if (locale === 'zh_CN') {
    const head = parentTitle !== undefined
      ? [
          `下面这些标签来自「${parentTitle}」目录里的 ${total} 个书签，需要为它们设计子目录。`,
          '这个共同点已经写在父目录名上，不要再拿它当分类依据。',
        ]
      : [
          `下面是从 ${total} 个书签中抽出的主题标签，每个标签后面是它的书签数。请据此设计目录结构。`,
          ...(containerTitle === undefined
            ? []
            : [`这些目录会放进「${containerTitle}」里，它们是${here}级目录。`]),
        ]

    const body = parentTitle !== undefined
      ? [
          '1. 合并同义或高度重叠的标签，用一个子目录容纳它们。',
          '2. 只输出一层目录，children 一律返回空数组。',
          `3. 子目录不超过 ${maxSiblings} 个。`,
          `4. 目录名要具体，禁止使用这些宽泛词：${BROAD_WORDS.zh_CN}。`,
        ]
      : [
          '1. 合并同义或高度重叠的标签，用一个目录容纳它们。',
          `2. ${here}级目录不超过 ${maxSiblings} 个。`,
          allowChildren
            ? `3. 书签少时只给一层目录，不要硬凑${below}级目录；只有当某个${here}级目录下确实存在多个清晰的子主题、书签数量也撑得起来时，才用 children 分出${below}级。`
            : '3. 只输出一层目录，children 一律返回空数组。',
          `4. ${here}级目录名要具体，禁止使用这些宽泛词：${BROAD_WORDS.zh_CN}。「Claude Code」「LLM 原理」「终端工具」是好名字，「AI」「开发」不是。`,
        ]

    return [
      ...head,
      '',
      '规则：',
      ...body,
      `5. 每个标签必须出现在恰好一个目录的 topics 里，不要遗漏、不要重复。直接归入某个${parentTitle === undefined ? `${here}级` : ''}目录的标签写在它自己的 topics 里，归入子目录的写在子目录的 topics 里。`,
      '6. 目录名用中文，专有技术名词（React、RAG、MCP）可直接用原文。',
      ...tailRules([
        compoundRule,
        familyRule,
        minFolderSize === undefined ? null : sizeRule,
      ]),
    ]
  }

  const head = parentTitle !== undefined
    ? [
        `The labels below come from ${total} bookmarks inside the "${parentTitle}" folder. Design subfolders for them.`,
        'That shared trait is already in the parent folder name, so do not use it as the basis for classification.',
      ]
    : [
        `Below are topic labels extracted from ${total} bookmarks, each followed by its bookmark count. Design a folder structure from them.`,
        ...(containerTitle === undefined
          ? []
          : [`These folders will go inside "${containerTitle}", which makes them ${here} folders.`]),
      ]

  const body = parentTitle !== undefined
    ? [
        '1. Merge synonymous or heavily overlapping labels into one subfolder.',
        '2. Output only one level. Always return an empty array for children.',
        `3. At most ${maxSiblings} subfolders.`,
        `4. Folder names must be specific. Never use these vague words: ${BROAD_WORDS.en}.`,
      ]
    : [
        '1. Merge synonymous or heavily overlapping labels into one folder.',
        `2. At most ${maxSiblings} ${here} folders.`,
        allowChildren
          ? `3. With few bookmarks, produce a single level. Only use children when a ${here} folder genuinely contains several distinct subtopics with enough bookmarks to justify them as ${below} folders.`
          : '3. Output only one level. Always return an empty array for children.',
        `4. ${here === 'top-level' ? 'Top-level' : here} folder names must be specific. Never use these vague words: ${BROAD_WORDS.en}. "Claude Code", "LLM internals", "Terminal tools" are good names; "AI", "Dev" are not.`,
      ]

  return [
    ...head,
    '',
    'Rules:',
    ...body,
    `5. Every label must appear in the topics of exactly one folder — none missing, none duplicated. Labels going directly into a${parentTitle === undefined ? ` ${here}` : ''} folder belong in its own topics; labels going into a subfolder belong in that subfolder.`,
    '6. Write folder names in English. Established technical names (React, RAG, MCP) stay as they are.',
    ...tailRules([
      compoundRule,
      familyRule,
      minFolderSize === undefined ? null : sizeRule,
    ]),
  ]
}

/**
 * 给若干个被合并的文件夹起一个统一的名字。
 * 只出名字，不出结构——目录结构由 foldersPrompt 那一轮已经定好了。
 *
 * 「一个目录一个概念」这条要求在这里也补一句（M7）：起名同样可能把两个概念用
 * 「与」/「and」捆成一个名字，只是这条路径只出一个名字、没有目录结构要建，
 * 所以不值得为它专门加一轮复合名检测与重问——软性提醒足够。
 */
export function mergeNamePrompt(locale: Locale, sourceTitles: string[]): string[] {
  if (locale === 'en') {
    return [
      'These bookmark folders are being merged into one new folder:',
      sourceTitles.map((title) => `- ${title}`).join('\n'),
      '',
      'Their bookmarks fall into the topics listed below.',
      'Give the new folder ONE short name (at most 12 characters) that covers them.',
      'One concept per name — do not join two concepts with "and" or "&".',
      'No numbering prefix. No quotes. No explanation.',
      'Reply with JSON: {"name": "..."}',
    ]
  }
  return [
    '下面这几个书签文件夹正在被合并成一个新文件夹：',
    sourceTitles.map((title) => `- ${title}`).join('\n'),
    '',
    '它们里面的书签分布在下列主题上。',
    '请给这个新文件夹起一个能概括它们的短名字，不超过 12 个字。',
    '一个名字只装一个概念，不要用「与」「和」把两个概念捆在一起。',
    '不要编号前缀，不要引号，不要解释。',
    '按 JSON 回复：{"name": "..."}',
  ]
}

/**
 * 给非推翻模式新建的目录起名。已有目录名一并给出，让模型别造重名或近义的目录——
 * 新目录是要长期与它们并排站着的。
 */
export function newFolderNamesPrompt(locale: Locale, existingTitles: string[]): string[] {
  const listed = existingTitles.length === 0
    ? (locale === 'zh_CN' ? '（这个范围下还没有目录）' : '(no folders here yet)')
    : existingTitles.map((title) => `- ${title}`).join('\n')
  if (locale === 'en') {
    return [
      'A bookmark folder already contains these folders:',
      listed,
      '',
      'The bookmarks below fit none of them, so new folders will be created for them.',
      'Give each topic ONE short folder name (at most 3 words).',
      'Rules:',
      '1. Never reuse or paraphrase any existing folder name listed above.',
      '2. Never give two topics the same name.',
      '3. No numbering prefix, no quotes, no explanation.',
      '4. Echo back the key you were given, unchanged.',
      'Reply with JSON: {"names": [{"key": "...", "name": "..."}]}',
    ]
  }
  return [
    '一个书签目录下已经有这些文件夹：',
    listed,
    '',
    '下面这些书签哪个都放不进去，将为它们新建目录。',
    '请给每个主题起一个短目录名，不超过 8 个字。',
    '规则：',
    '1. 绝不能重复或改写上面已有的任何目录名。',
    '2. 绝不能给两个主题起同一个名字。',
    '3. 不要编号前缀，不要引号，不要解释。',
    '4. key 原样回传，不要改动。',
    '按 JSON 回复：{"names": [{"key": "...", "name": "..."}]}',
  ]
}
