import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(file: string): string {
  return readFileSync(join(__dirname, '..', file), 'utf8')
}

describe('AG-UI timeline components', () => {
  it('工具组关闭时不挂载工具详情', () => {
    const component = source('tools/tool-group-part.vue')
    expect(component).toContain('v-if="open" class="chat-tool-group__list"')
  })

  it('工具组与历史入口保持旧链路的紧凑视觉结构', () => {
    const toolGroup = source('tools/tool-group-part.vue')
    const history = source('collapsed-history-part.vue')

    expect(toolGroup).toContain('width: fit-content;')
    expect(toolGroup).toContain('border-radius: 999px;')
    expect(toolGroup).toContain('opacity: 0;')
    expect(history).toContain('height: 28px;')
    expect(history).toContain('border-bottom: 1px solid')
  })

  it('Composer 使用旧链路的编辑区与图标操作栏结构', () => {
    const input = source('chat-input.vue')

    expect(input).toContain('<textarea')
    expect(input).toContain('class="chat-input__actions"')
    expect(input).toContain('class="chat-input__controls"')
    expect(input).toContain('@update:model-value="handleProjectChange"')
    expect(input).toContain('@update:model-value="handleModelChange"')
    expect(input).toContain('@update:model-value="handleThinkingLevelChange"')
    expect(input).toContain('<SendHorizontal')
    expect(input).toContain('border-top: 1px solid var(--color-border-muted)')
    expect(input).not.toContain('Type a message...')
  })

  it('用户向上滚动时退出底部跟随', () => {
    const messages = source('chat-messages.vue')

    expect(messages).toContain('@wheel.passive="handleWheel"')
    expect(messages).toContain('if (event.deltaY < 0) holdUserScroll()')
    expect(messages).toContain('else if (!isApplyingFollow)')
  })

  it('虚拟列表高度变化后保持自动追底', () => {
    const messages = source('chat-messages.vue')

    expect(messages).toContain('ref="listRef"')
    expect(messages).toContain('useResizeObserver(listRef, scrollToBottom)')
    expect(messages).toContain("virtualizer.value.scrollToEnd({ behavior: 'auto' })")
  })

  it('同一 assistant 处理流使用紧凑语义间距', () => {
    const messages = source('chat-messages.vue')

    expect(messages).toContain("return 'chat-messages__item--flow-spacing'")
    expect(messages).toContain("return 'chat-messages__item--history-spacing'")
    expect(messages).toContain('padding-bottom: 8px;')
    expect(messages).toContain('padding-bottom: 16px;')
  })

  it('虚拟器的 key getter 捕获对应 displayItems 快照', () => {
    const messages = source('chat-messages.vue')

    expect(messages).toContain('get getItemKey()')
    expect(messages).toContain('const items = displayItems.value')
    expect(messages).toContain('items[index]!.key')
    expect(messages).not.toContain('getItemKey(index)')
  })
})
