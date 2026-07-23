import type { AppUpdater, UpdateCheckResult, UpdateInfo } from "electron-updater";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AutoUpdateService, getDefaultUpdateSources, type UpdateSource } from "../src/main/updater.ts";

vi.mock("electron-updater", () => ({ default: { autoUpdater: {} } }));

interface FakeUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  channel: string | null;
  setFeedURL: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

const sources: UpdateSource[] = [
  { id: "one", label: "source-one", feed: "https://one.example/updates/" },
  { id: "two", label: "source-two", feed: "https://two.example/updates/" },
  {
    id: "github",
    label: "GitHub Releases",
    feed: { provider: "github", owner: "owner", repo: "repo" },
  },
];

function update(version = "1.2.0", releaseNotes: UpdateInfo["releaseNotes"] = "<p>Fixed one</p>") {
  return {
    isUpdateAvailable: true,
    updateInfo: {
      version,
      files: [],
      path: "installer.exe",
      sha512: "hash",
      releaseNotes,
    },
    versionInfo: {
      version,
      files: [],
      path: "installer.exe",
      sha512: "hash",
      releaseNotes,
    },
    downloadPromise: null,
  } as UpdateCheckResult;
}

function fakeUpdater(): FakeUpdater {
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    channel: null,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  };
}

function service(updater: FakeUpdater): AutoUpdateService {
  return new AutoUpdateService({
    app: { isPackaged: true, getVersion: () => "1.0.0" },
    updater: updater as unknown as AppUpdater,
    sources,
    log: { info: vi.fn(), error: vi.fn() },
  });
}

describe("AutoUpdateService", () => {
  beforeEach(() => vi.clearAllMocks());

  test("检测失败时按配置顺序 fallback", async () => {
    const updater = fakeUpdater();
    updater.checkForUpdates.mockRejectedValueOnce(new Error("mirror unavailable")).mockResolvedValueOnce(update());
    const updates = service(updater);

    await updates.check();

    expect(updater.setFeedURL).toHaveBeenNthCalledWith(1, sources[0].feed);
    expect(updater.setFeedURL).toHaveBeenNthCalledWith(2, sources[1].feed);
    expect(updates.getState()).toMatchObject({
      status: "available",
      availableVersion: "1.2.0",
      releaseNotes: "Fixed one",
      source: "source-two",
    });
  });

  test("下载失败时从下一渠道重新确认同一版本后继续", async () => {
    const updater = fakeUpdater();
    updater.checkForUpdates.mockResolvedValueOnce(update()).mockResolvedValueOnce(update());
    updater.downloadUpdate
      .mockRejectedValueOnce(new Error("asset unavailable"))
      .mockResolvedValueOnce(["installer.exe"]);
    const updates = service(updater);

    await updates.check();
    await updates.download();

    expect(updater.setFeedURL).toHaveBeenNthCalledWith(1, sources[0].feed);
    expect(updater.setFeedURL).toHaveBeenNthCalledWith(2, sources[1].feed);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(updates.getState()).toMatchObject({
      status: "ready",
      availableVersion: "1.2.0",
      percent: 100,
      source: "source-two",
    });
  });

  test("fallback 渠道版本不一致时不会下载错误产物", async () => {
    const updater = fakeUpdater();
    updater.checkForUpdates.mockResolvedValueOnce(update("1.2.0")).mockResolvedValueOnce(update("1.3.0"));
    updater.downloadUpdate.mockRejectedValueOnce(new Error("asset unavailable"));
    const updates = new AutoUpdateService({
      app: { isPackaged: true, getVersion: () => "1.0.0" },
      updater: updater as unknown as AppUpdater,
      sources: sources.slice(0, 2),
      log: { info: vi.fn(), error: vi.fn() },
    });

    await updates.check();
    await expect(updates.download()).rejects.toThrow("版本不一致");
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updates.getState().status).toBe("error");
  });

  test("镜像配置去重并始终保留 GitHub Releases", () => {
    const configured = getDefaultUpdateSources(
      '["https://mirror.example/releases", "https://mirror.example/releases/", "file:///invalid"]',
    );

    expect(configured).toHaveLength(2);
    expect(configured[0]).toMatchObject({ label: "mirror.example" });
    expect(configured[1]).toMatchObject({
      id: "github",
      label: "GitHub Releases",
    });
  });
});
