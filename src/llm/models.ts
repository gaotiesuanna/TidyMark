/**
 * 从 OpenAI 兼容的 GET /models 抽出模型名。
 *
 * 名单是给设置页的下拉用的：用户不该手打一个端点上根本没有的名字。
 */

function stripSecret(text: string, secret: string): string {
  const key = secret.trim()
  if (key === '') return text
  return text.split(key).join('***')
}

export function parseModelList(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) return []
  const data = payload.data
  if (!Array.isArray(data)) return []
  const names: string[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null || !('id' in item)) continue
    const id = item.id
    if (typeof id !== 'string') continue
    const name = id.trim()
    if (name === '') continue
    names.push(name)
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

export async function listRemoteModels(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const headers: Record<string, string> = {}
  if (apiKey.trim() !== '') headers.Authorization = `Bearer ${apiKey}`
  const res = await fetchImpl(url, { headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(stripSecret(`模型列表接口返回 ${res.status}: ${body}`, apiKey))
  }
  const payload: unknown = await res.json()
  return parseModelList(payload)
}
