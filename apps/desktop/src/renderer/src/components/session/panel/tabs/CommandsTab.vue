<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseButton, BaseContextMenu } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { CommandInfo } from '@shared/coding-agent/types'

const workspaceSession = useWorkspaceSessionStore()
const hasActiveThread = computed(() => Boolean(workspaceSession.activeSessionId))
const commandQuery = ref('')
const commandMenuSections = [
  {
    items: [
      { id: 'run', label: '运行命令' },
      { id: 'copy-name', label: '复制名称' }
    ]
  }
]
const filteredCommands = computed(() => {
  const query = commandQuery.value.trim().toLowerCase()
  if (!query) {
    return workspaceSession.activeCommands
  }
  return workspaceSession.activeCommands.filter((command) =>
    [command.name, command.description, command.source].some((value) =>
      value?.toLowerCase().includes(query)
    )
  )
})

watch(
  () => workspaceSession.activeSessionId,
  (threadId) => {
    if (threadId) {
      void workspaceSession.ensureCommandsLoaded(threadId)
    }
  },
  { immediate: true }
)

function getCommandName(command: CommandInfo): string {
  return command.name
}

function getCommandDescription(command: CommandInfo): string {
  return command.description || command.source
}

async function runCommandMenuAction(actionId: string, command: CommandInfo): Promise<void> {
  switch (actionId) {
    case 'run':
      workspaceSession.runCommand(getCommandName(command))
      break
    case 'copy-name':
      await navigator.clipboard.writeText(`/${getCommandName(command)}`)
      break
  }
}
</script>

<template>
  <section class="session-section" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>Commands</h3>
        <span v-if="workspaceSession.activeCommandsLoaded" class="session-panel-count">
          {{ filteredCommands.length }} / {{ workspaceSession.activeCommands.length }}
        </span>
      </div>
      <BaseButton
        size="sm"
        variant="ghost"
        :disabled="!hasActiveThread"
        @click="workspaceSession.loadCommands()"
      >
        Refresh
      </BaseButton>
    </header>
    <BaseField
      id="session-command-search"
      v-model="commandQuery"
      label="Search commands"
      type="search"
      placeholder="Search commands"
    />
    <div v-if="workspaceSession.activeCommandsLoading" class="session-empty">Loading...</div>
    <div
      v-else-if="
        workspaceSession.activeCommandsLoaded && workspaceSession.activeCommands.length === 0
      "
      class="session-empty"
    >
      No commands
    </div>
    <div v-else-if="filteredCommands.length === 0" class="session-empty">No matching commands</div>
    <div v-else class="command-list">
      <BaseContextMenu
        v-for="command in filteredCommands"
        :key="`${command.source}:${command.name}`"
        :sections="commandMenuSections"
        @select="(item) => runCommandMenuAction(item.id, command)"
      >
        <button
          type="button"
          class="command-item"
          @click="workspaceSession.runCommand(getCommandName(command))"
        >
          <span>/{{ getCommandName(command) }}</span>
          <small>{{ getCommandDescription(command) }}</small>
        </button>
      </BaseContextMenu>
    </div>
  </section>
</template>
