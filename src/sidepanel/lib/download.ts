/**
 * 触发浏览器把内容存成文件。
 *
 * 用 Blob + <a download> 而不是 chrome.downloads——侧栏里这条路不需要额外权限。
 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // 立刻 revoke 有可能赶在下载真正启动之前把 URL 抽掉，推迟到本轮任务结束再回收
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
