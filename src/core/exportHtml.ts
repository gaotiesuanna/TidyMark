import type { ExportNode } from './export'
import type { BookmarkNode } from './ports'
import { findScopeRoots } from './scan'

/**
 * Netscape 书签文件（各家浏览器「导入书签」共同认的那个 HTML 格式）。
 *
 * 与 tidymark/v1 的 JSON 导出并列而不是替代它：JSON 是 Reshelve 自己的往返格式，
 * 这份 HTML 是给别的浏览器吃的，多带一样东西——favicon，写在 <A> 的 ICON 属性里。
 * 注意 ICON 只有 Firefox 一类导入器会读，Chrome 的导入器读完就丢，
 * Chrome 里书签的图标始终来自它自己的 favicon 库。
 */

/** 五个字符一起转，因为同一段文本既可能落在标签内容里也可能落在属性值里。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;') // 必须第一个换，否则会把后面几条产出的 & 二次转义
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toNode(node: BookmarkNode): ExportNode {
  if (node.url !== undefined) return { name: node.title, url: node.url }
  return { name: node.title, children: (node.children ?? []).map(toNode) }
}

/**
 * 这个格式的缩进是历史约定：每层 4 个空格，<DL><p> 与它的条目差一级。
 * 导入器并不解析缩进，纯粹为了导出的文件用编辑器打开时还能读。
 */
function renderNodes(nodes: ExportNode[], icons: Map<string, string>, depth: number): string[] {
  const pad = ' '.repeat(depth * 4)
  const lines: string[] = []
  for (const node of nodes) {
    if ('url' in node) {
      const icon = icons.get(node.url)
      // 取不到图标就整个不写 ICON 属性——写 ICON="" 会让导入器拿到一个坏图片
      const iconAttr = icon === undefined ? '' : ` ICON="${escapeHtml(icon)}"`
      lines.push(`${pad}<DT><A HREF="${escapeHtml(node.url)}"${iconAttr}>${escapeHtml(node.name)}</A>`)
      continue
    }
    lines.push(`${pad}<DT><H3>${escapeHtml(node.name)}</H3>`)
    lines.push(`${pad}<DL><p>`)
    lines.push(...renderNodes(node.children, icons, depth + 1))
    lines.push(`${pad}</DL><p>`)
  }
  return lines
}

/**
 * icons 按 URL 索引 data URL，缺项即「这条没有图标」。
 * 图标怎么取是浏览器层的事（见 sidepanel/lib/favicons.ts），这一层只做拼装，
 * 好让整个格式在 node 环境下可测。
 */
export function toHtmlExport(
  tree: BookmarkNode[],
  scopeRootIds: string[],
  icons: Map<string, string>,
): string {
  const roots = findScopeRoots(tree, scopeRootIds).map(toNode)
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will not be read or written by the browser. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    ...renderNodes(roots, icons, 1),
    '</DL><p>',
    '',
  ].join('\n')
}
