import { stripNumberPrefix } from './map'

/**
 * 英文主体至少这么多字母才作数——比它短的多半是缩写（CI、CLI、Pro-），
 * 撞上一两个字母不说明是同一个东西。
 */
const MIN_ASCII_PREFIX = 3
/** 中文主体至少两个字：「模」一个字撞得太容易（模型 / 模块 / 模板）。 */
const MIN_CJK_PREFIX = 2

function commonPrefix(a: string, b: string): string {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return a.slice(0, i)
}

/**
 * 前缀在这个名字里有没有停在词边界上。
 *
 * 「Prometheus监控」与「Protobuf序列化」共享 `Pro`，长度够了却是半个单词——
 * 后面还接着小写字母就说明单词没写完，不算同一个主体。中日文字符不参与这条判断，
 * 它们本来就字字可断。
 */
export function endsAtBoundary(name: string, prefix: string): boolean {
  const next = name[prefix.length]
  return next === undefined || !/[a-z0-9]/i.test(next)
}

/** 两个名字共享的主体名；够不上「同一个主体」时返回 null。 */
export function familyPrefix(a: string, b: string): string | null {
  const prefix = commonPrefix(a, b).trim()
  if (prefix === '') return null
  const min = /[\u4e00-\u9fff]/.test(prefix) ? MIN_CJK_PREFIX : MIN_ASCII_PREFIX
  if ([...prefix].length < min) return null
  if (!endsAtBoundary(a, prefix) || !endsAtBoundary(b, prefix)) return null
  return prefix
}

/**
 * 在同层兄弟里找唯一一个与 title 同族的。
 * 0 个或多于 1 个都返回 null——多个同族时不敢猜该并进哪一个。
 */
export function uniqueFamilyMatch<T extends { title: string }>(
  title: string,
  siblings: readonly T[],
): T | null {
  const bare = stripNumberPrefix(title)
  const matches = siblings.filter((sibling) => {
    const other = stripNumberPrefix(sibling.title)
    return familyPrefix(bare, other) !== null
  })
  return matches.length === 1 ? matches[0]! : null
}
