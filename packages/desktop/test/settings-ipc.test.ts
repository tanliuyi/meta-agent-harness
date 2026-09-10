import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerIpc } from "../src/main/ipc.ts";
import { CHANNELS } from "../src/shared/channels.ts";
import { createIpcTestDependencies } from "./ipc-test-dependencies.ts";

const electron = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  showOpenDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: () => undefined,
    getAllWindows: () => [],
  },
  dialog: { showOpenDialog: electron.showOpenDialog },
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => electron.handles.set(channel, listener),
    on: (channel: string, listener: (...args: unknown[]) => unknown) => electron.listeners.set(channel, listener),
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

describe("settings IPC", () => {
  const settings = {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
  };
  const mainAgents = {
    getSnapshot: vi.fn(),
    getCatalog: vi.fn(),
    mutate: vi.fn(),
  };

  beforeEach(() => {
    electron.handles.clear();
    electron.listeners.clear();
    vi.clearAllMocks();
    registerIpc(
      createIpcTestDependencies({
        projects: { list: vi.fn(), getActive: vi.fn() } as never,
        settings: settings as never,
        mainAgents: mainAgents as never,
        dirtyGuard: { requestClose: vi.fn(), setDirty: vi.fn(), remove: vi.fn() } as never,
        runtime: { shell: { getStatus: vi.fn(), install: vi.fn(), use: vi.fn(), onProgress: vi.fn() } },
      }),
    );
  });

  test("映射 settings 配置读写处理器", async () => {
    const snapshot = {
      revision: "one",
      settings: {
        showThinking: true,
        autoExpandRunning: true,
        showAvatars: true,
        messageWidth: 810,
        userName: "用户",
        userAvatarPath: null,
      },
    };
    const input = {
      expectedRevision: "one",
      settings: {
        showThinking: false,
        autoExpandRunning: false,
        showAvatars: false,
        messageWidth: 810,
        userName: "Tan",
        userAvatarPath: "/Users/tan/avatar.png",
      },
    };
    settings.getConfig.mockResolvedValue(snapshot);
    settings.saveConfig.mockResolvedValue({ status: "saved", snapshot });

    await expect(electron.handles.get(CHANNELS.settingsGetConfig)?.({})).resolves.toBe(snapshot);
    await expect(electron.handles.get(CHANNELS.settingsSaveConfig)?.({}, input)).resolves.toEqual({
      status: "saved",
      snapshot,
    });
    expect(settings.saveConfig).toHaveBeenCalledWith(input);
  });

  test("映射智能体快照、元数据目录和 CAS 修改处理器", async () => {
    const snapshot = { revision: "agents" };
    const catalog = { tools: [], builtinPlugins: [] };
    const input = { action: "set-default", expectedRevision: "agents", id: "reader" };
    mainAgents.getSnapshot.mockResolvedValue(snapshot);
    mainAgents.getCatalog.mockReturnValue(catalog);
    mainAgents.mutate.mockResolvedValue({ status: "saved", snapshot });

    await expect(electron.handles.get(CHANNELS.mainAgentsGetSnapshot)?.({})).resolves.toBe(snapshot);
    expect(electron.handles.get(CHANNELS.mainAgentsGetCatalog)?.({})).toBe(catalog);
    await expect(electron.handles.get(CHANNELS.mainAgentsMutate)?.({}, input)).resolves.toEqual({
      status: "saved",
      snapshot,
    });
    expect(mainAgents.mutate).toHaveBeenCalledWith(input);
  });

  test("选择头像只返回外部图片路径", async () => {
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/Users/tan/avatar.webp"] });

    await expect(electron.handles.get(CHANNELS.settingsChooseUserAvatar)?.({ sender: {} })).resolves.toBe(
      "/Users/tan/avatar.webp",
    );
    expect(electron.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ["openFile"],
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
      }),
    );
  });
});
