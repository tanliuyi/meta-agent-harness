import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import { useEffect, useState } from "react";
import type {
  ExtensionDependencyProgress,
  ExtensionDependencyRequirement,
} from "../../../../shared/extension-dependency-contracts.ts";

export const EXTENSION_DEPENDENCY_CUSTOMER_COPY = {
  title: "需要更新扩展",
  description: "部分扩展需要更新后才能继续使用。",
  disclosure: "更新会联网下载依赖，并可能运行扩展提供的安装脚本。完成后 Desktop 会自动重启。",
  action: "更新扩展",
} as const;

export function ExtensionDependencyGate() {
  const [requirement, setRequirement] = useState<ExtensionDependencyRequirement | null>(null);
  const [progress, setProgress] = useState<ExtensionDependencyProgress | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => window.desktop.extensionDependencies.onRequired(setRequirement), []);
  useEffect(() => window.desktop.extensionDependencies.onProgress(setProgress), []);

  async function prepare(): Promise<void> {
    if (!requirement || preparing) return;
    setPreparing(true);
    setProgress({ phase: "preparing", message: "正在更新扩展..." });
    try {
      await window.desktop.extensionDependencies.prepare({
        source: requirement.source,
        projectId: requirement.projectId,
      });
    } catch {
      setProgress((current) =>
        current?.phase === "error" ? current : { phase: "error", message: "扩展更新失败，请检查网络后重试。" },
      );
      setPreparing(false);
    }
  }

  if (!requirement) return null;

  return (
    <AlertDialogPrimitive.Root open onOpenChange={(open) => !open && !preparing && setRequirement(null)}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="extension-dependency-overlay" />
        <AlertDialogPrimitive.Content className="extension-dependency-blocker">
          <div className="extension-dependency-copy">
            <AlertDialogPrimitive.Title className="extension-dependency-title">
              {EXTENSION_DEPENDENCY_CUSTOMER_COPY.title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description asChild>
              <div aria-live="polite">
                <p>{EXTENSION_DEPENDENCY_CUSTOMER_COPY.description}</p>
                <small>{EXTENSION_DEPENDENCY_CUSTOMER_COPY.disclosure}</small>
              </div>
            </AlertDialogPrimitive.Description>
            {progress ? (
              <p className={progress.phase === "error" ? "extension-dependency-error" : "extension-dependency-status"}>
                {progress.message}
              </p>
            ) : null}
          </div>
          <div className="extension-dependency-actions">
            <AlertDialogPrimitive.Cancel asChild>
              <button type="button" className="secondary-button" disabled={preparing}>
                稍后
              </button>
            </AlertDialogPrimitive.Cancel>
            <button type="button" className="primary-button" onClick={() => void prepare()} disabled={preparing}>
              {preparing ? (
                <LoaderCircle aria-hidden="true" className="extension-dependency-spinner" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {preparing ? "更新中" : EXTENSION_DEPENDENCY_CUSTOMER_COPY.action}
            </button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
