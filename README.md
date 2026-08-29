# TidyMark

Reorganize your Chrome bookmarks with AI — every change is previewed, confirmed, and undoable.

**[▸ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/tidymark/hlmicephladojlmomimpngjaaaflapma)**

English | [简体中文](README.zh-CN.md)

TidyMark reorganizes your **native Chrome bookmarks**, not some separate system. When it's
done, your bookmarks bar is still your bookmarks bar, and sync across your devices works
exactly as before.

## You're in control, not the AI

- **You choose the scope.** Check the folders you want reorganized. Unchecked folders are
  never read and never modified — no bookmark moves out of them, and none moves in.
- **TidyMark judges the shape for you, and explains why.** Bookmarks that already look
  organized are only filed into the folders you have; a genuine mess gets a full redesign
  of the folder tree. The call comes with its reasoning, and you can override it before
  anything runs.
- **Review every move.** Before anything is applied, every move is listed: where each
  bookmark came from, where it's going, and why. Cancel any of them individually, or filter
  in bulk by confidence.
- **Undo in one click.** Not happy with the result? Restore everything to how it was.

## Bring your own model

TidyMark has no server. You point it at your own endpoint:

- The official OpenAI API
- Any OpenAI-compatible service (DeepSeek, Moonshot, a self-hosted proxy, …)
- Ollama or LM Studio on your own machine — data never leaves your computer

Every API key you enter is stored locally in `chrome.storage`, and each is only ever sent
to the endpoint it belongs to. Deleting an endpoint in Settings deletes its key with it.

## Privacy, specifically

Claims worth checking rather than taking on faith:

| Claim | Where to verify |
|---|---|
| URLs are trimmed before being sent — query parameters, anchors and embedded credentials are stripped, leaving only domain and path | [`src/core/sanitize.ts`](src/core/sanitize.ts) |
| Host access is never requested at install time; at runtime only the single domain you entered is requested | [`src/sidepanel/lib/permissions.ts`](src/sidepanel/lib/permissions.ts) |
| Two outbound network requests exist in the codebase, and you start both: the call to your endpoint, and — only once you run the dead-link check — a HEAD request to each bookmark's own site (falling back to GET when a server rejects HEAD). No analytics, telemetry, or tracking | [`src/llm/client.ts`](src/llm/client.ts), [`src/engine/linkCheck.ts`](src/engine/linkCheck.ts) |

Grepping for `fetch(` turns up a third hit, in
[`src/sidepanel/lib/favicons.ts`](src/sidepanel/lib/favicons.ts). That one is not outbound:
it reads `chrome-extension://<id>/_favicon/`, Chrome's own local icon cache, so that HTML
exports can carry icons. Nothing leaves your machine.

The wildcards in `optional_host_permissions` exist for two reasons: the endpoint is yours to
choose and cannot be enumerated in advance, and the dead-link check has to be able to reach
whatever your bookmarks point at. Both are *optional* permissions — neither is granted at
install time. For the endpoint, `chrome.permissions.request()` only ever asks for the one
domain you typed. The all-sites permission is asked for only when you press the dead-link
check button, and never before.

Full policy: [Privacy Policy / 隐私权政策](https://gist.github.com/gaotiesuanna/239c067efd9cc7d98f25ed5daa4c3ef7)

## Also included

- **Export** selected folders to JSON — full folder structure, or a flat list of links.
- **Import** a bookmark file someone shared with you. You see what's inside before anything
  is written, and everything lands in one new folder. `javascript:` and `data:` links are
  blocked and reported explicitly rather than silently dropped.

## Build from source

The Web Store listing above is the easy path. Build it yourself if you want to read the code
you're running, or hack on it:

```bash
npm install
npm run build     # type-check, then build to dist/
npm test          # 1677 tests across 86 files
npm run dev       # dev server with HMR
```

Load the extension by pointing `chrome://extensions` → *Load unpacked* at `dist/`.

The manifest is generated from [`manifest.config.ts`](manifest.config.ts) by CRXJS at build
time — don't hand-write `dist/manifest.json`, it gets overwritten.

## Layout

| Path | What lives there |
|---|---|
| `src/core` | Pure logic: URL sanitizing, rules, folder-tree building. No browser APIs |
| `src/engine` | Turning a plan into bookmark operations, and the undo snapshot |
| `src/llm` | The model client and prompts |
| `src/storage` | Settings, caches, undo snapshots |
| `src/background` | Service worker |
| `src/sidepanel` | The entire UI |
| `src/i18n` | Message lookup; strings live in `public/_locales` |

## License

[Apache-2.0](LICENSE)
