/**
 * deferred-ipc.ts - 让重的 coding-agent IPC 模块在窗口开始加载后再初始化。
 */

import { ipcMain, type WebContents } from 'electron'
import { codingAgentChannels } from '@shared/coding-agent/channels'
import type { CodingThreadManager } from './thread-manager'
import {
  registerLightweightMetadataIpc,
  type LightweightMetadataIpcRegistration
} from './deferred/metadata-ipc'

const subscribers = new Set<WebContents>()
const initialLoadDelayMs = 750
const retryLoadDelayMs = 1000

let eventSubscriptionRegistered = false
let metadataIpcRegistration: LightweightMetadataIpcRegistration | undefined
let managerPromise: Promise<CodingThreadManager> | undefined
let loadTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 注册轻量事件订阅入口，并异步加载完整 coding-agent IPC handlers。
 */
export function registerDeferredCodingAgentIpc(): void {
  registerEventSubscription()
  registerMetadataIpc()
  scheduleCodingAgentIpcLoad(initialLoadDelayMs)
}

function scheduleCodingAgentIpcLoad(delayMs: number): void {
  if (loadTimer || managerPromise) {
    return
  }
  loadTimer = setTimeout(() => {
    loadTimer = undefined
    void loadCodingAgentIpc().catch(() => {
      scheduleCodingAgentIpcLoad(retryLoadDelayMs)
    })
  }, delayMs)
}

function registerEventSubscription(): void {
  if (eventSubscriptionRegistered) {
    return
  }
  eventSubscriptionRegistered = true

  ipcMain.on(codingAgentChannels.event, (event, action: 'subscribe' | 'unsubscribe') => {
    if (action === 'subscribe') {
      subscribers.add(event.sender)
      event.sender.once('destroyed', () => subscribers.delete(event.sender))
      return
    }
    subscribers.delete(event.sender)
  })
}

function registerMetadataIpc(): void {
  metadataIpcRegistration ??= registerLightweightMetadataIpc()
}

function disposeMetadataIpc(): void {
  const registration = metadataIpcRegistration
  metadataIpcRegistration = undefined
  registration?.dispose()
}

function loadCodingAgentIpc(): Promise<CodingThreadManager> {
  managerPromise ??= import('./ipc')
    .then(({ registerCodingAgentIpc }) => {
      disposeMetadataIpc()
      removeCodingAgentInvokeHandlers()
      return registerCodingAgentIpc({
        registerEventHandler: false,
        subscribers
      })
    })
    .catch((error: unknown) => {
      managerPromise = undefined
      disposeMetadataIpc()
      removeCodingAgentInvokeHandlers()
      registerMetadataIpc()
      console.error('Failed to register coding-agent IPC handlers', error)
      throw error
    })
  return managerPromise
}

function removeCodingAgentInvokeHandlers(): void {
  for (const channel of Object.values(codingAgentChannels)) {
    ipcMain.removeHandler(channel)
  }
}

/**
 * 获取已加载的 CodingThreadManager，不触发重型 IPC 初始化。
 */
export function getLoadedCodingAgentManager():
  Promise<CodingThreadManager | undefined> | undefined {
  return managerPromise
}
