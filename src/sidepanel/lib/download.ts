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
  // 延迟 0 只让出一个宏任务，余量太薄：大 Blob 下下载启动与 revoke 存在竞态
  // （FileSaver.js 等成熟实现用的是数十秒量级），这里用 1000ms 换取更充分的安全余量
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
