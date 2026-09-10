import { type RefObject, useEffect, useRef } from "react";

/** Register wheel handling directly because React delegates wheel events as passive. */
export function useNonPassiveWheel<T extends HTMLElement>(
  target: RefObject<T | null>,
  handler: (event: WheelEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => handlerRef.current(event);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [target]);
}
