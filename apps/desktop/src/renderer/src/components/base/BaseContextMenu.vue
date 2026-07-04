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

    <ContextMenuContent class="base-context-menu">
      <template v-for="(section, sectionIndex) in sections" :key="section.label ?? sectionIndex">
        <div v-if="sectionIndex > 0" aria-hidden="true" class="base-context-menu__gap" />
        <ContextMenuLabel v-if="section.label" class="base-context-menu__label">
          {{ section.label }}
        </ContextMenuLabel>
        <ContextMenuGroup>
          <ContextMenuItem
            v-for="item in section.items"
            :key="item.id"
            :disabled="item.disabled"
            :variant="item.danger ? 'destructive' : 'default'"
            class="base-context-menu__item"
            @select="emit('select', item)"
          >
            <component :is="item.icon" v-if="item.icon" />
            <span class="base-context-menu__item-label">{{ item.label }}</span>
            <ContextMenuShortcut v-if="item.shortcut">
              {{ item.shortcut }}
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </template>
    </ContextMenuContent>
  </ContextMenu>
</template>

<style lang="scss" scoped>
.base-context-menu {
  min-width: 144px;
  max-width: 224px;
  padding: 6px;
  border: 0;
  box-shadow: var(--shadow-md);
}

.base-context-menu__gap {
  height: 2px;
}

.base-context-menu__label {
  padding: 2px 6px;
  color: var(--color-text-muted);
  font-size: var(--font-size-ui-xs);
}

.base-context-menu__item {
  min-height: 27px;
  gap: 6px;
  padding: 0 6px;
  font-size: var(--font-size-ui-sm);
  line-height: 1;

  svg {
    width: 14px;
    height: 14px;
  }
}

.base-context-menu__item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
