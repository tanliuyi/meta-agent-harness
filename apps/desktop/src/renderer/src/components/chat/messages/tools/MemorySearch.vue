<script setup lang="ts">
import { computed } from 'vue'
import { Search } from 'lucide-vue-next'
import BaseTool from './BaseTool.vue'
import {
  getNumberArg,
  getStringArg,
  getToolArgs,
  getToolDetails,
  getToolResultText,
  isToolError,
  truncateSummary,
  type ToolComponentProps
} from './support/tool-message'
import { getMemorySearchPresentation } from './support/memory-search'

const props = defineProps<ToolComponentProps>()
const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const args = computed(() => getToolArgs(props.toolCall))
const details = computed(() => getToolDetails(props.toolCall))
const query = computed(() => truncateSummary(getStringArg(args.value, 'query'), 64))
const isError = computed(
  () => isToolError(props.message, props.toolCall) || details.value.success === false
)
const presentation = computed(() =>
  getMemorySearchPresentation({
    status: props.toolCall?.status,
    isError: isError.value,
    target: getStringArg(args.value, 'target'),
    project: args.value.project
  })
)
const project = computed(() => {
  const value = args.value.project
  if (value === null && presentation.value.target !== 'memory') return '全局'
  return typeof value === 'string' ? truncateSummary(value, 40) : undefined
})
const category = computed(() => getStringArg(args.value, 'category'))
const limit = computed(() => getNumberArg(args.value, 'limit'))
const result = computed(() => getToolResultText(props.message, props.toolCall))
const output = computed(() => getDetailString('output'))
const message = computed(() => getDetailString('message'))
const count = computed(() => {
  const value = details.value.count
  return typeof value === 'number' ? value : undefined
})
const hasStructuredResult = computed(() =>
  Boolean(output.value || message.value || count.value !== undefined)
)

function getDetailString(key: string): string | undefined {
  const value = details.value[key]
  return typeof value === 'string' ? value : undefined
}
</script>

<template>
  <BaseTool
    :name="presentation.name"
    :result="result"
    :status="presentation.status"
    :is-error="isError"
    :content-available="Boolean(result || hasStructuredResult || isError)"
    max-content-height="360px"
    :default-open="props.defaultOpen"
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
    <template #icon>
      <Search :size="14" />
    </template>

    <template #summary>
      <span v-if="query" class="memory-search__query">{{ query }}</span>
      <span v-if="project" class="memory-search__filter">{{ project }}</span>
      <span v-if="presentation.targetLabel" class="memory-search__filter">
        {{ presentation.targetLabel }}
      </span>
      <span v-if="category" class="memory-search__filter">{{ category }}</span>
      <span v-if="limit" class="memory-search__filter">limit={{ limit }}</span>
    </template>

    <template #content>
      <div v-if="hasStructuredResult" class="memory-search__result">
        <p v-if="message" :class="{ 'memory-search__error': isError }">{{ message }}</p>
        <pre v-if="output"><code>{{ output }}</code></pre>
        <p v-else-if="count !== undefined && !message">找到 {{ count }} 条记忆</p>
      </div>
      <div v-else-if="result" class="tool-message__result">
        <pre><code>{{ result }}</code></pre>
      </div>
      <dl v-else-if="isError" class="tool-message__error">
        <dt>error</dt>
      </dl>
    </template>
  </BaseTool>
</template>

<style lang="scss" scoped>
.memory-search__query {
  color: var(--color-info);
}

.memory-search__filter {
  margin-inline-start: var(--space-1);
  color: var(--color-text-subtle);
}

.memory-search__result {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  line-height: 1.5;
  overflow-wrap: anywhere;

  p,
  pre {
    margin: 0;
  }

  pre {
    width: 100%;
    white-space: pre-wrap;
  }
}

.memory-search__error {
  color: var(--color-danger);
}
</style>
