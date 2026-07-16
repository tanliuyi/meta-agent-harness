import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "../shared/channels.ts";
import type { SessionAttachment, SessionPush, SessionPushPayload, TerminalEvent } from "../shared/contracts.ts";
import type { DesktopApi } from "../shared/desktop-api.ts";

interface ActiveSessionAttachment {
  attachmentId: string;
  listener(update: SessionPushPayload): void;
  buffered: SessionPush[];
  ready: boolean;
}

interface PendingSessionAttachment {
  listener(update: SessionPushPayload): void;
  buffered: SessionPush[];
}

let sessionGeneration = 0;
let activeSessionAttachment: ActiveSessionAttachment | undefined;
let pendingSessionAttachment: PendingSessionAttachment | undefined;
ipcRenderer.on(CHANNELS.sessionsPush, (_event, update: SessionPush) => {
  if (activeSessionAttachment?.attachmentId === update.attachmentId) {
    if (!activeSessionAttachment.ready) {
      activeSessionAttachment.buffered.push(update);
      return;
    }
    const { attachmentId: _attachmentId, ...payload } = update;
    activeSessionAttachment.listener(payload);
    return;
  }
  pendingSessionAttachment?.buffered.push(update);
});

const desktopApi: DesktopApi = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  projects: {
    list: () => ipcRenderer.invoke(CHANNELS.projectsList),
    choose: () => ipcRenderer.invoke(CHANNELS.projectsChoose),
    open: (projectId) => ipcRenderer.invoke(CHANNELS.projectsOpen, projectId),
    remove: (projectId) => ipcRenderer.invoke(CHANNELS.projectsRemove, projectId),
    getActive: () => ipcRenderer.invoke(CHANNELS.projectsActive),
  },
  sessions: {
    list: (projectId, includeArchived) => ipcRenderer.invoke(CHANNELS.sessionsList, projectId, includeArchived),
    getDraftConfig: (projectId) => ipcRenderer.invoke(CHANNELS.sessionsDraftConfig, projectId),
    create: (input) => ipcRenderer.invoke(CHANNELS.sessionsCreate, input),
    async attach(projectId, threadId, listener) {
      const generation = ++sessionGeneration;
      const previous = activeSessionAttachment;
      const pending: PendingSessionAttachment = { listener, buffered: [] };
      pendingSessionAttachment = pending;
      try {
        const attachment: SessionAttachment = await ipcRenderer.invoke(CHANNELS.sessionsAttach, projectId, threadId);
        if (generation !== sessionGeneration || pendingSessionAttachment !== pending) {
          ipcRenderer.send(CHANNELS.sessionsDetach, attachment.attachmentId);
          throw new DOMException("Session attach superseded", "AbortError");
        }
        pendingSessionAttachment = undefined;
        activeSessionAttachment = {
          attachmentId: attachment.attachmentId,
          listener,
          buffered: pending.buffered.filter((update) => update.attachmentId === attachment.attachmentId),
          ready: false,
        };
        return attachment.bootstrap;
      } catch (error) {
        if (generation === sessionGeneration && pendingSessionAttachment === pending) {
          pendingSessionAttachment = undefined;
          activeSessionAttachment = previous;
        }
        throw error;
      }
    },
    flush() {
      const current = activeSessionAttachment;
      if (!current || current.ready) return;
      current.ready = true;
      const buffered = current.buffered;
      current.buffered = [];
      for (const update of buffered) {
        const { attachmentId: _attachmentId, ...payload } = update;
        current.listener(payload);
      }
    },
    detach() {
      sessionGeneration += 1;
      pendingSessionAttachment = undefined;
      const current = activeSessionAttachment;
      activeSessionAttachment = undefined;
      ipcRenderer.send(CHANNELS.sessionsDetach, current?.attachmentId);
    },
    rename: (projectId, threadId, title) => ipcRenderer.invoke(CHANNELS.sessionsRename, projectId, threadId, title),
    archive: (projectId, threadId, archived) =>
      ipcRenderer.invoke(CHANNELS.sessionsArchive, projectId, threadId, archived),
    remove: (projectId, threadId) => ipcRenderer.invoke(CHANNELS.sessionsRemove, projectId, threadId),
    run: (input) => ipcRenderer.invoke(CHANNELS.sessionsRun, input),
    enqueue: (input) => ipcRenderer.invoke(CHANNELS.sessionsEnqueue, input),
    cancel: (projectId, threadId) => ipcRenderer.invoke(CHANNELS.sessionsCancel, projectId, threadId),
    clearQueue: (projectId, threadId) => ipcRenderer.invoke(CHANNELS.sessionsClearQueue, projectId, threadId),
    compact: (projectId, threadId) => ipcRenderer.invoke(CHANNELS.sessionsCompact, projectId, threadId),
    setModel: (projectId, threadId, provider, modelId) =>
      ipcRenderer.invoke(CHANNELS.sessionsSetModel, projectId, threadId, provider, modelId),
    setThinking: (projectId, threadId, level) =>
      ipcRenderer.invoke(CHANNELS.sessionsSetThinking, projectId, threadId, level),
    respond: (projectId, threadId, response) =>
      ipcRenderer.invoke(CHANNELS.sessionsRespond, projectId, threadId, response),
  },
  files: {
    list: (projectId, path, query) => ipcRenderer.invoke(CHANNELS.filesList, projectId, path, query),
    read: (projectId, path) => ipcRenderer.invoke(CHANNELS.filesRead, projectId, path),
  },
  terminals: {
    open: (projectId, threadId, terminalId, cols, rows) =>
      ipcRenderer.invoke(CHANNELS.terminalsOpen, projectId, threadId, terminalId, cols, rows),
    write: (projectId, threadId, terminalId, data) =>
      ipcRenderer.invoke(CHANNELS.terminalsWrite, projectId, threadId, terminalId, data),
    resize: (projectId, threadId, terminalId, cols, rows) =>
      ipcRenderer.invoke(CHANNELS.terminalsResize, projectId, threadId, terminalId, cols, rows),
    restart: (projectId, threadId, terminalId, cols, rows) =>
      ipcRenderer.invoke(CHANNELS.terminalsRestart, projectId, threadId, terminalId, cols, rows),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, terminalEvent: TerminalEvent) => listener(terminalEvent);
      ipcRenderer.on(CHANNELS.terminalsEvent, handler);
      return () => ipcRenderer.removeListener(CHANNELS.terminalsEvent, handler);
    },
  },
  workbench: {
    get: (projectId, threadId) => ipcRenderer.invoke(CHANNELS.workbenchGet, projectId, threadId),
    update: (state) => ipcRenderer.invoke(CHANNELS.workbenchUpdate, state),
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
