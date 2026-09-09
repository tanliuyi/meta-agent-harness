# Desktop adaptation

This package is derived from `@juicesharp/rpiv-todo@2.9.0` at upstream commit `338b264c1ca4fd8828cc849b632f4f7ad88d2e78`.

## Preserved behavior

- the `todo` declaration and its state reducer, captured by Desktop as a generation-scoped run_code plugin method
- `/todos`
- dependency validation and cycle prevention
- per-session state isolation
- replay from bounded run_code persistence entries and historical direct-tool snapshots
- localized messages and panel labels

## Desktop-specific behavior

- the native task list is rendered inside the Session Info Panel
- the Composer does not render the todo widget
- progress, statuses, active work, and dependencies use native React UI
- panel output is bounded by the `maxWidgetLines` Desktop setting

The plugin passes a bounded structured todo snapshot through a Desktop-only structural widget option while retaining plain-text widget lines as the standard fallback. Desktop validates the snapshot before IPC and routes it to Session Info. The public `packages/coding-agent` extension API is not modified; standard hosts ignore the extra option and render the fallback lines.

The manifest declares `pi.runCode` and `plugin-methods.provide`. Desktop's method-only host captures the plugin's standard tool declaration and exposes it as `plugin["rpiv.todo"].todo(...)`; it is not registered as a direct model-facing tool.

## Removed terminal-only behavior

- `Ctrl+Shift+T` shortcut registration
- terminal-local collapsed state
- dotfile shortcut configuration
- dynamic optional loading used by the upstream monorepo

The plugin uses Desktop plugin configuration through `pi.getConfig()` and static `@juicesharp/rpiv-i18n` imports.

## Trust and lifecycle

The plugin is full-trust extension code because it registers a model-facing tool and reads session history. It does not spawn child processes, access the network, or accept terminal input. Mutable widget and session state is disposed on `session_shutdown`.
