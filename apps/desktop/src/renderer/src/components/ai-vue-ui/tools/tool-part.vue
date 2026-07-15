<script setup lang="ts">
import { computed, type Component } from 'vue'
import BrowserPageToolPart from './browser-page-tool-part.vue'
import BrowserTabsToolPart from './browser-tabs-tool-part.vue'
import DefaultToolPart from './default-tool-part.vue'
import EditToolPart from './edit-tool-part.vue'
import FindToolPart from './find-tool-part.vue'
import GrepToolPart from './grep-tool-part.vue'
import LsToolPart from './ls-tool-part.vue'
import MemorySearchToolPart from './memory-search-tool-part.vue'
import MemoryToolPart from './memory-tool-part.vue'
import ReadToolPart from './read-tool-part.vue'
import SessionSearchToolPart from './session-search-tool-part.vue'
import SkillManageToolPart from './skill-manage-tool-part.vue'
import WriteToolPart from './write-tool-part.vue'

const props = defineProps<{
  name: string
  args: unknown
  output: unknown
  state?: string
}>()

const component = computed<Component>(() => {
  switch (props.name) {
    case 'read':
      return ReadToolPart
    case 'write':
      return WriteToolPart
    case 'edit':
      return EditToolPart
    case 'grep':
      return GrepToolPart
    case 'find':
      return FindToolPart
    case 'ls':
      return LsToolPart
    case 'browser_tabs':
      return BrowserTabsToolPart
    case 'browser_page':
      return BrowserPageToolPart
    case 'memory':
      return MemoryToolPart
    case 'memory_search':
      return MemorySearchToolPart
    case 'session_search':
      return SessionSearchToolPart
    case 'skill_manage':
      return SkillManageToolPart
    default:
      return DefaultToolPart
  }
})
</script>

<template>
  <component :is="component" :name="name" :args="args" :output="output" :state="state" />
</template>
