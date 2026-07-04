<script setup lang="ts">
import { computed } from 'vue'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const props = withDefaults(
  defineProps<{
    modelValue?: string | number
    label: string
    description?: string
    error?: string
    type?: 'text' | 'number'
    placeholder?: string
    min?: number
    max?: number
    step?: number
    rows?: number
    multiline?: boolean
  }>(),
  {
    type: 'text',
    rows: 4
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | number): void
}>()

const validationError = computed(() => {
  if (props.error) return props.error
  if (props.type !== 'number') return undefined

  const numericValue = Number(props.modelValue)
  if (Number.isNaN(numericValue)) return '请输入有效数字'
  if (props.min !== undefined && numericValue < props.min) return `不能小于 ${props.min}`
  if (props.max !== undefined && numericValue > props.max) return `不能大于 ${props.max}`
  return undefined
})

function updateValue(value: string | number): void {
  if (props.type !== 'number') {
    emit('update:modelValue', value)
    return
  }

  const nextValue = typeof value === 'number' ? value : Number(value)
  emit('update:modelValue', Number.isNaN(nextValue) ? value : nextValue)
}
</script>

<template>
  <Field class="settings-form-field" :data-invalid="Boolean(validationError)">
    <FieldLabel class="settings-field-label">{{ label }}</FieldLabel>
    <Textarea
      v-if="multiline"
      :model-value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :aria-invalid="Boolean(error)"
      @update:model-value="updateValue"
    />
    <Input
      v-else
      :model-value="modelValue"
      :type="type"
      :min="min"
      :max="max"
      :step="step"
      :placeholder="placeholder"
      :aria-invalid="Boolean(validationError)"
      @update:model-value="updateValue"
    />
    <FieldDescription v-if="description">{{ description }}</FieldDescription>
    <FieldError v-if="validationError">{{ validationError }}</FieldError>
  </Field>
</template>
