import { fromMarkdown } from "mdast-util-from-markdown";

export const MARKDOWN_IMAGE_SCHEME = "meta-agent-markdown-image";
const MARKDOWN_WINDOWS_PATH_PREFIX = "/.meta-agent-local/windows/";

const LOCAL_IMAGE_WITH_SPACES_PATTERN =
  /(!\[[^\]\n]*\]\()((?:\/|file:\/\/\/|[A-Za-z]:[\\/]|\\\\)[^<>\n]*\s[^<>\n]*\.(?:avif|bmp|gif|jpe?g|png|webp))(\))/giu;
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/iu;

export function preprocessMarkdownImages(markdown: string): string {
  return transformMarkdownOutsideCode(markdown, (source) =>
    source.replace(LOCAL_IMAGE_WITH_SPACES_PATTERN, "$1<$2>$3"),
  );
}

function transformMarkdownOutsideCode(markdown: string, transform: (source: string) => string): string {
  type MarkdownNode = {
    type: string;
    position?: { start: { offset?: number }; end: { offset?: number } };
    children?: MarkdownNode[];
  };
  const codeRanges: Array<{ start: number; end: number }> = [];
  const stack: MarkdownNode[] = [fromMarkdown(markdown)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) codeRanges.push({ start, end });
      continue;
    }
    if (node.children) stack.push(...node.children);
  }
  codeRanges.sort((left, right) => left.start - right.start);

  let output = "";
  let plainStart = 0;
  for (const range of codeRanges) {
    output += transform(markdown.slice(plainStart, range.start));
    output += markdown.slice(range.start, range.end);
    plainStart = range.end;
  }
  return output + transform(markdown.slice(plainStart));
}

/** Resolve only local relative Markdown destinations. URL schemes, fragments, and absolute paths remain unchanged. */
export function resolveRelativeMarkdownPath(source: string, cwd: string): string | undefined {
  const value = source.trim();
  if (
    !value ||
    !isAbsoluteLocalPath(cwd) ||
    value.startsWith("#") ||
    value.startsWith("//") ||
    isAbsoluteLocalPath(value) ||
    URI_SCHEME_PATTERN.test(value)
  ) {
    return undefined;
  }

  const normalizedCwd = cwd.replaceAll("\\", "/").replace(/\/+$/u, "");
  const normalizedSource = value.replaceAll("\\", "/");
  const unc = normalizedCwd.startsWith("//");
  const windows = WINDOWS_ABSOLUTE_PATH_PATTERN.test(cwd) || unc;
  const prefix = unc ? "//" : cwd.replaceAll("\\", "/").startsWith("/") ? "/" : "";
  const cwdParts = normalizedCwd.slice(prefix.length).split("/").filter(Boolean);
  const rootDepth = unc ? Math.min(2, cwdParts.length) : windows ? 1 : 0;
  const resolved = [...cwdParts];
  for (const part of normalizedSource.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolved.length > rootDepth) resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  const absolute = `${prefix}${resolved.join("/")}` || prefix;
  return windows ? encodeWindowsMarkdownPath(absolute) : absolute;
}

/** Restore a Windows path encoded for Streamdown's URL sanitizer without decoding URL-reserved characters. */
export function markdownLocalPath(source: string): string {
  if (!source.startsWith(MARKDOWN_WINDOWS_PATH_PREFIX)) return source;
  const value = source.slice(MARKDOWN_WINDOWS_PATH_PREFIX.length);
  return value.startsWith("UNC/") ? `//${value.slice(4)}` : value;
}

export function isEncodedMarkdownLocalPath(source: string): boolean {
  return source.startsWith(MARKDOWN_WINDOWS_PATH_PREFIX);
}

export function resolveMarkdownDestination(source: string, cwd?: string): string | undefined {
  const value = source.trim();
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)) return encodeWindowsMarkdownPath(value);
  if (value.startsWith("\\\\")) return encodeWindowsMarkdownPath(value);
  return cwd ? resolveRelativeMarkdownPath(value, cwd) : undefined;
}

function encodeWindowsMarkdownPath(source: string): string {
  const normalized = source.replaceAll("\\", "/");
  const value = normalized.startsWith("//") ? `UNC/${normalized.slice(2)}` : normalized;
  return `${MARKDOWN_WINDOWS_PATH_PREFIX}${value}`;
}

export function markdownImageSourceToUrl(source: string): string {
  const localSource = markdownLocalPath(source);
  if (!isProxyableImageSource(localSource)) return source;
  const normalizedSource = isLocalImageSource(localSource) ? decodeLocalImageSource(localSource) : localSource;
  return `${MARKDOWN_IMAGE_SCHEME}://local/image?source=${encodeURIComponent(normalizedSource)}`;
}

export function markdownImageReference(source: string, alt: string): string {
  const localSource = markdownLocalPath(source);
  const normalizedSource = isLocalImageSource(localSource) ? decodeLocalImageSource(localSource) : localSource;
  const destination = /\s/u.test(normalizedSource) ? `<${normalizedSource}>` : normalizedSource;
  return `![${alt.replaceAll("]", "\\]")}](${destination})`;
}

export function markdownImageFilename(source: string, alt: string): string {
  const sourcePath = imageSourcePath(markdownLocalPath(source));
  const sourceName = decodeLocalImageSource(sourcePath.split(/[\\/]/u).at(-1) ?? "");
  const safeSourceName = safeFilename(sourceName);
  if (safeSourceName) return safeSourceName;
  const safeAlt = safeFilename(alt);
  return safeAlt || "image";
}

function imageSourcePath(source: string): string {
  try {
    return new URL(source).pathname;
  } catch {
    return source;
  }
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/gu, "-").trim();
}

function decodeLocalImageSource(source: string): string {
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
}

function isProxyableImageSource(source: string): boolean {
  if (isLocalImageSource(source)) return true;
  try {
    const protocol = new URL(source).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalImageSource(source: string): boolean {
  if (isAbsoluteLocalPath(source)) return true;

  try {
    return new URL(source).protocol === "file:";
  } catch {
    return false;
  }
}

function isAbsoluteLocalPath(source: string): boolean {
  return source.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(source) || source.startsWith("\\\\");
}
