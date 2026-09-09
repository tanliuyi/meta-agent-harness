import { Button } from "@renderer/shared/ui/button";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import type { ReactNode } from "react";
import { useState } from "react";
import type {
  InstalledMarketplacePluginSummary,
  MarketplacePluginSummary,
} from "../../../../shared/plugin-marketplace-contracts.ts";
import { updateAvailable } from "./plugin-marketplace-utils.ts";
import { canInstallMarketplacePlugin } from "./use-plugin-marketplace.ts";

type PendingAction = "install" | "uninstall";

interface PluginDetailActionsProps {
  plugin?: MarketplacePluginSummary;
  installed?: InstalledMarketplacePluginSummary;
  mutationPending: boolean;
  installing: boolean;
  updating: boolean;
  uninstalling: boolean;
  onInstall(plugin: MarketplacePluginSummary): void;
  onUpdate(plugin: MarketplacePluginSummary): void;
  onUninstall(id: string): void;
  headerAction?: ReactNode;
  placement?: "header" | "inline";
}

export function PluginDetailActions({
  plugin,
  installed,
  mutationPending,
  installing,
  updating,
  uninstalling,
  onInstall,
  onUpdate,
  onUninstall,
  headerAction,
  placement = "inline",
}: PluginDetailActionsProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  if (!plugin && !installed) return null;
  const name = plugin?.name ?? installed!.displayName;
  const hasUpdate = plugin ? updateAvailable(plugin, installed ? [installed] : undefined) : false;
  const confirmation = pendingAction ? pluginActionConfirmation(pendingAction, name, plugin) : undefined;
  const confirmAction = () => {
    const action = pendingAction;
    setPendingAction(undefined);
    if (action === "install" && plugin) {
      onInstall(plugin);
    } else if (action === "uninstall" && installed) {
      onUninstall(installed.id);
    }
  };

  return (
    <div
      className={
        placement === "header"
          ? "plugin-marketplace-detail-actions plugin-marketplace-detail-header-actions"
          : "plugin-marketplace-detail-actions"
      }
      data-confirming={confirmation ? "true" : undefined}
      role="group"
      aria-label="插件操作"
    >
      {confirmation ? (
        <div className="plugin-marketplace-detail-confirmation" role="group" aria-label={confirmation.title}>
          {confirmation.description ? <p>{confirmation.description}</p> : null}
          <div className="plugin-marketplace-detail-confirmation-actions">
            <Button variant="ghost" onClick={() => setPendingAction(undefined)}>
              取消
            </Button>
            <Button
              variant={pendingAction === "uninstall" ? "destructive" : "default"}
              disabled={mutationPending}
              onClick={confirmAction}
            >
              {confirmation.confirmLabel}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {headerAction}
          {installed ? (
            <Button variant="outline" disabled={mutationPending} onClick={() => setPendingAction("uninstall")}>
              <Trash2 />
              {uninstalling ? "卸载中" : "卸载"}
            </Button>
          ) : null}
          {hasUpdate && plugin ? (
            <Button disabled={mutationPending} onClick={() => onUpdate(plugin)}>
              <RefreshCw />
              {updating ? "更新中" : "更新"}
            </Button>
          ) : !installed && plugin ? (
            <Button
              disabled={mutationPending || !canInstallMarketplacePlugin(plugin)}
              onClick={() => setPendingAction("install")}
            >
              {installing ? "安装中" : canInstallMarketplacePlugin(plugin) ? "安装" : "当前不可安装"}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function pluginActionConfirmation(
  action: PendingAction,
  name: string,
  plugin: MarketplacePluginSummary | undefined,
): { title: string; confirmLabel: string; description?: string } {
  if (action === "uninstall") {
    return {
      title: `卸载 ${name}？`,
      confirmLabel: "确认卸载",
    };
  }

  return {
    title: `安装 ${name}？`,
    confirmLabel: "确认安装",
    description: plugin?.containsNativeCode
      ? "此插件包含原生代码，并将以当前账户权限运行，可读写文件、访问网络、读取环境变量并执行程序。仅安装你信任的插件。"
      : "此插件将以当前账户权限运行，可读写文件、访问网络、读取环境变量并执行程序。仅安装你信任的插件。",
  };
}
