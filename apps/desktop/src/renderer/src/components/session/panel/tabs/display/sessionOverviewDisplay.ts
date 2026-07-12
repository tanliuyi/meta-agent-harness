import type { BaseDropdownMenuSection } from '@renderer/components/base/BaseDropdownMenu.vue'
import type { ThreadSnapshot } from '@shared/coding-agent/types'
import {
  ArrowLeft,
  Copy,
  Download,
  FolderOpen,
  GitFork,
  MapPin,
  Minimize2,
  Plus,
  RefreshCw,
  Upload
} from 'lucide-vue-next'
import { getFileName } from '../../shared/utils'

export function getSessionLineageLabel(
  lineage: ThreadSnapshot['lineage'] | undefined
): string | undefined {
  if (!lineage) {
    return undefined
  }
  if (lineage.unavailable) {
    return 'Fork source unavailable'
  }
  if (lineage.parentThreadTitle) {
    return lineage.parentThreadArchivedAt
      ? `${lineage.parentThreadTitle} (archived)`
      : lineage.parentThreadTitle
  }
  if (lineage.parentSessionFile) {
    return lineage.parentSessionMissing
      ? 'Fork source missing'
      : getFileName(lineage.parentSessionFile)
  }
  return undefined
}

export function getSessionModelLabel(model: ThreadSnapshot['model'] | undefined): string {
  if (!model) {
    return '-'
  }
  return model.displayName || `${model.provider}/${model.id}`
}

export interface SessionActionMenuState {
  hasActiveThread: boolean
  hasCurrentEntry: boolean
  hasPreviousSession: boolean
  hasPreviousLeaf: boolean
  canOpenParentSession: boolean
}

export function createSessionActionMenuSections(
  state: SessionActionMenuState
): BaseDropdownMenuSection[] {
  return [
    {
      label: '文件',
      items: [
        { id: 'export', label: '导出', icon: Download, disabled: !state.hasActiveThread },
        { id: 'import', label: '导入', icon: Upload, disabled: !state.hasActiveThread },
        { id: 'switch', label: '切换文件', icon: FolderOpen, disabled: !state.hasActiveThread }
      ]
    },
    {
      label: '会话',
      items: [
        { id: 'new', label: '新建会话', icon: Plus, disabled: !state.hasActiveThread },
        { id: 'clone', label: '克隆会话', icon: Copy, disabled: !state.hasActiveThread },
        {
          id: 'fork',
          label: '创建分支',
          icon: GitFork,
          disabled: !state.hasActiveThread || !state.hasCurrentEntry
        }
      ]
    },
    {
      label: '命令',
      items: [
        {
          id: 'reload',
          label: '重载资源 /reload',
          icon: RefreshCw,
          disabled: !state.hasActiveThread
        },
        { id: 'compact', label: '压缩上下文', icon: Minimize2, disabled: !state.hasActiveThread }
      ]
    },
    {
      label: '导航',
      items: [
        {
          id: 'previous-session',
          label: '切回上个会话',
          icon: ArrowLeft,
          disabled: !state.hasPreviousSession
        },
        {
          id: 'open-parent',
          label: '打开来源会话',
          icon: FolderOpen,
          disabled: !state.canOpenParentSession
        },
        {
          id: 'previous-leaf',
          label: '返回之前位置',
          icon: MapPin,
          disabled: !state.hasPreviousLeaf
        }
      ]
    }
  ]
}

export function formatRetryDelay(delayMs: number): string {
  if (delayMs < 1000) {
    return `${delayMs}ms`
  }
  return `${Math.round(delayMs / 1000)}s`
}
