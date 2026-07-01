<script setup lang="ts">
import PlusIcon from '@renderer/components/icons/PlusIcon.vue'
</script>

<template>
  <aside class="workspace__sidebar">
    <div class="sidebar-section">
      <div class="sidebar-section__header">
        <span>项目</span>
        <PlusIcon />
      </div>

      <div class="project-group">
        <div class="project-group__header">
          <span>项目1</span>
          <PlusIcon />
        </div>
        <ul class="session-group">
          <li class="session-group__item">
            <span>会话1</span>
          </li>
          <li class="session-group__item">
            <span>会话2</span>
          </li>
        </ul>
      </div>

      <div class="project-group">
        <div class="project-group__header">
          <span>项目2</span>
          <PlusIcon />
        </div>
        <ul class="session-group">
          <li class="session-group__item">
            <span>会话1</span>
          </li>
          <li class="session-group__item">
            <span>会话2</span>
          </li>
        </ul>
      </div>
    </div>
  </aside>
</template>

<style lang="scss" scoped>
.workspace {
  &__sidebar {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: var(--space-3) var(--space-2) var(--space-3) var(--space-3);
    overflow: hidden;
    color: var(--color-text);
    background:
      linear-gradient(180deg, rgb(255 255 255 / 4%), transparent 72px), var(--color-sidebar);
    border-right: 1px solid rgb(255 255 255 / 4%);
    backdrop-filter: blur(16px);

    &::before {
      position: absolute;
      inset: 0 0 auto;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgb(255 255 255 / 14%), transparent);
      content: '';
      pointer-events: none;
    }
  }
}

.sidebar-section {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding-right: var(--space-1);
  overflow-y: auto;
  scrollbar-color: var(--color-border-strong) transparent;
  scrollbar-width: thin;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border: 2px solid transparent;
    border-radius: 999px;
    background-clip: content-box;
  }

  &::-webkit-scrollbar-thumb:hover {
    background-color: var(--color-border-strong);
  }
}

.sidebar-section__header,
.project-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :deep(svg) {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
  }
}

.sidebar-section__header {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 var(--space-1) var(--space-2);
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);

  span {
    font-size: 12px;
    font-weight: 750;
  }

  :deep(svg) {
    display: grid;
    place-items: center;
    box-sizing: content-box;
    width: 15px;
    height: 15px;
    padding: 4px;
    color: var(--color-text-muted);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard);

    &:hover {
      color: var(--color-primary-strong);
      background: rgb(105 210 160 / 10%);
      border-color: rgb(105 210 160 / 24%);
    }
  }
}

.project-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.project-group__header {
  min-height: 28px;
  padding: 0 var(--space-1) 0 var(--space-2);
  color: var(--color-text-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  span {
    font-size: 11px;
    font-weight: 700;
  }

  :deep(svg) {
    width: 14px;
    height: 14px;
    opacity: 0;
    transform: translateX(2px);
    transition:
      opacity var(--duration-fast) var(--ease-standard),
      transform var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard);
  }

  &:hover {
    color: var(--color-text);
    background: rgb(255 255 255 / 4%);
    border-color: var(--color-border);

    :deep(svg) {
      color: var(--color-primary);
      opacity: 1;
      transform: translateX(0);
    }
  }
}

.session-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 0 0 0 var(--space-2);
  list-style: none;
}

.session-group__item {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 28px;
  padding: 0 var(--space-2) 0 var(--space-4);
  color: var(--color-text-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-standard),
    background var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard);

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 520;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-raised);
    border-color: var(--color-border);

    &::before {
      background: var(--color-primary);
      opacity: 1;
      transform: scale(1.15);
    }
  }
}

@media (width <= 820px) {
  .workspace {
    &__sidebar {
      padding: var(--space-2);
    }
  }
}
</style>
