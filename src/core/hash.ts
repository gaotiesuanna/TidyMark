/** djb2 字符串哈希，用于生成稳定的缓存 key。非加密用途。 */
export function djb2(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}
