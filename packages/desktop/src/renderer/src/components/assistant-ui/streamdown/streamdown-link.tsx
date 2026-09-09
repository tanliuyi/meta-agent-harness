import ExternalLink from "lucide-react/dist/esm/icons/external-link.mjs";
import File from "lucide-react/dist/esm/icons/file.mjs";
import {
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import { StreamdownContext } from "streamdown";
import { isLocalMarkdownLink } from "./link-safety-modal.tsx";

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
  const sharedClassName = `wrap-anywhere font-medium text-primary underline${className ? ` ${className}` : ""}`;

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
          {...props}
          className={`${sharedClassName} appearance-none text-left`}
          data-incomplete={incomplete}
          data-streamdown="link"
          onClick={click}
          type="button"
        >
          {content}
        </button>
        {linkSafety.renderModal ? linkSafety.renderModal(modal) : null}
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

function linkContent(href: string | undefined, node: MarkdownLinkProps["node"], children: ReactNode): ReactNode {
  if (
    !href ||
    href.startsWith("#") ||
    node?.children?.some((child) => child.type === "element" && child.tagName === "img")
  ) {
    return children;
  }
  const iconClassName = "mr-1 inline size-3.5 align-[-0.125em] text-current";
  if (isLocalMarkdownLink(href)) {
    return (
      <>
        <File aria-hidden="true" className={iconClassName} />
        {children}
      </>
    );
  }
  if (/^https?:\/\//iu.test(href)) {
    return (
      <>
        <ExternalLink aria-hidden="true" className={iconClassName} />
        {children}
      </>
    );
  }
  return children;
}
