<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseButton, BaseContextMenu } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { CommandInfo } from '@shared/coding-agent/types'
import {
  commandMenuSections,
  filterCommands,
  getCommandClipboardText,
  getCommandQueryArgs,
  getCommandDescription,
  getCommandKey,
  getCommandName
} from './display/commandDisplay'

const workspaceSession = useWorkspaceSessionStore()
const hasActiveThread = computed(() => Boolean(workspaceSession.activeSessionId))
const commandQuery = ref('')
const filteredCommands = computed(() =>
  filterCommands(workspaceSession.activeCommands, commandQuery.value)
)

watch(
  () => workspaceSession.activeSessionId,
  (threadId) => {
    if (threadId) {
      void workspaceSession.ensureCommandsLoaded(threadId)
    }
  },
  { immediate: true }
)

async function runCommandMenuAction(actionId: string, command: CommandInfo): Promise<void> {
  switch (actionId) {
    case 'run':
      runCommand(command)
      break
    case 'copy-name':
      await navigator.clipboard.writeText(getCommandClipboardText(command))
      break
  }
}

function runCommand(command: CommandInfo): void {
  const commandName = getCommandName(command)
  workspaceSession.runCommand(commandName, getCommandQueryArgs(commandQuery.value, commandName))
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
      placeholder="Search commands or type /command args"
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
        :key="getCommandKey(command)"
        :sections="commandMenuSections"
        @select="(item) => runCommandMenuAction(item.id, command)"
      >
        <button type="button" class="command-item" @click="runCommand(command)">
          <span>/{{ getCommandName(command) }}</span>
          <small>{{ getCommandDescription(command) }}</small>
        </button>
      </BaseContextMenu>
    </div>
  </section>
</template>
