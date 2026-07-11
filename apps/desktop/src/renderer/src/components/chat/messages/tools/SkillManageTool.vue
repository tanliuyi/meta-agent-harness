<script setup lang="ts">
import { computed } from 'vue'
import { BookOpenCheck } from 'lucide-vue-next'
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

type SkillAction = 'create' | 'view' | 'patch' | 'update' | 'edit' | 'delete'
type SkillScope = 'global' | 'project'

interface SkillSummary {
  skillId?: string
  name?: string
  displayName?: string
  description?: string
  scope?: SkillScope
  projectName?: string
}

const actionLabels: Record<SkillAction, string> = {
  create: '创建',
  view: '查看',
  patch: '修补',
  update: '更新',
  edit: '编辑',
  delete: '删除'
}
const scopeLabels: Record<SkillScope, string> = {
  global: '全局',
  project: '项目'
}

const args = computed(() => getToolArgs(props.toolCall))
const details = computed(() => getToolDetails(props.toolCall))
const action = computed(() => asSkillAction(getStringArg(args.value, 'action')))
const scope = computed(() => asSkillScope(getStringArg(args.value, 'scope')))
const skillId = computed(() => getStringArg(args.value, 'skill_id') ?? getDetailString('skillId'))
const skillName = computed(() => getStringArg(args.value, 'name') ?? getDetailString('name'))
const section = computed(() => getStringArg(args.value, 'section'))
const description = computed(() => getDetailString('description'))
const body = computed(() => getDetailString('body'))
const message = computed(() => getDetailString('message'))
const error = computed(() => getDetailString('error'))
const path = computed(() => getDetailString('path'))
const conflictType = computed(() => getDetailString('conflictType'))
const similarSkillIds = computed(() => getStringList(details.value.similarSkillIds))
const skills = computed(() => {
  const value = details.value.skills
  if (!Array.isArray(value)) return []
  return value.filter(isSkillSummary)
})
const inputSummary = computed(() => {
  if (skillId.value) return truncateSummary(skillId.value, 56)
  if (skillName.value) return truncateSummary(skillName.value, 56)
  return action.value === 'view' ? '全部技能' : undefined
})
const result = computed(() => getToolResultText(props.message, props.toolCall))
const hasStructuredResult = computed(() =>
  Boolean(
    message.value ||
    error.value ||
    description.value ||
    body.value ||
    path.value ||
    conflictType.value ||
    similarSkillIds.value.length ||
    skills.value.length
  )
)
const isError = computed(
  () => isToolError(props.message, props.toolCall) || details.value.success === false
)
const status = computed(() => props.toolCall?.status)
const name = computed(() => {
  const verb = action.value ? actionLabels[action.value] : '管理'
  return getToolStatusLabel(status.value, {
    queued: `正在${verb}技能`,
    running: `正在${verb}技能`,
    succeeded: `已${verb}技能`,
    failed: `${verb}技能失败`,
    cancelled: `取消${verb}技能`
  })
})

function getDetailString(key: string): string | undefined {
  const value = details.value[key]
  return typeof value === 'string' ? value : undefined
}

function getStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function isSkillSummary(value: unknown): value is SkillSummary {
  return typeof value === 'object' && value !== null
}

function asSkillAction(value: string | undefined): SkillAction | undefined {
  return value === 'create' ||
    value === 'view' ||
    value === 'patch' ||
    value === 'update' ||
    value === 'edit' ||
    value === 'delete'
    ? value
    : undefined
}

function asSkillScope(value: string | undefined): SkillScope | undefined {
  return value === 'global' || value === 'project' ? value : undefined
}
</script>

<template>
  <BaseTool
    :name="name"
    :result="result"
    :status="status"
    :is-error="isError"
    :content-available="Boolean(result || hasStructuredResult || isError)"
    max-content-height="360px"
    :default-open="props.defaultOpen"
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
    <template #icon>
      <BookOpenCheck :size="14" />
    </template>

    <template #summary>
      <span v-if="scope" class="skill-manage-tool__scope">{{ scopeLabels[scope] }}</span>
      <span v-if="inputSummary" class="skill-manage-tool__id">{{ inputSummary }}</span>
      <span v-if="section" class="skill-manage-tool__section">{{ section }}</span>
    </template>

    <template #content>
      <div v-if="hasStructuredResult" class="skill-manage-tool__result">
        <p v-if="message">{{ message }}</p>
        <p v-if="error" class="skill-manage-tool__error">{{ error }}</p>
        <p v-if="description" class="skill-manage-tool__description">{{ description }}</p>

        <div v-if="skills.length" class="skill-manage-tool__skills">
          <article v-for="skill in skills" :key="skill.skillId ?? skill.name">
            <div class="skill-manage-tool__skill-heading">
              <strong>{{ skill.displayName ?? skill.name ?? skill.skillId }}</strong>
              <span v-if="skill.scope">{{ scopeLabels[skill.scope] }}</span>
            </div>
            <code v-if="skill.skillId">{{ skill.skillId }}</code>
            <p v-if="skill.description">{{ skill.description }}</p>
          </article>
        </div>

        <template v-if="body">
          <p class="skill-manage-tool__label">技能内容</p>
          <pre><code>{{ body }}</code></pre>
        </template>

        <dl v-if="path || conflictType || similarSkillIds.length" class="skill-manage-tool__meta">
          <template v-if="path">
            <dt>路径</dt>
            <dd>
              <code>{{ path }}</code>
            </dd>
          </template>
          <template v-if="conflictType">
            <dt>冲突</dt>
            <dd>{{ conflictType }}</dd>
          </template>
          <template v-if="similarSkillIds.length">
            <dt>相似技能</dt>
            <dd>{{ similarSkillIds.join('、') }}</dd>
          </template>
        </dl>
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
.skill-manage-tool__scope {
  color: var(--color-info);
}

.skill-manage-tool__id,
.skill-manage-tool__section {
  margin-inline-start: var(--space-1);
  color: var(--color-text-subtle);
}

.skill-manage-tool__result {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  color: var(--color-text);
  font-size: var(--font-size-ui-sm);
  line-height: 1.5;
  overflow-wrap: anywhere;

  p,
  pre,
  dl {
    margin: 0;
  }

  pre {
    white-space: pre-wrap;
  }
}

.skill-manage-tool__error {
  color: var(--color-danger);
}

.skill-manage-tool__description,
.skill-manage-tool__label,
.skill-manage-tool__skill-heading span {
  color: var(--color-text-muted);
}

.skill-manage-tool__label {
  font-weight: 500;
}

.skill-manage-tool__skills {
  display: grid;
  gap: var(--space-2);

  article {
    display: grid;
    gap: var(--space-1);
    padding-block: var(--space-1);
    border-bottom: 1px solid var(--color-border-subtle, var(--color-border));
  }
}

.skill-manage-tool__skill-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.skill-manage-tool__meta {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-1) var(--space-2);

  dt {
    color: var(--color-text-muted);
  }

  dd {
    min-width: 0;
    margin: 0;
  }
}
</style>
