<script setup lang="ts">
import { Field, FieldContent, FieldDescription, FieldTitle } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'

defineProps<{
  modelValue: boolean
  title: string
  description?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()
</script>

<template>
  <Field orientation="horizontal" class="settings-switch-field">
    <Switch :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" />
    <FieldContent>
      <FieldTitle>{{ title }}</FieldTitle>
      <FieldDescription v-if="description">{{ description }}</FieldDescription>
    </FieldContent>
  </Field>
</template>
