# Reshelve

用 AI 重新整理你的 Chrome 书签——每一处改动都会先预览、经你确认，并且随时可以撤销。

**[▸ 从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/reshelve/hlmicephladojlmomimpngjaaaflapma)**

[English](README.md) | 简体中文

Reshelve 整理的是你**原生的 Chrome 书签**，而不是另起炉灶的一套东西。整理完成后，书签栏还是那个书签栏，跨设备同步也和以前一样正常工作。

## 说了算的是你，不是 AI

- **范围由你划定。** 勾选你想整理的文件夹。没勾选的文件夹既不会被读取，也不会被改动——不会有书签从里面搬走，也不会有书签搬进去。
- **这次走哪条路，Reshelve 自己判断，并会讲清楚理由。** 已经整理过的书签只会被归进现有文件夹；确实一团乱麻才会重新设计整棵目录树。判断连同理由都会显示出来，动手之前你可以推翻它。
- **每一次移动都可复核。** 在真正落地之前，所有移动都会列出来：每个书签原本在哪、要去哪、为什么。你可以逐条取消，也可以按置信度批量筛选。
- **一键撤销。** 结果不满意？把一切恢复原样。

## 模型自备

Reshelve 没有服务器。你把它指向你自己的接口：

- OpenAI 官方 API
- 任何兼容 OpenAI 的服务（DeepSeek、Moonshot、自建代理……）
- 本机上的 Ollama 或 LM Studio——数据不会离开你的电脑

你填的每一把 API Key 都保存在本地的 `chrome.storage` 里，各自只会发往它对应的那个接口；在设置页删掉一个端点，那把 Key 一并消失。

## 隐私，说具体的

以下这些说法，与其信我，不如自己去核对：

| 说法 | 去哪儿核对 |
|---|---|
| URL 在发送前会被裁剪——查询参数、锚点和内嵌凭据都会被剥掉，只留下域名和路径 | [`src/core/sanitize.ts`](src/core/sanitize.ts) |
| 安装时不申请任何主机访问权限；运行时只申请你填写的那一个域名 | [`src/sidepanel/lib/permissions.ts`](src/sidepanel/lib/permissions.ts) |
| 整个代码库里只有两处对外网络请求，而且都由你亲手触发：调用你的接口，以及——仅当你真的跑了失效链接检查时——向每条书签自己的站点发一次 HEAD（服务器不认 HEAD 时回退成 GET）。没有埋点、遥测或追踪 | [`src/llm/client.ts`](src/llm/client.ts)、[`src/engine/linkCheck.ts`](src/engine/linkCheck.ts) |

搜 `fetch(` 会搜出第三处，在 [`src/sidepanel/lib/favicons.ts`](src/sidepanel/lib/favicons.ts)。那一处不是对外请求：它读的是 `chrome-extension://<id>/_favicon/`，也就是 Chrome 自己的本地图标缓存，用来给 HTML 导出补上图标。没有任何东西离开你的机器。

`optional_host_permissions` 里之所以有通配符，是两件事叠在一起：接口地址由你自己选，没法提前一一列举；失效链接检查又得够得着你书签指向的任何站点。两者都是*可选*权限，安装时一个都不会被授予。端点那条，`chrome.permissions.request()` 每次只申请你填的那一个域名；「访问所有网站」那条只在你按下失效链接检查的按钮时才申请，在那之前永远不会。

完整政策：[Privacy Policy / 隐私权政策](https://gist.github.com/gaotiesuanna/239c067efd9cc7d98f25ed5daa4c3ef7)

## 还附带这些

- **导出**所选文件夹为 JSON——保留完整的文件夹结构，或者导出成扁平的链接列表。
- **导入**别人分享给你的书签文件。写入之前你会先看到里面有什么，而且所有内容都会落到一个新建的文件夹里。`javascript:` 和 `data:` 链接会被拦截并明确告知，而不是悄悄丢掉。

## 从源码构建

上面的应用商店是省事的路子。如果你想读一读自己正在运行的代码，或者想动手改，就自己构建：

```bash
npm install
npm run build     # 先类型检查，再构建到 dist/
npm test          # 1700+ 个单元测试，不联网
npm run dev       # 带 HMR 的开发服务器
```

在 `chrome://extensions` 里选 *加载已解压的扩展程序*，指向 `dist/` 即可加载。

manifest 是构建时由 CRXJS 从 [`manifest.config.ts`](manifest.config.ts) 生成的——别手写 `dist/manifest.json`，它会被覆盖掉。

## 目录结构

| 路径 | 放的是什么 |
|---|---|
| `src/core` | 纯逻辑：URL 清洗、规则、文件夹树构建。不碰浏览器 API |
| `src/engine` | 把方案转成书签操作，以及撤销快照 |
| `src/llm` | 模型客户端和提示词 |
| `src/storage` | 设置、缓存、撤销快照 |
| `src/background` | Service Worker |
| `src/sidepanel` | 全部界面 |
| `src/i18n` | 文案查找；字符串放在 `public/_locales` |

## 许可协议

[Apache-2.0](LICENSE)
