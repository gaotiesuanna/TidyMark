import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'TidyMark',
  version: '0.1.0',
  description: '用 AI 重构 Chrome 原生书签 —— 所有修改可预览、可确认、可撤销',
  permissions: ['bookmarks', 'storage', 'unlimitedStorage', 'sidePanel'],
  optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  action: { default_title: 'TidyMark' },
})
