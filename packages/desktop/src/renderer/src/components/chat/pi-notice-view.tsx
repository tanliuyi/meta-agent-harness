import type { PiNoticeMessage } from "../../../../shared/contracts.ts";

export function PiNoticeView({ data }: { data: unknown }) {
  if (!isPiNotice(data)) return null;
  const content = data.content;
  return (
    <section className="pi-notice" data-notice-type={data.noticeType}>
      <header>{noticeTitle(data)}</header>
      {content.type === "text" ? <pre>{content.text}</pre> : null}
      {content.type === "command" ? (
        <>
          <code>{content.command}</code>
          {content.output ? <pre>{content.output}</pre> : null}
          <small>
            {content.cancelled ? "已取消" : content.exitCode === undefined ? "已完成" : `退出码 ${content.exitCode}`}
          </small>
        </>
      ) : null}
      {content.type === "custom" ? (
        <div className="pi-notice-custom">
          {content.content.map((part, index) =>
            part.type === "text" ? (
              <pre key={`${data.id}:text:${index}`}>{part.text}</pre>
            ) : (
              <img
                key={`${data.id}:image:${index}`}
                src={`data:${part.mimeType};base64,${part.data}`}
                alt={`${data.title} ${index + 1}`}
              />
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

function noticeTitle(notice: PiNoticeMessage): string {
  if (notice.noticeType === "bash") return "终端命令";
  if (notice.noticeType === "compaction") return "上下文压缩";
  if (notice.noticeType === "branch-summary") return "分支摘要";
  return notice.title;
}

function isPiNotice(value: unknown): value is PiNoticeMessage {
  return (
    value !== null &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "notice" &&
    "noticeType" in value &&
    typeof value.noticeType === "string" &&
    "content" in value &&
    Boolean(value.content) &&
    typeof value.content === "object"
  );
}
