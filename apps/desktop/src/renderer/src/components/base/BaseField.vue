<script setup lang="ts">
/**
 * BaseField.vue - 基础表单字段组件。
 *
 * 提供带标签、占位符和提示文本的输入框。
 */

withDefaults(
  defineProps<{
    /** 输入框 ID。 */
    id: string
    /** 字段标签。 */
    label: string
    /** 输入框当前值。 */
    modelValue?: string
    /** 占位符文本。 */
    placeholder?: string
    /** 提示文本。 */
    hint?: string
    /** 输入框原生类型。 */
    type?: 'text' | 'search' | 'email' | 'password'
  }>(),
  {
    modelValue: '',
    placeholder: '',
    hint: '',
    type: 'text'
  }
)

/** 更新 modelValue 事件。 */
defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <label class="base-field" :for="id">
    <span class="base-field__label">{{ label }}</span>
    <input
      :id="id"
      class="base-field__control"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span v-if="hint" class="base-field__hint">{{ hint }}</span>
  </label>
</template>

<style lang="scss" scoped>
.base-field {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.base-field__label {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 650;
}

.base-field__control {
  width: 100%;
  min-height: 28px;
  padding: 0 var(--space-2);
  color: var(--color-text);
  background: var(--color-field);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-standard),
    box-shadow var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard);

  &::placeholder {
    color: var(--color-text-subtle);
  }

  &:hover {
    border-color: var(--color-border-strong);
  }

  &:focus {
    background: var(--color-field-focus);
    border-color: var(--color-primary);
    box-shadow: var(--shadow-focus);
  }
}

.base-field__hint {
  color: var(--color-text-subtle);
  font-size: 11px;
}
</style>
