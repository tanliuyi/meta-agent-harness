<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderOpen, Plus, Trash2, Search, CornerDownLeft } from 'lucide-vue-next'
import { BaseIconButton } from '@renderer/components/base'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    label: string
    description?: string
    placeholder?: string
    addLabel?: string
    selectTitle?: string
    pathMode?: 'directory' | 'file' | 'any'
    pathActions?: boolean
    error?: string
  }>(),
  {
    addLabel: '添加',
    pathMode: 'directory'
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const bulkValue = ref('')

const values = computed(() => props.modelValue)

function updateItem(index: number, value: string | number): void {
  const nextValues = [...values.value]
  nextValues[index] = String(value)
  emit('update:modelValue', nextValues)
}

function addItem(value = ''): void {
  emit('update:modelValue', [...values.value, value])
}

function removeItem(index: number): void {
  emit(
    'update:modelValue',
    values.value.filter((_, itemIndex) => itemIndex !== index)
  )
}

function applyBulkValue(): void {
  const nextItems = splitItems(bulkValue.value)
  if (nextItems.length === 0) return
  emit('update:modelValue', normalizeItems([...values.value, ...nextItems]))
  bulkValue.value = ''
}

async function selectPath(index?: number): Promise<void> {
  const selectedPaths = await window.api.codingAgent.selectResourcePath({
    title: props.selectTitle ?? props.label,
    mode: props.pathMode,
    multi: index === undefined,
    defaultPath: typeof index === 'number' ? values.value[index] : undefined
  })
  if (!selectedPaths?.length) return

  if (typeof index === 'number') {
    const nextValues = [...values.value]
    nextValues[index] = selectedPaths[0]
    emit('update:modelValue', normalizeItems(nextValues))
    return
  }

  emit('update:modelValue', normalizeItems([...values.value, ...selectedPaths]))
}

async function revealPath(path: string): Promise<void> {
  await window.api.codingAgent.revealResourcePath({ path })
}

function splitItems(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeItems(items: string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean)
}
</script>

<template>
  <Field :data-invalid="Boolean(error)" class="settings-form-field settings-array-field">
    <div class="settings-array-field__header">
      <div>
        <FieldLabel class="settings-field-label">{{ label }}</FieldLabel>
        <FieldDescription v-if="description">{{ description }}</FieldDescription>
      </div>
      <div class="settings-array-field__actions">
        <Button v-if="pathActions" type="button" variant="outline" size="sm" @click="selectPath()">
          <FolderOpen data-icon="inline-start" />
          选择
        </Button>
        <Button type="button" variant="outline" size="sm" @click="addItem()">
          <Plus data-icon="inline-start" />
          {{ addLabel }}
        </Button>
      </div>
    </div>

    <div class="settings-array-field__list">
      <div v-for="(item, index) in values" :key="index" class="settings-array-field__item">
        <Input
          :model-value="item"
          :placeholder="placeholder"
          :aria-invalid="Boolean(error)"
          @update:model-value="updateItem(index, $event)"
          @blur="emit('update:modelValue', normalizeItems(values))"
        />
        <BaseIconButton
          v-if="pathActions"
          label="选择路径"
          size="medium"
          :disabled="!item"
          @click="selectPath(index)"
        >
          <FolderOpen :size="16" />
        </BaseIconButton>
        <BaseIconButton
          v-if="pathActions"
          label="打开位置"
          size="medium"
          :disabled="!item"
          @click="revealPath(item)"
        >
          <Search :size="16" />
        </BaseIconButton>
        <BaseIconButton label="删除" size="medium" @click="removeItem(index)">
          <Trash2 :size="16" />
        </BaseIconButton>
      </div>
    </div>

    <div class="settings-array-field__bulk">
      <Textarea
        v-model="bulkValue"
        rows="3"
        :placeholder="placeholder"
        @keydown.meta.enter.prevent="applyBulkValue"
        @keydown.ctrl.enter.prevent="applyBulkValue"
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        :disabled="!bulkValue.trim()"
        @click="applyBulkValue"
      >
        <CornerDownLeft data-icon="inline-start" />
        批量加入
      </Button>
    </div>

    <FieldError v-if="error">{{ error }}</FieldError>
  </Field>
</template>

<style lang="scss" scoped>
.settings-array-field {
  min-width: 0;
}

.settings-array-field__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 0;
}

.settings-array-field__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
}

.settings-array-field__list,
.settings-array-field__bulk {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

.settings-array-field__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
}

.settings-array-field__bulk {
  padding: var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
</style>
