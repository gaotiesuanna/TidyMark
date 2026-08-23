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
  useStore.setState({
    modelTests: {},
    testModel: vi.fn(async () => {}),
    listModels: vi.fn(async () => ['glm-4-flash', 'qwen2.5']),
  })
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

  it('测试连接和移除跟模型名同一行，按钮是图标', () => {
    arrange()
    const radio = screen.getByRole('radio', { name: 'glm-5.2' })
    const test = screen.getAllByRole('button', { name: '测试连接' })[0]!
    const remove = screen.getAllByRole('button', { name: '移除' })[0]!
    const row = test.parentElement!
    expect(row.contains(radio)).toBe(true)
    expect(row.contains(remove)).toBe(true)
    expect(test.querySelector('svg')).toBeTruthy()
    expect(test).toHaveProperty('title', '测试连接')
  })

  it('编辑和删除端点是标题行的图标，可访问名仍是原来的文案', () => {
    arrange()
    const edit = screen.getByRole('button', { name: '编辑' })
    const del = screen.getByRole('button', { name: '删除端点' })
    expect(edit.querySelector('svg')).toBeTruthy()
    expect(del.querySelector('svg')).toBeTruthy()
    expect(edit).toHaveProperty('title', '编辑')
    expect(del).toHaveProperty('title', '删除端点')
  })

  it('折叠态不显示添加模型——那是编辑里的事', () => {
    arrange()
    expect(screen.queryByRole('button', { name: '＋ 添加模型' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: '＋ 添加模型' })).toBeNull()
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

  it('点编辑后原编辑位置变成保存图标，左侧是取消', async () => {
    arrange()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    const save = screen.getByRole('button', { name: '保存' })
    const cancelBtn = screen.getByRole('button', { name: '取消' })
    expect(save.querySelector('svg')).toBeTruthy()
    expect(cancelBtn.querySelector('svg')).toBeTruthy()
    expect(cancelBtn.nextElementSibling).toBe(save)
    expect(screen.getByRole('button', { name: '＋ 添加模型' })).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
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

  it('草稿态下也能测，测的是框里这份地址和 Key', async () => {
    const testModel = vi.fn(async () => {})
    useStore.setState({ testModel })
    arrange()
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    const url = screen.getByDisplayValue('https://opencode.ai/zen/go/v1')
    await userEvent.clear(url)
    await userEvent.type(url, 'https://api.deepseek.com/v1')
    const test = screen.getAllByRole('button', { name: '测试连接' })[0] as HTMLButtonElement
    expect(test.disabled).toBe(false)
    await userEvent.click(test)
    expect(testModel).toHaveBeenCalledWith('https://api.deepseek.com/v1', 'sk-x', 'glm-5.2')
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
  it('点添加模型才出现下拉，选一项就加进去，不经过保存', async () => {
    const { onChange } = arrange()
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    await userEvent.click(screen.getByRole('button', { name: '＋ 添加模型' }))
    await screen.findByRole('option', { name: 'glm-4-flash' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '＋ 添加模型' }), 'glm-4-flash')
    expect(onChange).toHaveBeenCalledWith({
      ...endpoint, models: [...endpoint.models, 'glm-4-flash'],
    })
  })

  it('已经有的模型不出现在下拉里', async () => {
    arrange()
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    await userEvent.click(screen.getByRole('button', { name: '＋ 添加模型' }))
    await screen.findByRole('option', { name: 'glm-4-flash' })
    expect(screen.queryByRole('option', { name: 'glm-5.2' })).toBeNull()
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
