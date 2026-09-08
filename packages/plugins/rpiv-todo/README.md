# Todo

Meta Agent Desktop adaptation of [`@juicesharp/rpiv-todo`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo).

The plugin gives the model a persistent structured `todo` tool and renders a compact progress trigger immediately above the Desktop Composer. Hovering or focusing the trigger opens a wider native task-details popover above it; the Composer itself stays compact.

## Features

- `todo` tool actions: `create`, `update`, `list`, `get`, `delete`, and `clear`
- task statuses: `pending`, `in_progress`, `completed`, and `deleted`
- dependency relationships through `blockedBy`
- session-scoped state restored from tool-result snapshots
- `/todos` command for a notification summary
- live Composer progress panel
- localized tool and panel text

## Desktop behavior

The upstream terminal `Ctrl+Shift+T` collapse shortcut is intentionally not registered. The plugin sends a bounded structured todo snapshot for Desktop's native React trigger and details popover, plus standard plain-text fallback lines for other Pi hosts. Desktop owns the hover and keyboard interaction.

The first panel line is the compact progress summary. Expanded content is bounded by the `maxWidgetLines` plugin setting.

## Configuration

Configure the plugin from Desktop plugin settings:

- `maxWidgetLines`: maximum total lines shown while expanded, from 4 to 40; default `12`

The upstream dotfile configuration and shortcut settings are not used by this Desktop package.

## Marketplace identity

- marketplace: `meta-agent-development`
- publisher: `admin`
- plugin ID: `rpiv.todo`
- entry: `index.ts`

## Development

```bash
cd packages/plugins/rpiv-todo
npm run typecheck
npm test
```

## Credits

Original implementation: [`juicesharp/rpiv-mono`](https://github.com/juicesharp/rpiv-mono), package `@juicesharp/rpiv-todo@2.9.0`.

License: MIT. See [LICENSE](./LICENSE).
