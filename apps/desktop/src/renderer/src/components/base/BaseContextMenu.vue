<script setup lang="ts">
import type { Component } from 'vue'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
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

    <ContextMenuContent
      class="min-w-36 max-w-56 rounded-md border-0 p-1.5 shadow-[0_6px_18px_rgba(15,23,42,0.12)]"
    >
      <template v-for="(section, sectionIndex) in sections" :key="section.label ?? sectionIndex">
        <div v-if="sectionIndex > 0" aria-hidden="true" class="h-0.5" />
        <ContextMenuLabel v-if="section.label" class="px-1.5 py-0.5 text-xs text-muted-foreground">
          {{ section.label }}
        </ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem
            v-for="item in section.items"
            :key="item.id"
            :disabled="item.disabled"
            :variant="item.danger ? 'destructive' : 'default'"
            class="h-[27px] gap-1.5 rounded px-1.5 py-0 text-[13px] leading-none data-[disabled]:text-muted-foreground data-[disabled]:opacity-75 [&_svg:not([class*='size-'])]:size-3.5"
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
