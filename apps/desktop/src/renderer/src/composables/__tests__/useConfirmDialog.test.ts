import { describe, expect, it } from 'vitest'
import { confirm, useConfirmDialog } from '../useConfirmDialog'

describe('useConfirmDialog', () => {
  it('queues parallel calls without dropping dialogs', async () => {
    const dialog = useConfirmDialog()

    dialog.rejectAllDialogs()

    const first = confirm({ id: 'first', title: '第一个' })
    const second = confirm({ id: 'second', title: '第二个', tone: 'destructive' })
    const third = confirm({ id: 'third', title: '第三个' })

    expect(dialog.queueLength.value).toBe(3)
    expect(dialog.activeDialog.value?.title).toBe('第一个')

    dialog.confirmActiveDialog()
    await expect(first).resolves.toEqual({ action: 'confirm', confirmed: true, id: 'first' })
    expect(dialog.activeDialog.value?.title).toBe('第二个')

    dialog.cancelActiveDialog()
    await expect(second).resolves.toEqual({ confirmed: false, id: 'second' })
    expect(dialog.activeDialog.value?.title).toBe('第三个')

    dialog.confirmActiveDialog()
    await expect(third).resolves.toEqual({ action: 'confirm', confirmed: true, id: 'third' })
    expect(dialog.queueLength.value).toBe(0)
    expect(dialog.activeDialog.value).toBeUndefined()
  })

  it('preserves custom actions and resolves the selected action value', async () => {
    const dialog = useConfirmDialog()

    dialog.rejectAllDialogs()

    const result = confirm({
      actions: [{ label: '归档', value: 'archive' }],
      id: 'archive-thread',
      title: '归档这个会话？'
    })

    expect(dialog.activeDialog.value?.actions).toEqual([{ label: '归档', value: 'archive' }])

    dialog.resolveActiveDialog(true, 'archive')

    await expect(result).resolves.toEqual({
      action: 'archive',
      confirmed: true,
      id: 'archive-thread'
    })
  })
})
