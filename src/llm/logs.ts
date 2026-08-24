import type { Locale } from '@/core/locale'

/**
 * llm 层自己产生的、会显示在侧栏运行日志里的文案。
 *
 * 不走 _locales：llm/ 要保持零浏览器依赖、能在 node 环境测试，
 * 因此和 core/rules.ts 一样自带双语表，语言由调用方传入。
 */
/**
 * 一批跑完了。
 *
 * `progress` 里的 `inflight` 是**已派发但还没回来**的批次序号（0 起）。
 * 报它是因为批次并发跑、乱序完成，只说「谁完成了」的日志逼用户自己拿完成集
 * 去减总集才推得出卡在哪——真实一遍里 8 批有 2 批永久挂起，用户看到的就是
 * 一串乱序的完成行，全靠肉眼做减法。
 *
 * 也不再写成 `8/8`：那个形状与「已完成几批」撞脸，在只完成 6 批时读起来像
 * 「8 个全完了」，跟同屏的进度数字自相矛盾。序号一律带 `#`。
 */
export function logBatch(
  locale: Locale,
  label: string,
  index: number,
  total: number,
  size: number,
  progress: { done: number; inflight: number[] },
): string {
  const names = progress.inflight.map((i) => i + 1).join(locale === 'zh_CN' ? '、' : ', ')
  if (locale === 'zh_CN') {
    const tail = names === '' ? '' : `，第 ${names} 批还在跑`
    // label 自带「批次」二字（「标签批次」），这里再写一次「第 N 批」就把「批」说了两遍。
    // 剥掉尾巴上的「批次」，让它退回成纯粹的限定词：「标签 第 1 批完成」。
    const what = label.replace(/批次$/, '')
    return `${what} 第 ${index + 1} 批完成：${size} 条（已完成 ${progress.done}/${total}${tail}）`
  }
  const plural = progress.inflight.length > 1 ? 'batches' : 'batch'
  const tail = names === '' ? '' : `, ${plural} ${names} still running`
  return `${label} ${index + 1} done: ${size} items (${progress.done}/${total} complete${tail})`
}

/**
 * `size` 与 `ok` 都按**书签条数**算，不按请求条目数——用户在同一屏里连着读到
 * 「N 个书签」「这一行」「N 条移动建议」，中间换口径就是一个没有任何解释的数字。
 *
 * `asked` 是这批实际发出去的提问数。同 URL 的书签会被折叠成一个提问
 * （见 llm/classify.ts 的分组），那时 asked < size，多出来的那半句正是为了
 * 解释请求数为什么比书签数少。省略 `asked` 或 asked === size 时（绝大多数批次
 * 都是），文案与折叠这件事不存在时一字不差——不为少数情形给所有人加噪音。
 */
export function logBatchDone(
  locale: Locale, index: number, total: number, size: number, ok: number, ms: number, asked = size,
): string {
  if (locale === 'zh_CN') {
    const merged = asked < size ? `（重复 URL 合并后只问了 ${asked} 次）` : ''
    return `分类批次 ${index + 1}/${total}：${size} 条${merged}，成功 ${ok} 条，耗时 ${ms}ms`
  }
  const merged = asked < size ? ` (deduplicated to ${asked} requests)` : ''
  return `Classify batch ${index + 1}/${total}: ${size} items${merged}, ${ok} succeeded, ${ms}ms`
}

/**
 * `attempts` 是这一批一共问出去多少次请求（含重试与拆批后各半的尝试）。
 *
 * 不写出来，这条日志就跟「一次都没重试」长得一模一样——排查时只能回去读代码
 * 猜重试有没有生效。次数在这里是唯一能自证的东西。
 */
export function logBatchFailed(
  locale: Locale, label: string, index: number, total: number, detail: string, attempts: number,
): string {
  return locale === 'zh_CN'
    ? `${label} ${index + 1}/${total} 失败（问了 ${attempts} 次都没成），这批书签不参与目录设计：${detail}`
    : `${label} ${index + 1}/${total} failed after ${attempts} attempts; these bookmarks are excluded from folder design: ${detail}`
}

/**
 * 输出被截断，这一批拆开重问。
 *
 * 不能沿用 logBatchFailed：那条说的是「这批书签不参与目录设计」，而这里一条都还没丢，
 * 只是问法换小了。把「多少条被拆」写出来，递归拆到第二层、第三层时读日志才分得清层级。
 */
export function logBatchSplit(
  locale: Locale, label: string, index: number, total: number, size: number,
): string {
  return locale === 'zh_CN'
    ? `${label} ${index + 1}/${total} 输出被截断，${size} 条拆成两半重问`
    : `${label} ${index + 1}/${total} output was truncated; splitting ${size} items in half and retrying`
}

/** 拆开之后仍然失败的那一半——丢的只有这几条，同批的另一半已经拿到了。 */
export function logBatchPartFailed(
  locale: Locale, label: string, index: number, total: number, size: number, detail: string,
): string {
  return locale === 'zh_CN'
    ? `${label} ${index + 1}/${total} 拆开后仍有 ${size} 条失败，这些书签不参与目录设计：${detail}`
    : `${label} ${index + 1}/${total}: ${size} items still failed after splitting; those bookmarks are excluded from folder design: ${detail}`
}

export function logFoldersDone(locale: Locale, folders: number, merged: number): string {
  return locale === 'zh_CN'
    ? `目录设计完成：${folders} 个目录，归并 ${merged} 个标签`
    : `Folder design done: ${folders} folders, ${merged} labels merged`
}

export function logFoldersFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `目录设计失败，保留原始标签进入建树：${detail}`
    : `Folder design failed; falling back to raw labels: ${detail}`
}

/**
 * 只在「重问」那次请求失败时打——第一版设计还在，不是退回原始标签，
 * 因此不能沿用 logFoldersFailed 的文案（见 issues review I1：那条文案说反话）。
 */
export function logFoldersRetryFailed(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `重出目录名失败，沿用上一版：${detail}`
    : `Retry failed; keeping the previous design: ${detail}`
}

export function logDuplicateTopics(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `模型返回的目录设计中标签重复声明，已保留最后一个：${detail}`
    : `The model declared the same label in several folders; kept the last one: ${detail}`
}

/**
 * 超出一级目录上限、整个被丢弃的那几个目录。
 *
 * 必须点名而不只报个数：被丢掉的目录吸收的标签会一并变成未映射、落进「其他」，
 * 用户看到的是「其他」莫名其妙变大，而链路上此前没有任何一处告诉过他这件事
 * 发生过（organize-audit-holes 06 票判准 C）。
 */
export function logFoldersDropped(locale: Locale, count: number, detail: string): string {
  return locale === 'zh_CN'
    ? `超出一级目录上限，丢弃了 ${count} 个目录，它们的书签会落进「其他」：${detail}`
    : `Over the top-level folder limit; dropped ${count} folders, their bookmarks fall into "Other": ${detail}`
}

export function logCompoundNames(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `目录名把两个概念捆在了一起，已要求模型重出一版：${detail}`
    : `Some folder names bundle two concepts; asked the model for another pass: ${detail}`
}

export function logCompoundNamesRemain(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `重出后仍有目录名捆着两个概念，按现状继续：${detail}`
    : `Folder names still bundle two concepts after the retry; continuing as is: ${detail}`
}

/**
 * 同一个主体被拆成几个装不满的并列目录（「FastAPI教程」「FastAPI实战」…）。
 *
 * 与 logCompoundNames 是一对：那条治「一个名字捆两个概念」，这条治「一个概念摊成几个名字」，
 * 两者共用同一次重问，所以措辞也对齐成「已要求模型重出一版」。
 */
export function logFragmentedFamilies(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `同一个主体被拆成了几个装不满的目录，已要求模型重出一版：${detail}`
    : `One subject was split across several folders too small to fill; asked the model for another pass: ${detail}`
}

/** 重问之后仍然拆着的那些。第一版（或更好的那一版）仍在用，不是退回原始标签。 */
export function logFamiliesRemain(locale: Locale, detail: string): string {
  return locale === 'zh_CN'
    ? `重出后仍有目录把同一个主体拆着，按现状继续：${detail}`
    : `Some folders still split one subject after the retry; continuing as is: ${detail}`
}

/**
 * 主题那摊设计完之后，有多少标签没能映射到任何目录（`applyDesign` 置成 NO_TOPIC）。
 * 这些书签最终去处由分类阶段决定——多半是「其他」，也可能是某个已有目录的候选。
 * 只在 N > 0 时打，不发明比例阈值（见 issues review I5）。
 */
export function logNoTopicMapped(locale: Locale, count: number): string {
  return locale === 'zh_CN'
    ? `主题设计完成后有 ${count} 个标签没有映射到任何目录，去处由分类阶段决定`
    : `${count} labels were not mapped to any folder after topic design; where they end up is decided by the classification step`
}

export function fallbackReason(
  locale: Locale, kind: 'noResult' | 'failed' | 'unprocessed', detail = '',
): string {
  if (locale === 'zh_CN') {
    if (kind === 'noResult') return '模型未返回该书签的结果'
    if (kind === 'unprocessed') return '未处理'
    return `分类失败，保持原位：${detail}`
  }
  if (kind === 'noResult') return 'The model returned no result for this bookmark'
  if (kind === 'unprocessed') return 'Not processed'
  return `Classification failed, left in place: ${detail}`
}
