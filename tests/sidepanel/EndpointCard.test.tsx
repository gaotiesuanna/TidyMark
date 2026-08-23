import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EndpointCard, checkBaseUrl, type EndpointCardProps } from '@/sidepanel/components/EndpointCard'
import { useStore } from '@/sidepanel/store'
import type { Endpoint } from '@/storage/settings'

const endpoint: Endpoint = {
  baseUrl: 'https://opencode.ai/zen/go/v1',
  apiKey: 'sk-x',
  models: ['glm-5.2', 'deepseek-v4-flash'],
}

function arrange(over: Partial<EndpointCardProps> = {}) {
  const onChange = vi.fn()
  const onDelete = vi.fn()
  const onPick = vi.fn()
  render(
    <EndpointCard
      endpoint={endpoint}
      activeModel="glm-5.2"
      onChange={onChange}
      onDelete={onDelete}
      onPick={onPick}
      {...over}
    />,
  )
  return { onChange, onDelete, onPick }
}

beforeEach(() => {
  useStore.setState({ modelTests: {}, testModel: vi.fn(async () => {}) })
})

describe('折叠态', () => {
  it('显示域名而不是完整地址——域名才是区分端点的那个东西', () => {
    arrange()
    expect(screen.getByText('opencode.ai')).toBeTruthy()
    expect(screen.queryByDisplayValue('https://opencode.ai/zen/go/v1')).toBeNull()
  })

  it('Key 填了就说填了，不摆一串没有信息量的圆点', () => {
    arrange()
    expect(screen.getByText('Key 已填')).toBeTruthy()
  })

  it('Key 为空时说为空', () => {
    arrange({ endpoint: { ...endpoint, apiKey: '' } })
    expect(screen.getByText('Key 为空')).toBeTruthy()
  })

  // isModelConfigured 对本机放行空 Key，README 明确支持这条路；
  // 在这儿写「Key 为空」会让一份完全正常的 Ollama 配置看起来像坏的
  it('本机端点空 Key 是正常的，说「本机，无需 Key」', () => {
    arrange({ endpoint: { baseUrl: 'http://localhost:11434/v1', apiKey: '', models: ['qwen2.5'] } })
    expect(screen.getByText('本机，无需 Key')).toBeTruthy()
  })

  it('列出所有模型，当前在用的那个是选中的', () => {
    arrange()
    expect((screen.getByRole('radio', { name: 'glm-5.2' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'deepseek-v4-flash' }) as HTMLInputElement).checked).toBe(false)
  })

  it('点另一个模型的圆点即时切换，不经过保存', async () => {
    const { onPick } = arrange()
    await userEvent.click(screen.getByRole('radio', { name: 'deepseek-v4-flash' }))
    expect(onPick).toHaveBeenCalledWith('deepseek-v4-flash')
  })

  it('本端点不含当前那一对时一个圆点都不选中', () => {
    arrange({ activeModel: null })
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).checked).toBe(false)
    }
  })
})

describe('草稿态', () => {
  it('点编辑才露出地址与 Key 的输入框', async () => {
    arrange()
    expect(screen.queryByDisplayValue('https://opencode.ai/zen/go/v1')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByDisplayValue('https://opencode.ai/zen/go/v1')).toBeTruthy()
    expect(screen.getByDisplayValue('sk-x')).toBeTruthy()
  })

  // 每敲一个字符就往 chrome.storage 写一次明文 Key，是这次要消灭的东西
  it('打字期间不往上报，保存才报', async () => {
    const { onChange } = arrange()
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    await userEvent.type(screen.getByDisplayValue('sk-x'), 'y')
    expect(onChange).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onChange).toHaveBeenCalledWith({ ...endpoint, apiKey: 'sk-xy' })
  })

  it('取消丢掉草稿并折回，一个字都不上报', async () => {
    const { onChange } = arrange()
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    await userEvent.type(screen.getByDisplayValue('sk-x'), 'y')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('sk-xy')).toBeNull()
  })

  it('保存时拦下填成完整端点的地址，并说清为什么', async () => {
    const { onChange } = arrange()
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    const input = screen.getByDisplayValue('https://opencode.ai/zen/go/v1')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://opencode.ai/zen/go/v1/chat/completions')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/自己会接上/)).toBeTruthy()
  })

  it('草稿态下测试按钮禁着——那时候测的不是眼前这份', async () => {
    arrange()
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    for (const button of screen.getAllByRole('button', { name: '测试连接' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('新建的端点一进来就是草稿态', () => {
    arrange({
      endpoint: { baseUrl: '', apiKey: '', models: [] },
      activeModel: null,
      initialEditing: true,
    })
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
  })
})

describe('模型的增删', () => {
  it('加一个模型即时生效，不经过保存', async () => {
    const { onChange } = arrange()
    await userEvent.type(screen.getByPlaceholderText('加一个模型'), 'glm-4-flash{enter}')
    expect(onChange).toHaveBeenCalledWith({
      ...endpoint, models: [...endpoint.models, 'glm-4-flash'],
    })
  })

  it('重复的模型名不再加一遍', async () => {
    const { onChange } = arrange()
    await userEvent.type(screen.getByPlaceholderText('加一个模型'), 'glm-5.2{enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('移除一个模型', async () => {
    const { onChange } = arrange()
    await userEvent.click(screen.getAllByRole('button', { name: '移除' })[1]!)
    expect(onChange).toHaveBeenCalledWith({ ...endpoint, models: ['glm-5.2'] })
  })
})

describe('checkBaseUrl', () => {
  it('只到 /v1 是对的', () => {
    expect(checkBaseUrl('https://x/v1')).toBeNull()
  })

  it('填成完整端点要拦', () => {
    expect(checkBaseUrl('https://x/v1/chat/completions')).toBe('full')
  })

  it('末尾带斜杠的完整端点同样要拦', () => {
    expect(checkBaseUrl('https://x/v1/chat/completions/')).toBe('full')
  })

  it('空地址要拦', () => {
    expect(checkBaseUrl('   ')).toBe('empty')
  })
})
