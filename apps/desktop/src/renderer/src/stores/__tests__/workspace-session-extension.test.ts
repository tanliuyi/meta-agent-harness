import { describe, expect, it } from 'vitest'
import type { ExtensionDialogRequest } from '@shared/coding-agent/types'
import {
  createExtensionDialogCancellation,
  createExtensionDialogResponse,
  enqueueExtensionDialog,
  isComposerEditorRequest,
  removeExtensionDialog
} from '../workspace-session-extension'

const inputRequest: ExtensionDialogRequest = {
  type: 'input',
  id: 'input-a',
  title: 'Name',
  placeholder: 'Project name'
}

describe('workspace session extension dialogs', () => {
  it('按到达顺序排队，并原位更新相同 ID', () => {
    const confirmRequest: ExtensionDialogRequest = {
      type: 'confirm',
      id: 'confirm-b',
      title: 'Continue',
      message: 'Continue?'
    }

    let queue = enqueueExtensionDialog([], inputRequest)
    queue = enqueueExtensionDialog(queue, confirmRequest)
    queue = enqueueExtensionDialog(queue, { ...inputRequest, placeholder: 'Updated name' })

    expect(queue.map((request) => request.id)).toEqual(['input-a', 'confirm-b'])
    expect(queue[0]).toMatchObject({ placeholder: 'Updated name' })
    expect(removeExtensionDialog(queue, 'input-a')).toEqual([confirmRequest])
  })

  it('仅将 editor request 映射为 Composer 模式', () => {
    const editorRequest: ExtensionDialogRequest = {
      type: 'editor',
      id: 'editor-mode',
      title: '编辑配置',
      prefill: 'Draft'
    }
    expect(isComposerEditorRequest(editorRequest)).toBe(true)
    expect(isComposerEditorRequest(inputRequest)).toBe(false)
  })

  it('为四类对话框创建类型正确的响应', () => {
    const confirmRequest: ExtensionDialogRequest = {
      type: 'confirm',
      id: 'confirm-a',
      title: 'Continue',
      message: 'Continue?'
    }
    const selectRequest: ExtensionDialogRequest = {
      type: 'select',
      id: 'select-a',
      title: 'Mode',
      options: ['Fast', 'Safe']
    }
    const editorRequest: ExtensionDialogRequest = {
      type: 'editor',
      id: 'editor-a',
      title: 'Prompt',
      prefill: 'Draft'
    }

    expect(createExtensionDialogResponse(confirmRequest, true)).toEqual({
      id: 'confirm-a',
      confirmed: true
    })
    expect(createExtensionDialogResponse(selectRequest, 'Safe')).toEqual({
      id: 'select-a',
      value: 'Safe'
    })
    expect(createExtensionDialogResponse(inputRequest, 'Meta Agent')).toEqual({
      id: 'input-a',
      value: 'Meta Agent'
    })
    expect(createExtensionDialogResponse(editorRequest, 'Updated')).toEqual({
      id: 'editor-a',
      value: 'Updated'
    })
    expect(createExtensionDialogResponse(inputRequest, true)).toBeUndefined()
    expect(createExtensionDialogCancellation(editorRequest)).toEqual({
      id: 'editor-a',
      cancelled: true
    })
  })
})
