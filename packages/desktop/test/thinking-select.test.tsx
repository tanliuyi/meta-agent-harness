import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThinkingSelect } from "../src/renderer/src/components/chat/thinking-select.tsx";

const select = vi.hoisted(() => vi.fn((_props: unknown) => null));

vi.mock("../src/renderer/src/components/assistant-ui/select/select.tsx", () => ({ Select: select }));

describe("ThinkingSelect", () => {
  it("忽略 Radix 表单层对当前受控值派发的 change", () => {
    const onValueChange = vi.fn();
    renderToStaticMarkup(
      createElement(ThinkingSelect, {
        value: "high",
        levels: ["off", "high"],
        onValueChange,
      }),
    );
    const props = select.mock.lastCall?.[0] as { onValueChange(value: string): void } | undefined;
    if (!props) throw new Error("Select props were not captured");

    props.onValueChange("high");
    expect(onValueChange).not.toHaveBeenCalled();

    props.onValueChange("off");
    expect(onValueChange).toHaveBeenCalledWith("off");
  });
});
