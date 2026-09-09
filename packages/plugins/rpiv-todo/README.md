# Todo

Meta Agent Desktop adaptation of [`@juicesharp/rpiv-todo`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo).

The plugin exposes a persistent structured `todo` method through Desktop's generation-scoped `run_code` plugin API and renders the current task list natively inside the Session Info Panel. The Composer remains dedicated to message input and other generic extension widgets.

## Features

- `plugin["rpiv.todo"].todo(...)` actions: `create`, `update`, `list`, `get`, `delete`, and `clear`
- task statuses: `pending`, `in_progress`, `completed`, and `deleted`
- dependency relationships through `blockedBy`
- session-scoped state restored from bounded custom snapshots, with historical direct-tool replay compatibility
- `/todos` command for a notification summary
- native task list in the Session Info Panel
- localized tool and panel text

## run_code usage

```ts
return await plugin["rpiv.todo"].todo({
  action: "create",
  subject: "Verify Desktop integration",
  activeForm: "verifying Desktop integration"
});
```

The plugin ships a `pi.runCode` catalog and skill. Desktop exposes the method through `plugin_call`; it does not add a direct model-facing `todo` tool.

## Desktop behavior

The upstream terminal `Ctrl+Shift+T` collapse shortcut is intentionally not registered. The plugin sends a bounded structured todo snapshot for Desktop's native React Session Info Panel, plus standard plain-text fallback lines for other Pi hosts.

The Session Info Panel displays localized progress, status icons, task details, active work, dependencies, and a bounded overflow count. Output is bounded by the `maxWidgetLines` plugin setting.

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
