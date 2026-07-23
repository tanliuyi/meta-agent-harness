interface BottomFollowViewport {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

/** Keep a nested scroll viewport pinned as its rendered content grows. */
export function followResizingContentToBottom(viewport: BottomFollowViewport, content: Element): () => void {
  let frame: number | undefined;
  const pin = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (viewport.scrollHeight <= viewport.clientHeight) return;
      viewport.scrollTop = viewport.scrollHeight;
    });
  };

  const observer = new ResizeObserver(pin);
  observer.observe(content);
  pin();

  return () => {
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
