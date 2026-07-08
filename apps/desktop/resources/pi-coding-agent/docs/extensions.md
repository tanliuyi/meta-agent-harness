# Extensions

Extensions are TypeScript modules that extend the desktop coding-agent runtime. They can subscribe to lifecycle events, register tools, add commands and shortcuts, and request structured UI interactions from the host.

The desktop renderer owns all visual components. Extensions must return structured data and use `ctx.ui` request methods; component factories, terminal renderers, custom message renderers, and tool render hooks are not part of the desktop-only runtime.

## Quick Start

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

export default function extension(pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.notify('Extension loaded', 'info')
  })

  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName === 'bash' && event.input.command?.includes('rm -rf')) {
      const ok = await ctx.ui.confirm('Dangerous command', 'Allow this command?')
      if (!ok) return { block: true, reason: 'Blocked by user' }
    }
  })

  pi.registerTool({
    name: 'greet',
    description: 'Greet someone by name',
    parameters: Type.Object({ name: Type.String() }),
    async execute(_id, input: { name: string }) {
      return {
        content: [{ type: 'text', text: `Hello, ${input.name}` }],
        details: { greeted: input.name }
      }
    }
  })
}
```

## Locations

Extensions can be discovered from global and project package/resource paths. Desktop hosts may also provide extension factories directly through the SDK runtime.

## Run Modes

`ctx.mode` is one of:

| Mode      | Meaning                            |
| --------- | ---------------------------------- |
| `desktop` | Desktop worker/runtime integration |
| `rpc`     | JSONL RPC over stdio               |
| `json`    | Structured non-interactive output  |
| `print`   | Plain non-interactive output       |

`ctx.hasUI` means dialog and fire-and-forget `ctx.ui` methods are available through the host transport.

## Extension UI

`ctx.ui` exposes structured requests only:

| Method                                              | Behavior                                   |
| --------------------------------------------------- | ------------------------------------------ |
| `select(title, options, opts?)`                     | Ask the host to show a selection dialog    |
| `confirm(title, message, opts?)`                    | Ask the host to show a confirmation dialog |
| `input(title, placeholder?, opts?)`                 | Ask the host to show a single-line input   |
| `editor(title, prefill?)`                           | Ask the host to show a multi-line editor   |
| `notify(message, type?)`                            | Send a notification request                |
| `setStatus(key, text)`                              | Set or clear status text                   |
| `setWidget(key, lines, options?)`                   | Set or clear a string-line widget          |
| `setTitle(title)`                                   | Request host title update                  |
| `pasteToEditor(text)`                               | Request paste into the host editor         |
| `setEditorText(text)`                               | Request editor text replacement            |
| `getEditorText()`                                   | Return the latest known host editor text   |
| `getToolsExpanded()` / `setToolsExpanded(expanded)` | Read or request tool expansion state       |

The core package does not expose UI components. Renderer-specific UI belongs in `apps/desktop/renderer`.

## Tools

Tools are registered with `pi.registerTool()`. A tool definition contains schema, prompt metadata, and an `execute()` function. Tool results should be structured:

```ts
return {
  content: [{ type: 'text', text: 'Done' }],
  details: { changedFiles: ['src/app.ts'] }
}
```

Renderer code decides how to present `content`, `details`, partial updates, errors, and tool call arguments.

## Events

Extensions can subscribe to lifecycle and agent events with `pi.on(event, handler)`. Important event groups include:

| Group          | Examples                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Resources      | `resources_discover`                                                                                          |
| Session        | `session_start`, `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_shutdown` |
| Agent turn     | `before_agent_start`, `agent_start`, `turn_start`, `message_update`, `message_end`, `turn_end`, `agent_end`   |
| Tools          | `tool_call`, `tool_result`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`             |
| Model/provider | `model_select`, `thinking_level_select`, `before_provider_request`, `after_provider_response`                 |
| Input          | `input`, `user_bash`                                                                                          |

Handlers can return documented result objects for events that support interception, such as blocking or rewriting a tool call.

## Commands And Shortcuts

Extensions can register commands and shortcuts:

```ts
pi.registerCommand('hello', {
  description: 'Say hello',
  handler: async (args, ctx) => ctx.ui.notify(args ? `Hello, ${args}` : 'Hello')
})

pi.registerShortcut('app.myExtension.hello', {
  description: 'Say hello',
  handler: async (ctx) => ctx.ui.notify('Hello')
})
```

Shortcut ids are strings. Built-in ids are documented in [keybindings.md](keybindings.md).

## State

Use session entries and extension state APIs for persistence. Custom entries should be structured JSON that the desktop host can inspect and project into snapshots.

## Desktop Boundary

Do not implement renderer UI in this package. The coding-agent package owns:

- sessions and event streams
- tool execution
- extension lifecycle and structured UI requests
- config/resource loading
- RPC/desktop worker protocols

The desktop app owns:

- visual layout
- components
- tool result presentation
- dialogs and editor UX
