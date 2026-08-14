import { createRoot } from 'react-dom/client'
import { currentLocale, resolveLocale, setLocale } from '@/i18n'
import { DEFAULT_SETTINGS } from '@/storage/settings'
import App from './App'
import { useStore } from './store'
import { applyDocumentLang } from './lib/documentLang'
import { send } from './lib/send'
import './index.css'

/**
 * 挂载前先把语言定下来。init() 在首次渲染之后的 useEffect 里才读设置，
 * 那样第一帧会用错语言再闪一下。
 * send 失败（后台没起来）时用 DEFAULT_SETTINGS，即 'auto'，
 * 行为退回改造前的样子，不阻塞渲染。
 */
void (async () => {
  const res = await send({ kind: 'get_settings' })
  const settings = res.ok && res.kind === 'get_settings' ? res.settings : DEFAULT_SETTINGS
  setLocale(resolveLocale(settings.uiLocale))
  applyDocumentLang()
  // store 的 locale 初值是模块求值那一刻的语言，也就是还没 setLocale 前的 'en'。
  // 不在这里对齐，init() 末尾那次 syncLocale 会把 key 从 'en' 改成真实语言，
  // 于是每个非英文用户一开侧栏就白白重挂载一次整棵树。
  useStore.setState({ locale: currentLocale() })
  createRoot(document.getElementById('root')!).render(<App />)
})()
