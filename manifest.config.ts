import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extName__',
  // 商店基本只按名字排，所以 extName 是「品牌词 + 品类词」的长名。但 Chrome 侧栏顶栏和
  // 扩展列表放不下它，会截断成一截没头没尾的字符串——那些窄处读 short_name。
  short_name: '__MSG_extShortName__',
  version: '1.1.0',
  description: '__MSG_extDescription__',
  // favicon：HTML 导出要把图标写进 ICON 属性，靠它读 chrome-extension://<id>/_favicon/
  // （只读 Chrome 本地已缓存的图标，不发外部请求）
  permissions: ['bookmarks', 'storage', 'unlimitedStorage', 'sidePanel', 'favicon'],
  // history 只给看板的「访问」排行用，装的时候不要。点「允许读取浏览记录」才申请。
  optional_permissions: ['history'],
  // https 那两条给模型端点用（按用户填的单个域名申请，见 sidepanel/lib/permissions.ts）。
  // http://*/* 是给失效链接检查加的：纯 http 的老书签恰恰是最可能已经死掉的那批，
  // 不声明就只能静默跳过它们，那是最糟的结果。
  // 仍然全是 optional——安装时 Reshelve 一个网络权限都不要，这条没变。
  optional_host_permissions: ['https://*/*', 'http://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
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
