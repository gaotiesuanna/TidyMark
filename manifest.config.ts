import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extName__',
  version: '1.0.0',
  description: '__MSG_extDescription__',
  // favicon：HTML 导出要把图标写进 ICON 属性，靠它读 chrome-extension://<id>/_favicon/
  // （只读 Chrome 本地已缓存的图标，不发外部请求）
  permissions: ['bookmarks', 'storage', 'unlimitedStorage', 'sidePanel', 'favicon'],
  optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  // 图标由 tools/gen-icon.py 生成，源文件在 public/icons/，改配色或形状后重跑该脚本
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  action: {
    default_title: '__MSG_extName__',
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
})
