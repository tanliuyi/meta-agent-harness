<script setup lang="ts">
import type { Component } from 'vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

export interface BaseContextMenuItem {
  id: string
  label: string
  shortcut?: string
  icon?: Component
  disabled?: boolean
  danger?: boolean
}

export interface BaseContextMenuSection {
  label?: string
  items: BaseContextMenuItem[]
}

defineProps<{
  sections: BaseContextMenuSection[]
}>()

const emit = defineEmits<{
  select: [item: BaseContextMenuItem]
}>()
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>

    <ContextMenuContent class="min-w-48">
      <template v-for="(section, sectionIndex) in sections" :key="section.label ?? sectionIndex">
        <ContextMenuSeparator v-if="sectionIndex > 0" />
        <ContextMenuLabel v-if="section.label" class="text-muted-foreground text-xs">
          {{ section.label }}
        </ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem
            v-for="item in section.items"
            :key="item.id"
            :disabled="item.disabled"
            :variant="item.danger ? 'destructive' : 'default'"
            @select="emit('select', item)"
          >
            <component :is="item.icon" v-if="item.icon" />
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <ContextMenuShortcut v-if="item.shortcut">
              {{ item.shortcut }}
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </template>
    </ContextMenuContent>
  </ContextMenu>
</template>
