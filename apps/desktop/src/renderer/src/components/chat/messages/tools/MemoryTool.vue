<script setup lang="ts">
import { computed } from 'vue'
import { BrainCircuit } from 'lucide-vue-next'
import BaseTool from './BaseTool.vue'
import {
  getStringArg,
  getToolArgs,
  getToolDetails,
  getToolResultText,
  getToolStatusLabel,
  isToolError,
  truncateSummary,
  type ToolComponentProps
} from './support/tool-message'

const props = defineProps<ToolComponentProps>()
const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

type MemoryAction = 'add' | 'replace' | 'remove'
type MemoryTarget = 'memory' | 'user' | 'project' | 'failure'

const actionLabels: Record<MemoryAction, string> = {
  add: '添加',
  replace: '更新',
  remove: '移除'
}
const targetLabels: Record<MemoryTarget, string> = {
  memory: '全局记忆',
  user: '用户偏好',
  project: '项目记忆',
  failure: '经验记录'
}

const args = computed(() => getToolArgs(props.toolCall))
const details = computed(() => getToolDetails(props.toolCall))
const action = computed(() => asMemoryAction(getStringArg(args.value, 'action')))
const target = computed(() => asMemoryTarget(getStringArg(args.value, 'target')))
const category = computed(() => getStringArg(args.value, 'category'))
const inputText = computed(() => {
  const value =
    action.value === 'remove'
      ? getStringArg(args.value, 'old_text')
      : getStringArg(args.value, 'content')
  return truncateSummary(value, 64)
})
const result = computed(() => getToolResultText(props.message, props.toolCall))
const resultMessage = computed(() => getDetailString('message'))
const resultError = computed(() => getDetailString('error'))
const warnings = computed(() => {
  const value = details.value.warnings
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  const warning = getDetailString('warning')
  return warning ? [warning] : []
})
const evictedEntries = computed(() => {
  const value = details.value.evicted_entries
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
})
const hasStructuredResult = computed(() =>
  Boolean(
    resultMessage.value || resultError.value || warnings.value.length || evictedEntries.value.length
  )
)
const isError = computed(
  () => isToolError(props.message, props.toolCall) || details.value.success === false
)
const status = computed(() => props.toolCall?.status)
const name = computed(() => {
  const verb = action.value ? actionLabels[action.value] : '管理'
  return getToolStatusLabel(status.value, {
    queued: `正在${verb}记忆`,
    running: `正在${verb}记忆`,
    succeeded: `已${verb}记忆`,
    failed: `${verb}记忆失败`,
    cancelled: `取消${verb}记忆`
  })
})

function getDetailString(key: string): string | undefined {
  const value = details.value[key]
  return typeof value === 'string' ? value : undefined
}

function asMemoryAction(value: string | undefined): MemoryAction | undefined {
  return value === 'add' || value === 'replace' || value === 'remove' ? value : undefined
}

function asMemoryTarget(value: string | undefined): MemoryTarget | undefined {
  return value === 'memory' || value === 'user' || value === 'project' || value === 'failure'
    ? value
    : undefined
}
</script>

<template>
  <BaseTool
    :name="name"
    :result="result"
    :status="status"
    :is-error="isError"
    :content-available="Boolean(result || hasStructuredResult || isError)"
    :default-open="props.defaultOpen"
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
    <template #icon>
      <BrainCircuit :size="14" />
    </template>

    <template #summary>
      <span v-if="target" class="memory-tool__target">{{ targetLabels[target] }}</span>
      <span v-if="category" class="memory-tool__category">{{ category }}</span>
      <span v-if="inputText" class="memory-tool__input">{{ inputText }}</span>
    </template>

    <template #content>
      <div v-if="hasStructuredResult" class="memory-tool__result">
        <p v-if="resultMessage">{{ resultMessage }}</p>
        <p v-if="resultError" class="memory-tool__error">{{ resultError }}</p>
        <template v-if="warnings.length">
          <p class="memory-tool__label">警告</p>
          <ul>
            <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
          </ul>
        </template>
        <template v-if="evictedEntries.length">
          <p class="memory-tool__label">已轮换的记忆</p>
          <ul>
            <li v-for="entry in evictedEntries" :key="entry">{{ entry }}</li>
          </ul>
        </template>
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
.memory-tool__target {
  color: var(--color-info);
}

.memory-tool__category,
.memory-tool__input {
  margin-inline-start: var(--space-1);
  color: var(--color-text-subtle);
}

.memory-tool__result {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  p,
  ul {
    margin: 0;
  }

  ul {
    padding-inline-start: var(--space-5);
  }
}

.memory-tool__label {
  color: var(--color-text-muted);
  font-weight: 500;
}

.memory-tool__error {
  color: var(--color-danger);
}
</style>
