<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue'
import { Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-vue-next'
import { BaseButton, BaseIconButton } from '@renderer/components/base'
import Input from '@renderer/components/ui/input/Input.vue'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { confirm } from '@renderer/composables/useConfirmDialog'
import useWorkspaceProjectStore from '@renderer/stores/workspace-project'
import MarkdownEditor from '@renderer/components/markdown/MarkdownEditor.vue'
import StreamingMarkdown from '@renderer/components/markdown/StreamingMarkdown.vue'
import type { MemorySnapshot, MemoryTarget } from './state/memoryPanelMessage'

type MemoryOperation = 'refresh' | 'add' | 'replace' | 'remove'
type Scope = MemoryTarget | 'skills'

defineProps<{ compact?: boolean }>()

const projectStore = useWorkspaceProjectStore()
const selected = ref<Scope>('memory')
const query = ref('')
const draft = ref('')
const isComposerOpen = ref(false)
const editing = ref<string>()
const editingValue = ref('')
const busy = ref(false)
const error = ref('')
const snapshot = ref<MemorySnapshot>()
let projectGeneration = 0
let refreshPending = false

const activeProjectId = computed(() => projectStore.activeProjectId)

watch(activeProjectId, () => {
  projectGeneration += 1
  snapshot.value = undefined
  error.value = ''
  if (busy.value) {
    refreshPending = true
    return
  }
  void refresh()
})

const scopes = computed(() => [
  { id: 'memory' as const, label: '全局记忆', count: snapshot.value?.entries.memory.length ?? 0 },
  { id: 'user' as const, label: '用户记忆', count: snapshot.value?.entries.user.length ?? 0 },
  {
    id: 'project' as const,
    label: snapshot.value?.project ? `项目 · ${snapshot.value.project}` : '项目记忆',
    count: snapshot.value?.entries.project.length ?? 0
  },
  { id: 'failure' as const, label: '经验记录', count: snapshot.value?.entries.failure.length ?? 0 },
  { id: 'skills' as const, label: '技能', count: snapshot.value?.skills.length ?? 0 }
])
const activeScope = computed(() => scopes.value.find((scope) => scope.id === selected.value))
const isEditorDialogOpen = computed(() => isComposerOpen.value || editing.value !== undefined)
const editorDialogTitle = computed(() => (editing.value === undefined ? '新增记忆' : '编辑记忆'))
const editorValue = computed({
  get: () => (editing.value === undefined ? draft.value : editingValue.value),
  set: (value: string) => {
    if (editing.value === undefined) draft.value = value
    else editingValue.value = value
  }
})
const entries = computed(() => {
  if (selected.value === 'skills') return []
  const source = snapshot.value?.entries[selected.value] ?? []
  const needle = query.value.trim().toLocaleLowerCase()
  return needle ? source.filter((entry) => entry.toLocaleLowerCase().includes(needle)) : source
})
const skills = computed(() => {
  const source = snapshot.value?.skills ?? []
  const needle = query.value.trim().toLocaleLowerCase()
  return needle
    ? source.filter((skill) =>
        `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle)
      )
    : source
})

function selectScope(value: unknown): void {
  if (typeof value !== 'string') return
  const scope = scopes.value.find((item) => item.id === value)?.id
  if (scope) selected.value = scope
}

async function runMemoryOperation(
  operation: MemoryOperation,
  input?: { target: MemoryTarget; content?: string; oldText?: string }
): Promise<void> {
  if (busy.value) {
    if (operation === 'refresh') refreshPending = true
    return
  }
  const requestedProjectId = activeProjectId.value
  const requestedProjectGeneration = projectGeneration
  busy.value = true
  error.value = ''
  try {
    const nextSnapshot =
      operation === 'refresh'
        ? await window.api.codingAgent.getHermesMemorySnapshot({ projectId: requestedProjectId })
        : await window.api.codingAgent.mutateHermesMemory({
            projectId: requestedProjectId,
            target: input!.target,
            ...(operation === 'add'
              ? { operation, content: input!.content! }
              : operation === 'replace'
                ? { operation, oldText: input!.oldText!, content: input!.content! }
                : { operation, oldText: input!.oldText! })
          })
    if (requestedProjectGeneration === projectGeneration) {
      snapshot.value = nextSnapshot
    } else {
      refreshPending = true
    }
    if (operation === 'add' || operation === 'replace') closeEditorDialog()
  } catch (cause) {
    if (requestedProjectGeneration === projectGeneration) {
      error.value = cause instanceof Error ? cause.message : '无法读取记忆数据'
    } else {
      refreshPending = true
    }
  } finally {
    busy.value = false
    if (refreshPending) {
      refreshPending = false
      void refresh()
    }
  }
}

async function refresh(): Promise<void> {
  await runMemoryOperation('refresh')
}
function openComposer(): void {
  if (busy.value) return
  draft.value = ''
  isComposerOpen.value = true
}
function closeEditorDialog(): void {
  draft.value = ''
  editing.value = undefined
  editingValue.value = ''
  isComposerOpen.value = false
}
async function submitEditor(): Promise<void> {
  if (editing.value === undefined) await add()
  else await saveEdit()
}
async function add(): Promise<void> {
  if (busy.value || selected.value === 'skills' || !draft.value.trim()) return
  await runMemoryOperation('add', {
    target: selected.value,
    content: draft.value.trim()
  })
}
function beginEdit(entry: string): void {
  if (busy.value) return
  editing.value = entry
  editingValue.value = entry
}
async function saveEdit(): Promise<void> {
  if (busy.value || !editing.value || selected.value === 'skills' || !editingValue.value.trim())
    return
  await runMemoryOperation('replace', {
    target: selected.value,
    oldText: editing.value,
    content: editingValue.value.trim()
  })
}
async function remove(entry: string): Promise<void> {
  if (busy.value || selected.value === 'skills') return
  const result = await confirm({
    title: '删除记忆',
    description: '这条记忆将被永久删除，此操作无法撤销。',
    confirmText: '删除',
    cancelText: '取消',
    tone: 'destructive'
  })
  if (!result.confirmed || busy.value) return
  await runMemoryOperation('remove', {
    target: selected.value,
    oldText: entry
  })
}
onActivated(() => {
  void refresh()
})
</script>

<template>
  <ScrollArea class="memory-settings-scroll">
    <div class="memory-settings-page" :class="{ 'memory-settings-page--compact': compact }">
      <header class="memory-settings-page__header">
        <div>
          <h1>记忆</h1>
          <p>查看和维护智能体使用的长期记忆与技能索引。</p>
        </div>
        <BaseButton
          v-if="selected !== 'skills'"
          size="sm"
          variant="primary"
          :disabled="busy || isComposerOpen"
          @click="openComposer"
        >
          <template #icon><Plus :size="14" /></template>
          新增记忆
        </BaseButton>
      </header>

      <div v-if="error" class="memory-settings-notice" role="alert">
        <span>{{ error }}</span>
        <BaseIconButton label="关闭错误" size="small" @click="error = ''"><X /></BaseIconButton>
      </div>

      <section class="memory-settings-browser" aria-label="记忆管理">
        <div class="memory-settings-toolbar">
          <div class="memory-settings-search">
            <Search :size="14" aria-hidden="true" />
            <Input v-model="query" type="search" aria-label="搜索记忆" placeholder="搜索当前范围" />
          </div>
          <Select :model-value="selected" @update:model-value="selectScope">
            <SelectTrigger class="memory-settings-scope" aria-label="记忆范围">
              <SelectValue
                >{{ activeScope?.label ?? '选择范围' }} · {{ activeScope?.count ?? 0 }}</SelectValue
              >
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="scope in scopes" :key="scope.id" :value="scope.id">
                  <span class="memory-settings-scope-option">
                    <span>{{ scope.label }}</span
                    ><small>{{ scope.count }}</small>
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <BaseIconButton label="刷新记忆" :disabled="busy" @click="refresh">
            <RefreshCw :class="{ spin: busy }" :size="14" />
          </BaseIconButton>
        </div>

        <div v-if="selected !== 'skills'" class="memory-settings-list">
          <article v-for="entry in entries" :key="entry" class="memory-settings-entry">
            <StreamingMarkdown
              class="memory-settings-entry__content"
              :source="entry"
              :revision="0"
              :is-streaming="false"
              :message-id="`settings-memory:${selected}:${entry}`"
            />
            <div class="memory-settings-entry__actions">
              <BaseIconButton
                label="编辑这条记忆"
                size="small"
                :disabled="busy"
                @click="beginEdit(entry)"
              >
                <Pencil :size="14" />
                <span>编辑</span>
              </BaseIconButton>
              <BaseIconButton
                class="is-danger"
                label="永久删除这条记忆"
                size="small"
                :disabled="busy"
                @click="remove(entry)"
              >
                <Trash2 :size="14" />
                <span>删除</span>
              </BaseIconButton>
            </div>
          </article>
          <div v-if="entries.length === 0" class="memory-settings-empty">
            {{ query ? '没有匹配的记忆' : '当前范围暂无记忆' }}
          </div>
        </div>

        <div v-else class="memory-settings-list">
          <article v-for="skill in skills" :key="skill.skillId" class="memory-settings-skill">
            <div>
              <strong>{{ skill.name }}</strong
              ><span>{{ skill.scope === 'global' ? '全局' : '项目' }}</span>
            </div>
            <p>{{ skill.description }}</p>
            <small>{{ skill.updated }}</small>
          </article>
          <div v-if="skills.length === 0" class="memory-settings-empty">
            {{ query ? '没有匹配的技能' : '暂无技能' }}
          </div>
        </div>
      </section>
    </div>
  </ScrollArea>

  <Dialog :open="isEditorDialogOpen" @update:open="(open) => !open && closeEditorDialog()">
    <DialogContent class="memory-editor-dialog">
      <form class="memory-editor-dialog__form" @submit.prevent="submitEditor">
        <DialogHeader class="memory-editor-dialog__header">
          <DialogTitle>{{ editorDialogTitle }}</DialogTitle>
          <DialogDescription
            >{{ activeScope?.label ?? '' }}，内容将以 Markdown 格式保存</DialogDescription
          >
        </DialogHeader>
        <MarkdownEditor
          v-model="editorValue"
          class="memory-editor-dialog__editor"
          autofocus
          :placeholder="`输入${activeScope?.label ?? ''}`"
        />
        <DialogFooter class="memory-editor-dialog__footer">
          <BaseButton type="button" size="sm" variant="ghost" @click="closeEditorDialog"
            >取消</BaseButton
          >
          <BaseButton
            type="submit"
            size="sm"
            variant="primary"
            :disabled="busy || !editorValue.trim()"
            >保存</BaseButton
          >
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<style scoped lang="scss">
.memory-settings-scroll {
  width: 100%;
  height: 100%;
}
.memory-settings-scroll :deep([data-slot='scroll-area-viewport']) {
  height: 100%;
}
.memory-settings-page {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--settings-page-max-width);
  margin: 0 auto;
  padding: 40px 36px 56px;
}
.memory-settings-page--compact {
  max-width: none;
  padding: var(--space-4);
}
.memory-settings-page--compact .memory-settings-page__header {
  align-items: center;
  margin-bottom: var(--space-4);
}
.memory-settings-page--compact .memory-settings-page__header p {
  display: none;
}
.memory-settings-page--compact .memory-settings-toolbar {
  grid-template-columns: minmax(0, 1fr) auto;
}
.memory-settings-page--compact .memory-settings-search,
.memory-settings-page--compact .memory-settings-scope {
  grid-column: 1 / -1;
}
.memory-settings-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: 28px;
}
.memory-settings-page__header h1 {
  margin: 0;
  font-size: var(--font-size-ui-xl);
  font-weight: 600;
  line-height: 1.3;
}
.memory-settings-page__header p {
  max-width: 640px;
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
  line-height: 1.5;
}
.memory-settings-state,
.memory-settings-notice {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.memory-settings-state > div {
  display: grid;
  gap: 2px;
}
.memory-settings-state span {
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-sm);
}
.memory-settings-notice {
  justify-content: space-between;
  color: var(--color-danger);
  border-color: color-mix(in srgb, var(--color-danger) 30%, var(--color-border));
}
.memory-settings-browser {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.memory-settings-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 240px) auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--color-surface-raised);
  border-bottom: 1px solid var(--color-border);
}
.memory-settings-search {
  position: relative;
  min-width: 0;
}
.memory-settings-search > svg {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: var(--space-3);
  color: var(--color-text-subtle);
  transform: translateY(-50%);
  pointer-events: none;
}
.memory-settings-search :deep(input) {
  padding-left: 32px;
}
.memory-settings-scope {
  width: 100%;
}
:global(.memory-settings-scope-option) {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  width: 100%;
}
:global(.memory-settings-scope-option small) {
  color: var(--color-text-subtle);
  font-variant-numeric: tabular-nums;
}
.memory-settings-list {
  display: grid;
  background: var(--color-surface);
}
.memory-settings-entry,
.memory-settings-skill {
  min-width: 0;
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border-muted);
}
.memory-settings-entry:last-child,
.memory-settings-skill:last-child {
  border-bottom: 0;
}
.memory-settings-entry {
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: var(--space-4);
}
.memory-settings-entry__content {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--font-size-ui-sm);
}
.memory-settings-entry__actions {
  display: flex;
  gap: var(--space-1);

  &:deep(.base-icon-button) {
    gap: var(--space-1);
    width: auto;
    padding: 0 var(--space-1);
  }
}
.memory-settings-entry__actions .is-danger {
  color: var(--color-danger);
}
.memory-settings-skill {
  display: grid;
  gap: var(--space-1);
}
.memory-settings-skill > div {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.memory-settings-skill span {
  padding: 1px var(--space-1);
  color: var(--color-text-muted);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-ui-2xs);
}
.memory-settings-skill p {
  margin: 0;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
  font-size: var(--font-size-ui-sm);
  line-height: 1.5;
}
.memory-settings-skill small {
  color: var(--color-text-subtle);
  font-size: var(--font-size-ui-xs);
}
.memory-settings-empty {
  padding: 48px var(--space-4);
  color: var(--color-text-subtle);
  text-align: center;
  font-size: var(--font-size-ui-sm);
}
:global([data-slot='dialog-content'].memory-editor-dialog) {
  width: min(760px, calc(100vw - 40px));
  max-width: 760px;
  height: min(620px, calc(100svh - 40px));
  max-height: calc(100svh - 40px);
  padding: 0;
  gap: 0;
  overflow: hidden;
}
.memory-editor-dialog__form {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
}
.memory-editor-dialog__header {
  padding: var(--space-4) var(--space-5) var(--space-3);
  background: var(--color-surface-raised);
  border-bottom: 1px solid var(--color-border);
}
.memory-editor-dialog__editor {
  width: auto;
  height: auto;
  min-width: 0;
  min-height: 0;
  margin: var(--space-4) var(--space-5);
}
.memory-editor-dialog__editor :deep(.markdown-editor__content) {
  height: 100%;
  min-height: 0;
  max-height: none;
}
.memory-editor-dialog__footer {
  padding: var(--space-3) var(--space-5);
  background: var(--color-surface-raised);
  border-top: 1px solid var(--color-border);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (width <= 680px) {
  .memory-settings-page {
    padding: 28px var(--space-4) 40px;
  }
  .memory-settings-page__header {
    display: grid;
  }
  .memory-settings-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .memory-settings-search {
    grid-column: 1 / -1;
  }
  .memory-settings-entry {
    grid-template-columns: minmax(0, 1fr);
  }
  .memory-settings-entry__actions {
    justify-content: flex-end;
  }
}
</style>
