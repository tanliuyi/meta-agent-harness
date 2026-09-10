import { Type } from "typebox";

import { desktopDevelopmentMethods } from "./desktop-development-contracts.ts";

export const DESKTOP_ROUTES = [
  "/",
  "/new",
  "/plugins",
  "/settings",
  "/settings/personalization",
  "/settings/keyboard",
  "/settings/models",
  "/settings/auth",
  "/settings/extensions",
  "/settings/browser",
  "/settings/memory",
  "/settings/auto-title",
  "/settings/subagents",
  "/settings/agents",
  "/settings/archives",
  "/settings/dependencies",
  "/settings/about",
] as const;

const object = Type.Object;
const windowId = Type.Optional(Type.Integer({ minimum: 1 }));
export const desktopMethods = {
  ...desktopDevelopmentMethods,
  get_settings: {
    description: "Read Desktop message display/profile settings and their revision (not provider credentials).",
    parameters: object({}, { additionalProperties: false }),
  },
  update_settings: {
    description:
      "Patch Desktop settings using the revision returned by get_settings. Returns saved or conflict; uses the existing settings service.",
    parameters: object(
      {
        expectedRevision: Type.String({ minLength: 1, maxLength: 128 }),
        patch: object(
          {
            showThinking: Type.Optional(Type.Boolean()),
            autoExpandRunning: Type.Optional(Type.Boolean()),
            showAvatars: Type.Optional(Type.Boolean()),
            messageWidth: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
            userName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
            userAvatarPath: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
      },
      { additionalProperties: false },
    ),
  },
  inspect: {
    description:
      "Inspect the Desktop runtime version, platform and main application window. Does not inspect browser guest tabs.",
    parameters: object({}, { additionalProperties: false }),
  },
  navigation_state: {
    description: "Read the Desktop SPA router location and loading state.",
    parameters: object({ windowId }, { additionalProperties: false }),
  },
  navigate: {
    description:
      "Navigate the Desktop SPA to a listed route or /projects/{projectId}/session/{threadId}. Returns observed router state; refuses dirty settings editors.",
    parameters: object(
      { windowId, path: Type.String({ minLength: 1, maxLength: 2048 }) },
      { additionalProperties: false },
    ),
  },
  window_action: {
    description: "Show, focus, minimize, maximize, restore or resize the Desktop window. Bounds are in screen pixels.",
    parameters: object(
      {
        windowId,
        action: Type.Union([
          Type.Literal("show"),
          Type.Literal("focus"),
          Type.Literal("minimize"),
          Type.Literal("maximize"),
          Type.Literal("restore"),
          Type.Literal("set_bounds"),
        ]),
        bounds: Type.Optional(
          object(
            {
              x: Type.Optional(Type.Integer({ minimum: -32768, maximum: 32768 })),
              y: Type.Optional(Type.Integer({ minimum: -32768, maximum: 32768 })),
              width: Type.Integer({ minimum: 400, maximum: 8192 }),
              height: Type.Integer({ minimum: 300, maximum: 8192 }),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  cdp_send: {
    description:
      "Send a CDP command to the Desktop renderer through Electron debugger. Target/Browser domains and external navigation are forbidden; no remote debugging port is opened.",
    parameters: object(
      {
        windowId,
        method: Type.String({ pattern: "^[A-Za-z]+\\.[A-Za-z]+$", maxLength: 128 }),
        paramsJson: Type.Optional(
          Type.String({ maxLength: 32768, description: "JSON object containing CDP parameters; defaults to {}" }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  evaluate: {
    description:
      "Evaluate JavaScript in the Desktop renderer, await its promise and return a value. Has access to Desktop UI data and can cause side effects.",
    parameters: object(
      { windowId, expression: Type.String({ minLength: 1, maxLength: 32768 }) },
      { additionalProperties: false },
    ),
  },
  screenshot: {
    description:
      "Capture the Desktop renderer viewport as a PNG data URL. Returns an error when the image exceeds 4 MiB.",
    parameters: object({ windowId }, { additionalProperties: false }),
  },
  cdp_events: {
    description:
      "Read up to 100 buffered Desktop CDP events after a cursor. Buffer retains 200 events, each at most 8 KiB. Enable desired domains with cdp_send first. Reports dropped events.",
    parameters: object(
      {
        windowId,
        after: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      },
      { additionalProperties: false },
    ),
  },
} as const;
export type DesktopMethod = keyof typeof desktopMethods;

export function isDesktopRoute(path: string): boolean {
  return (
    (DESKTOP_ROUTES as readonly string[]).includes(path) || /^\/projects\/[^/?#%\\]+\/session\/[^/?#%\\]+$/.test(path)
  );
}
