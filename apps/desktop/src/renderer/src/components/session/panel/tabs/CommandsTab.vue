<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseButton, BaseContextMenu } from '@renderer/components/base'
import BaseField from '@renderer/components/base/BaseField.vue'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
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
const runningCommandKey = ref<string>()
const commandError = ref<string>()
const runnableCommands = computed(() => filterCommands(workspaceSession.activeCommands, ''))
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
      await runCommand(command)
      break
    case 'copy-name':
      await navigator.clipboard.writeText(getCommandClipboardText(command))
      break
  }
}

async function runCommand(command: CommandInfo): Promise<void> {
  const key = getCommandKey(command)
  if (runningCommandKey.value) return
  const commandName = getCommandName(command)
  runningCommandKey.value = key
  commandError.value = undefined
  try {
    await workspaceSession.runCommand(
      commandName,
      getCommandQueryArgs(commandQuery.value, commandName)
    )
  } catch (error) {
    commandError.value = error instanceof Error ? error.message : String(error)
  } finally {
    runningCommandKey.value = undefined
  }
}

async function refreshCommands(): Promise<void> {
  if (workspaceSession.activeCommandsLoading) return
  commandError.value = undefined
  try {
    await workspaceSession.loadCommands()
  } catch (error) {
    commandError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <section class="session-section session-section--scrollable" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>命令</h3>
        <span v-if="workspaceSession.activeCommandsLoaded" class="session-panel-count">
          {{ filteredCommands.length }} / {{ runnableCommands.length }}
        </span>
      </div>
      <BaseButton
        size="sm"
        variant="ghost"
        :disabled="
          !hasActiveThread || workspaceSession.activeCommandsLoading || Boolean(runningCommandKey)
        "
        @click="refreshCommands"
      >
        刷新
      </BaseButton>
    </header>
    <ScrollArea class="session-section__content-scroll" :vertical-size="7">
      <div class="session-section__content">
        <BaseField
          id="session-command-search"
          v-model="commandQuery"
          label="搜索命令"
          type="search"
          placeholder="搜索命令，或输入 /command args"
        />
        <div v-if="commandError" class="session-error" role="alert">{{ commandError }}</div>
        <div v-if="workspaceSession.activeCommandsLoading" class="session-empty">Loading...</div>
        <div
          v-else-if="workspaceSession.activeCommandsLoaded && runnableCommands.length === 0"
          class="session-empty"
        >
          No commands
        </div>
        <div v-else-if="filteredCommands.length === 0" class="session-empty">
          No matching commands
        </div>
        <div v-else class="command-list">
          <BaseContextMenu
            v-for="command in filteredCommands"
            :key="getCommandKey(command)"
            :sections="commandMenuSections"
            @select="(item) => runCommandMenuAction(item.id, command)"
          >
            <button
              type="button"
              class="command-item"
              :disabled="Boolean(runningCommandKey)"
              @click="runCommand(command)"
            >
              <span>/{{ getCommandName(command) }}</span>
              <small>{{ getCommandDescription(command) }}</small>
            </button>
          </BaseContextMenu>
        </div>
      </div>
    </ScrollArea>
  </section>
</template>
