import { PRESETS } from '@/storage/settings'
import { useStore } from '../store'

export function PreferencesStep() {
  const { scan, settings, setSettings, analyze, busy, reset } = useStore()
  if (scan === null) return null
  const { stats } = scan

  return (
    <div className="space-y-4">
      <section className="rounded border p-3 text-sm">
        <h2 className="mb-2 font-medium">扫描结果</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-neutral-500">书签</dt><dd>{stats.totalBookmarks}</dd>
          <dt className="text-neutral-500">文件夹</dt><dd>{stats.totalFolders}</dd>
          <dt className="text-neutral-500">空文件夹</dt><dd>{stats.emptyFolders}</dd>
          <dt className="text-neutral-500">无标题书签</dt><dd>{stats.untitledBookmarks}</dd>
          <dt className="text-neutral-500">重复链接组</dt><dd>{stats.duplicateUrlGroups}</dd>
          <dt className="text-neutral-500">最深层级</dt><dd>{stats.maxDepth}</dd>
        </dl>
      </section>

      <section className="space-y-2 rounded border p-3">
        <h2 className="text-sm font-medium">模型配置</h2>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              className="rounded border px-2 py-0.5 text-xs hover:bg-neutral-50"
              onClick={() => void setSettings({
                ...settings,
                llm: { ...settings.llm, baseUrl: preset.baseUrl, model: preset.model },
              })}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="Base URL"
          value={settings.llm.baseUrl}
          onChange={(e) => void setSettings({ ...settings, llm: { ...settings.llm, baseUrl: e.target.value } })}
        />
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="API Key"
          type="password"
          value={settings.llm.apiKey}
          onChange={(e) => void setSettings({ ...settings, llm: { ...settings.llm, apiKey: e.target.value } })}
        />
        <input
          className="w-full rounded border px-2 py-1 text-xs"
          placeholder="Model"
          value={settings.llm.model}
          onChange={(e) => void setSettings({ ...settings, llm: { ...settings.llm, model: e.target.value } })}
        />
        <p className="text-[11px] leading-relaxed text-neutral-400">
          API Key 明文保存在本地浏览器存储中，不会上传到任何服务器。
          发送给模型的内容仅包含书签标题、域名、路径与所在目录，不含 URL 参数与网页正文。
        </p>
      </section>

      <section className="rounded border p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            checked={settings.rebuildStructure}
            onChange={(e) => void setSettings({ ...settings, rebuildStructure: e.target.checked })}
          />
          <span>
            推翻现有文件夹结构
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
              关闭时只把书签移进已有文件夹，绝不改名、合并或删除任何现有文件夹。
              开启时允许重新设计整棵目录树。
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            checked={settings.removeEmptyFolders}
            onChange={(e) => void setSettings({ ...settings, removeEmptyFolders: e.target.checked })}
          />
          <span>
            整理后清理空文件夹
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-400">
              删除范围内不含任何书签的文件夹，包括子目录清空后变空的父目录。
              范围根目录不会被删除，撤销时会连同目录一起还原。
            </span>
          </span>
        </label>
      </section>

      <div className="flex gap-2">
        <button className="rounded border px-3 py-2 text-sm" onClick={reset}>返回</button>
        <button
          className="flex-1 rounded bg-neutral-800 py-2 text-sm text-white disabled:opacity-40"
          disabled={busy !== null || settings.llm.apiKey.trim() === ''}
          onClick={() => void analyze()}
        >
          开始 AI 分析
        </button>
      </div>
    </div>
  )
}
