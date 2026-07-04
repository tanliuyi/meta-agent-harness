<script setup lang="ts">
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

defineProps<{
  modelValue: string
  label: string
  description?: string
  disabled?: boolean
  placeholder?: string
  options: Array<{ label: string; value: string }>
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()
</script>

<template>
  <Field class="settings-form-field">
    <FieldLabel class="settings-field-label">{{ label }}</FieldLabel>
    <Select
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event as string)"
    >
      <SelectTrigger class="settings-select-field__trigger" :disabled="disabled">
        <SelectValue :placeholder="placeholder" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem v-for="option in options" :key="option.value" :value="option.value">
            {{ option.label }}
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <FieldDescription v-if="description">{{ description }}</FieldDescription>
  </Field>
</template>

<style lang="scss" scoped>
.settings-select-field__trigger {
  width: 100%;
}
</style>
