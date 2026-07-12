import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(file: string): string {
  return readFileSync(join(__dirname, '..', file), 'utf8')
}

describe('工具折叠渲染', () => {
  it('工具组的 slot 由 CollapsibleContent 使用 Reka 默认懒挂载', () => {
    const component = source('BaseToolGroup.vue')
    const collapsibleContent = component.match(
      /<CollapsibleContent\b[\s\S]*?<\/CollapsibleContent>/
    )?.[0]

    expect(component).not.toContain('unmount-on-hide')
    expect(collapsibleContent).toContain('<slot :open="open" />')
  })

  it.each([
    ['BaseTool.vue', 'tool-message-content'],
    ['BaseToolGroup.vue', 'tool-group-content']
  ])('%s 的进入和退出使用不同 animation-name', (file, animationName) => {
    const component = source(file)

    expect(component).toContain(`animation: ${animationName}-open`)
    expect(component).toContain(`animation: ${animationName}-close`)
    expect(component).toContain(`@keyframes ${animationName}-open`)
    expect(component).toContain(`@keyframes ${animationName}-close`)
  })
})
