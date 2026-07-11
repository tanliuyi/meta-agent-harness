<script setup lang="ts">
import { computed } from 'vue'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'

const props = withDefaults(
  defineProps<{
    modelValue: number
    label: string
    description?: string
    error?: string
    min: number
    max: number
    step?: number
  }>(),
  {
    step: 1
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: number): void
}>()

const sliderValue = computed({
  get: () => [Number(props.modelValue) || props.min],
  set: (value: number[] | undefined) => {
    emit('update:modelValue', value?.[0] ?? props.min)
  }
})

function updateInputValue(value: string | number): void {
  const nextValue = typeof value === 'number' ? value : Number(value)
  emit('update:modelValue', Number.isNaN(nextValue) ? props.min : nextValue)
}
</script>

<template>
  <Field class="settings-form-field" :data-invalid="Boolean(error)">
    <FieldLabel class="settings-field-label">{{ label }}</FieldLabel>
    <div class="settings-slider-field__control">
      <Slider
        v-model="sliderValue"
        class="settings-slider-field__slider"
        :min="min"
        :max="max"
        :step="step"
        :aria-invalid="Boolean(error)"
      />
      <Input
        class="settings-slider-field__input"
        type="number"
        :model-value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        :aria-invalid="Boolean(error)"
        @update:model-value="updateInputValue"
      />
    </div>
    <FieldDescription v-if="description">{{ description }}</FieldDescription>
    <FieldError v-if="error">{{ error }}</FieldError>
  </Field>
</template>
