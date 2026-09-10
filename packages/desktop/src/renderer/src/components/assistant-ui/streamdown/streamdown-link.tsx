import { FileTypeIcon } from "@renderer/components/panel/files/file-type-icon";
import Globe from "lucide-react/dist/esm/icons/globe.mjs";
import {
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { FileIcon } from "react-material-vscode-icons";
import { StreamdownContext } from "streamdown";
import { markdownLocalPath } from "../../../../../shared/markdown-image-contracts.ts";
import { isLocalMarkdownLink, LinkSafetyModal } from "./link-safety-modal.tsx";

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & {
  node?: {
    children?: Array<{ type?: string; tagName?: string }>;
  };
};

export function MarkdownLink({ children, className, href, node, ...props }: MarkdownLinkProps) {
  const { linkSafety } = useContext(StreamdownContext);
  const [modalOpen, setModalOpen] = useState(false);
  const incomplete = href === "streamdown:incomplete-link";
  const open = useCallback(() => {
    if (href) window.open(href, "_blank", "noreferrer");
  }, [href]);
  const click = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      if (!linkSafety?.enabled || !href || incomplete) return;
      event.preventDefault();
      if (linkSafety.onLinkCheck && (await linkSafety.onLinkCheck(href))) {
        open();
        return;
      }
      setModalOpen(true);
    },
    [href, incomplete, linkSafety, open],
  );
  const content = linkContent(href, node, children);
  const sharedClassName = `wrap-anywhere font-medium text-info underline${className ? ` ${className}` : ""}`;

  if (linkSafety?.enabled && href) {
    const modal = {
      url: href,
      isOpen: modalOpen,
      onClose: () => setModalOpen(false),
      onConfirm: open,
    };
    return (
      <>
        <button
          className={`${sharedClassName} appearance-none text-left`}
          data-incomplete={incomplete}
          data-streamdown="link"
          onClick={click}
          title={props.title}
          type="button"
        >
          {content}
        </button>
        {linkSafety.renderModal ? linkSafety.renderModal(modal) : <LinkSafetyModal {...modal} />}
      </>
    );
  }

  return (
    <a
      {...props}
      className={sharedClassName}
      data-incomplete={incomplete}
      data-streamdown="link"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {content}
    </a>
  );
}

function WebsiteIcon({ origin }: { origin: string }) {
  const [failed, setFailed] = useState(false);
  const className = "mr-1 inline size-3.5 align-[-0.125em]";
  if (failed) return <Globe aria-hidden="true" className={className} />;
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
      src={`${origin}/favicon.ico`}
    />
  );
}

function linkContent(href: string | undefined, node: MarkdownLinkProps["node"], children: ReactNode): ReactNode {
  if (
    !href ||
    href.startsWith("#") ||
    node?.children?.some((child) => child.type === "element" && child.tagName === "img")
  ) {
    return children;
  }
  if (isLocalMarkdownLink(href)) {
    const localPath = markdownLocalPath(href);
    const isFolder = /[/\\]$/u.test(localPath);
    const name = pathName(localPath, isFolder);
    return (
      <>
        {isFolder ? (
          <span className="mr-1 inline-flex size-3.5 align-[-0.125em]" aria-hidden="true">
            <FileIcon fileName={name} isFolder size={14} />
          </span>
        ) : (
          <FileTypeIcon className="mr-1 inline-flex size-3.5 align-[-0.125em]" name={name} size={14} />
        )}
        {children}
      </>
    );
  }
  const external = externalUrl(href);
  if (external) {
    return (
      <>
        <WebsiteIcon origin={external.origin} />
        {children}
      </>
    );
  }
  return children;
}

function externalUrl(href: string): { origin: string } | undefined {
  if (!/^https?:\/\//iu.test(href)) return undefined;
  try {
    const url = new URL(href);
    return { origin: url.origin };
  } catch {
    return undefined;
  }
}

function pathName(path: string, isFolder: boolean): string {
  const normalized = isFolder ? path.replace(/[/\\]+$/u, "") : path;
  const name = normalized.split(/[/\\]/u).at(-1) || (isFolder ? "folder" : "file");
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
