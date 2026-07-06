<script setup lang="ts">
import type { Component } from 'vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export interface BaseDropdownMenuItem {
  id: string
  label: string
  shortcut?: string
  icon?: Component
  disabled?: boolean
  danger?: boolean
}

export interface BaseDropdownMenuSection {
  label?: string
  items: BaseDropdownMenuItem[]
}

defineProps<{
  sections: BaseDropdownMenuSection[]
}>()

const emit = defineEmits<{
  select: [item: BaseDropdownMenuItem]
}>()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>

    <DropdownMenuContent class="base-dropdown-menu" align="start">
      <template v-for="(section, sectionIndex) in sections" :key="section.label ?? sectionIndex">
        <div v-if="sectionIndex > 0" aria-hidden="true" class="base-dropdown-menu__gap" />
        <DropdownMenuLabel v-if="section.label" class="base-dropdown-menu__label">
          {{ section.label }}
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem
            v-for="item in section.items"
            :key="item.id"
            :disabled="item.disabled"
            :variant="item.danger ? 'destructive' : 'default'"
            class="base-dropdown-menu__item"
            @select="emit('select', item)"
          >
            <component :is="item.icon" v-if="item.icon" />
            <span class="base-dropdown-menu__item-label">{{ item.label }}</span>
            <DropdownMenuShortcut v-if="item.shortcut">
              {{ item.shortcut }}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style lang="scss" scoped>
.base-dropdown-menu {
  min-width: 176px;
  max-width: 248px;
  padding: 7px;
  border: 1px solid var(--color-border-muted);
  box-shadow: var(--shadow-md);
}

.base-dropdown-menu__gap {
  height: 9px;
  margin: 7px -1px 0;
  border-top: 1px solid var(--color-border-muted);
}

.base-dropdown-menu__label {
  display: flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  margin: 0 0 3px;
  color: var(--color-text-muted);
  font-size: max(12px, var(--font-size-ui-2xs));
  font-weight: 750;
  letter-spacing: 0;
}

.base-dropdown-menu__item {
  min-height: 29px;
  gap: 6px;
  padding: 0 7px;
  font-size: max(12px, var(--font-size-ui-xs));
  line-height: 1;

  svg {
    width: 14px;
    height: 14px;
  }
}

.base-dropdown-menu__item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
