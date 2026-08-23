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
| Exactly one outbound network request exists in the codebase — the call to your endpoint. No analytics, telemetry, or tracking | [`src/llm/client.ts`](src/llm/client.ts) |

The wildcard in `optional_host_permissions` exists because the endpoint is yours to choose
and cannot be enumerated in advance. It is an *optional* permission: it is not granted at
install time, and `chrome.permissions.request()` only ever asks for the one origin you typed.

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
npm test          # 708 tests across 49 files
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
