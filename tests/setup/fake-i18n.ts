export interface MessageEntry {
  message: string
  placeholders?: Record<string, { content: string }>
}

export type Catalog = Record<string, MessageEntry>

/**
 * Unicode 私有区字符，正常文案里不会出现。替换期间先把 $$ 换成它，
 * 免得占位符正则把转义后的 $ 当成占位符边界，最后再换回 $。
 * 写成转义序列而不是字面字符——不可见字符会被编辑器或复制粘贴弄丢。
 */
const DOLLAR = '\uE000'

/**
 * 复刻 chrome.i18n.getMessage 的替换语义。
 *
 * 桩若与真实语义不符，会出现测试全绿而线上文案错乱，所以这里照规范实现：
 * 找不到键返回空串、具名占位符大小写不敏感、content 里的 $1..$9 引用实参、
 * $$ 转义、未声明的 $name$ 原样保留。
 */
export function createGetMessage(catalog: Catalog) {
  return function getMessage(key: string, subs?: string | string[]): string {
    const entry = catalog[key]
    if (entry === undefined) return ''

    const args = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs]
    // 先把 $$ 换成私有区字符，免得后面的占位符正则把它当成占位符边界
    const protectedMessage = entry.message.replace(/\$\$/g, DOLLAR)

    const replaced = protectedMessage.replace(/\$([A-Za-z0-9_@]+)\$/g, (whole, name: string) => {
      const declared = entry.placeholders ?? {}
      const hit = Object.entries(declared).find(([k]) => k.toLowerCase() === name.toLowerCase())
      if (hit === undefined) return whole
      return hit[1].content.replace(/\$(\d)/g, (_, digit: string) => args[Number(digit) - 1] ?? '')
    })

    return replaced.replace(new RegExp(DOLLAR, 'g'), '$')
  }
}
