<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { useSelectContentWidth } from '@/components/ui/select/composables/useSelectContentWidth'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    description?: string
    disabled?: boolean
    placeholder?: string
    options: Array<{ label: string; value: string }>
    virtual?: boolean
    virtualThreshold?: number
  }>(),
  {
    virtual: true,
    virtualThreshold: 0
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
}>()

type ScrollAreaInstance = {
  getViewport: () => HTMLElement | undefined
}

const virtualScrollRef = ref<ScrollAreaInstance | null>(null)
const shouldVirtualize = computed(
  () => props.virtual && props.options.length >= props.virtualThreshold
)
const optionLabels = computed(() => props.options.map((option) => option.label))
const selectContentWidth = useSelectContentWidth({
  labels: optionLabels
})
const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.options.length,
    getScrollElement: () => virtualScrollRef.value?.getViewport() ?? null,
    estimateSize: () => 36,
    overscan: 8
  }))
)
const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const virtualTotalSize = computed(() => virtualizer.value.getTotalSize())
const selectedOptionLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label
)

function measureVirtualItem(refValue: Element | ComponentPublicInstance | null): void {
  const element = refValue instanceof Element ? refValue : refValue?.$el
  if (element instanceof Element) {
    virtualizer.value.measureElement(element)
  }
}
</script>

<template>
  <Field class="settings-form-field">
    <FieldLabel class="settings-field-label">{{ label }}</FieldLabel>
    <Select
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event as string)"
    >
      <SelectTrigger
        :ref="selectContentWidth.setTriggerRef"
        class="settings-select-field__trigger"
        :disabled="disabled"
      >
        <SelectValue v-if="selectedOptionLabel" :placeholder="placeholder">
          {{ selectedOptionLabel }}
        </SelectValue>
        <SelectValue v-else :placeholder="placeholder" />
      </SelectTrigger>
      <SelectContent
        class="settings-select-field__content"
        :content-style="selectContentWidth.contentStyle.value"
      >
        <ScrollArea
          v-if="shouldVirtualize"
          ref="virtualScrollRef"
          class="settings-select-field__virtual-scroll"
        >
          <SelectGroup
            class="settings-select-field__virtual-size"
            :style="{ height: `${virtualTotalSize}px` }"
          >
            <SelectItem
              v-for="virtualItem in virtualItems"
              :key="props.options[virtualItem.index]?.value"
              :ref="measureVirtualItem"
              :data-index="virtualItem.index"
              class="settings-select-field__virtual-item"
              :style="{ transform: `translateY(${virtualItem.start}px)` }"
              :value="props.options[virtualItem.index]?.value"
            >
              {{ props.options[virtualItem.index]?.label }}
            </SelectItem>
          </SelectGroup>
        </ScrollArea>
        <SelectGroup v-else>
          <SelectItem v-for="option in props.options" :key="option.value" :value="option.value">
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

.settings-select-field__content,
.settings-select-field__virtual-scroll {
  min-width: var(--reka-select-trigger-width, 12rem);
  max-width: calc(100vw - 32px);
}

.settings-select-field__virtual-scroll {
  width: 100%;
  max-height: min(320px, var(--reka-select-content-available-height, 320px));
}

.settings-select-field__virtual-scroll :deep([data-slot='scroll-area-viewport']) {
  max-height: inherit;
}

.settings-select-field__virtual-size {
  position: relative;
  width: 100%;
}

.settings-select-field__virtual-item {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
</style>
