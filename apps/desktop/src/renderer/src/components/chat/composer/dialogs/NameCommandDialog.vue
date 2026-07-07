<script setup lang="ts">
/**
 * NameCommandDialog.vue - Composer /name 命令的会话命名弹窗。
 */

import { BaseButton } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'

const props = defineProps<{
  open: boolean
  modelValue: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:modelValue': [value: string]
  submit: []
}>()

function closeDialog(): void {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="composer-command-dialog">
      <form class="composer-command-dialog__form" @submit.prevent="emit('submit')">
        <DialogHeader>
          <DialogTitle>设置会话名称</DialogTitle>
          <DialogDescription>为当前 Pi session 设置一个显示名称。</DialogDescription>
        </DialogHeader>

        <BaseField
          id="composer-command-name"
          :model-value="modelValue"
          label="会话名称"
          placeholder="例如：资源接入排查"
          hint="/name 需要提供会话名称"
          @update:model-value="emit('update:modelValue', $event)"
        />

        <DialogFooter>
          <BaseButton type="button" size="sm" variant="ghost" @click="closeDialog">
            取消
          </BaseButton>
          <BaseButton type="submit" size="sm" variant="primary" :disabled="!modelValue.trim()">
            保存
          </BaseButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<style lang="scss" scoped>
.composer-command-dialog__form {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}
</style>
