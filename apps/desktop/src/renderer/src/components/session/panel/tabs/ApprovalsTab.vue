<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseButton } from '@renderer/components/base'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import ScrollArea from '@renderer/components/ui/scroll-area/ScrollArea.vue'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import type { ApprovalRequest, ApprovalResponse } from '@shared/coding-agent/types'
import {
  getApprovalRiskLabel,
  getApprovalScopeLabel,
  type ApprovalScope
} from './display/approvalDisplay'

const workspaceSession = useWorkspaceSessionStore()
const approvalScopeDrafts = ref<Record<string, ApprovalScope>>({})
const activeApprovalId = ref<string>()
const isApprovalDialogOpen = ref(false)
const submittingApprovalId = ref<string>()
const approvalError = ref<string>()

const pendingApprovals = computed(() => Object.values(workspaceSession.activePendingApprovals))
const hasPendingApprovals = computed(() => pendingApprovals.value.length > 0)
const activeApproval = computed(() =>
  pendingApprovals.value.find((approval) => approval.approvalId === activeApprovalId.value)
)

function getApprovalScope(approval: ApprovalRequest): ApprovalScope {
  return approvalScopeDrafts.value[approval.approvalId] ?? approval.scope
}

function setApprovalScope(approval: ApprovalRequest, scope: ApprovalScope): void {
  approvalScopeDrafts.value = {
    ...approvalScopeDrafts.value,
    [approval.approvalId]: scope
  }
}

async function respondApproval(
  approval: ApprovalRequest,
  input: Pick<ApprovalResponse, 'allow' | 'choice' | 'reason'>
): Promise<void> {
  if (submittingApprovalId.value === approval.approvalId) return
  const scope = getApprovalScope(approval)
  submittingApprovalId.value = approval.approvalId
  approvalError.value = undefined
  try {
    await workspaceSession.respondApproval(approval, { ...input, scope })
    closeApprovalDialog()
    const next = { ...approvalScopeDrafts.value }
    delete next[approval.approvalId]
    approvalScopeDrafts.value = next
  } catch (error) {
    approvalError.value = error instanceof Error ? error.message : String(error)
  } finally {
    submittingApprovalId.value = undefined
  }
}

function openApprovalDialog(approval: ApprovalRequest): void {
  activeApprovalId.value = approval.approvalId
  approvalError.value = undefined
  isApprovalDialogOpen.value = true
}

function closeApprovalDialog(): void {
  isApprovalDialogOpen.value = false
  activeApprovalId.value = undefined
}

watch([activeApproval, submittingApprovalId], ([approval]) => {
  if (isApprovalDialogOpen.value && !approval && !submittingApprovalId.value) {
    closeApprovalDialog()
  }
})

function handleApprovalDialogOpenChange(open: boolean): void {
  if (open) {
    isApprovalDialogOpen.value = true
    return
  }
  closeApprovalDialog()
}
</script>

<template>
  <section class="session-section session-section--scrollable" role="tabpanel">
    <header class="session-section__header">
      <div class="session-section__title">
        <h3>Approvals</h3>
        <span v-if="pendingApprovals.length" class="session-panel-count">
          {{ pendingApprovals.length }}
        </span>
      </div>
    </header>
    <ScrollArea class="session-section__content-scroll" :vertical-size="7">
      <div class="session-section__content">
        <div v-if="!hasPendingApprovals" class="session-empty">No approvals</div>
        <article
          v-for="approval in pendingApprovals"
          :key="approval.approvalId"
          class="approval-row"
        >
          <div>
            <strong>{{ approval.action }}</strong>
            <span>{{ approval.subject }}</span>
          </div>
          <span class="approval-risk" :class="`is-${approval.risk}`">
            {{ getApprovalRiskLabel(approval.risk) }}
          </span>
          <BaseButton size="sm" variant="secondary" @click="openApprovalDialog(approval)">
            Review
          </BaseButton>
        </article>
      </div>
    </ScrollArea>

    <Dialog :open="isApprovalDialogOpen" @update:open="handleApprovalDialogOpenChange">
      <DialogContent class="approval-dialog">
        <template v-if="activeApproval">
          <DialogHeader>
            <DialogTitle>{{ activeApproval.action }}</DialogTitle>
            <DialogDescription>{{ activeApproval.subject }}</DialogDescription>
          </DialogHeader>

          <div class="approval-dialog__scope" role="group" aria-label="审批作用域">
            <button
              v-for="scope in ['once', 'thread', 'workspace'] as const"
              :key="scope"
              type="button"
              :class="{ 'is-active': getApprovalScope(activeApproval) === scope }"
              :disabled="submittingApprovalId === activeApproval.approvalId"
              @click="setApprovalScope(activeApproval, scope)"
            >
              {{ getApprovalScopeLabel(scope) }}
            </button>
          </div>

          <div v-if="activeApproval.choices?.length" class="approval-dialog__choices">
            <BaseButton
              v-for="choice in activeApproval.choices"
              :key="choice"
              size="sm"
              variant="secondary"
              :disabled="submittingApprovalId === activeApproval.approvalId"
              @click="respondApproval(activeApproval, { allow: true, choice })"
            >
              {{ choice }}
            </BaseButton>
          </div>

          <p v-if="approvalError" class="session-error" role="alert">{{ approvalError }}</p>

          <DialogFooter>
            <BaseButton
              type="button"
              size="sm"
              variant="ghost"
              :disabled="submittingApprovalId === activeApproval.approvalId"
              @click="closeApprovalDialog"
            >
              Cancel
            </BaseButton>
            <BaseButton
              type="button"
              size="sm"
              variant="danger"
              :disabled="submittingApprovalId === activeApproval.approvalId"
              @click="respondApproval(activeApproval, { allow: false })"
            >
              Deny
            </BaseButton>
            <BaseButton
              type="button"
              size="sm"
              variant="primary"
              :disabled="submittingApprovalId === activeApproval.approvalId"
              @click="respondApproval(activeApproval, { allow: true })"
            >
              Allow
            </BaseButton>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>
  </section>
</template>
