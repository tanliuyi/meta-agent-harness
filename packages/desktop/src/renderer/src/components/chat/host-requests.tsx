import { useEffect, useState } from "react";
import type { HostRequest, HostResponse, SessionControlState } from "../../../../shared/contracts.ts";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog.tsx";

/** 渲染当前 session 的阻塞式扩展 UI 请求。 */
export function HostRequests({ snapshot }: { snapshot: SessionControlState }) {
  const request = snapshot.hostRequests[0];
  const [value, setValue] = useState("");
  useEffect(() => {
    setValue(request?.type === "editor" ? (request.message ?? "") : "");
  }, [request?.id, request?.message, request?.type]);
  if (!request) return null;
  if (request.type === "notify") {
    return (
      <div className={`notice notice-${request.notifyType ?? "info"}`}>
        <span>{request.title}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void respond(snapshot, { requestId: request.id, dismissed: true })}
        >
          关闭
        </Button>
      </div>
    );
  }
  return (
    <Dialog open>
      <DialogContent
        className="gap-3 [&>button]:hidden sm:max-w-lg"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <p className="text-xs font-medium text-muted-foreground uppercase">
          {request.toolCallId ? `工具 ${request.toolCallId}` : "Pi 扩展请求"}
        </p>
        <DialogTitle>{request.title}</DialogTitle>
        {request.message ? <DialogDescription>{request.message}</DialogDescription> : null}
        <RequestField request={request} value={value} onChange={setValue} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void respond(snapshot, { requestId: request.id, dismissed: true })}>
            取消
          </Button>
          {request.type === "confirm" ? (
            <>
              <Button
                variant="outline"
                onClick={() => void respond(snapshot, { requestId: request.id, confirmed: false })}
              >
                拒绝
              </Button>
              <Button onClick={() => void respond(snapshot, { requestId: request.id, confirmed: true })}>允许</Button>
            </>
          ) : (
            <Button
              disabled={request.type === "select" && !value}
              onClick={() => void respond(snapshot, { requestId: request.id, value })}
            >
              继续
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequestField({
  request,
  value,
  onChange,
}: {
  request: HostRequest;
  value: string;
  onChange(value: string): void;
}) {
  if (request.type === "confirm") return null;
  if (request.type === "select") {
    return (
      <div className="grid gap-1.5 pt-2">
        {request.options?.map((option) => (
          <button
            type="button"
            className={
              value === option
                ? "rounded-md border border-primary bg-accent px-3 py-2 text-left text-sm"
                : "rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
            }
            key={option}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }
  return request.type === "editor" ? (
    <textarea
      className="mt-2 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      rows={10}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ) : (
    <input
      className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      autoFocus
      value={value}
      placeholder={request.placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

async function respond(snapshot: SessionControlState, response: HostResponse): Promise<void> {
  const request = snapshot.hostRequests.find((item) => item.id === response.requestId);
  await window.desktop.sessions.respond(snapshot.projectId, snapshot.threadId, {
    ...response,
    workerInstanceId: request?.workerInstanceId,
  });
}
