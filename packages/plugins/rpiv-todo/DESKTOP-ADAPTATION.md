# Desktop adaptation

This package is derived from `@juicesharp/rpiv-todo@2.9.0` at upstream commit `338b264c1ca4fd8828cc849b632f4f7ad88d2e78`.

## Preserved behavior

- the `todo` model tool and its state reducer
- `/todos`
- dependency validation and cycle prevention
- per-session state isolation
- replay from persisted tool-result snapshots
- localized messages and panel labels

## Desktop-specific behavior

- the task panel is placed above the Composer input
- a centered compact trigger shows only the progress heading at rest
- pointer hover or keyboard focus opens a wider details popover above the trigger
- moving into the popover keeps it open; leaving or blurring closes it
- popover output is bounded by the `maxWidgetLines` Desktop setting

The plugin passes a bounded structured todo snapshot through a Desktop-only structural widget option while retaining plain-text widget lines as the standard fallback. Desktop validates the snapshot before IPC and renders a native React card. The public `packages/coding-agent` extension API is not modified; standard hosts ignore the extra option and render the fallback lines.

## Removed terminal-only behavior

- `Ctrl+Shift+T` shortcut registration
- terminal-local collapsed state
- dotfile shortcut configuration
- dynamic optional loading used by the upstream monorepo

The plugin uses Desktop plugin configuration through `pi.getConfig()` and static `@juicesharp/rpiv-i18n` imports.

## Trust and lifecycle

The plugin is full-trust extension code because it registers a model-facing tool and reads session history. It does not spawn child processes, access the network, or accept terminal input. Mutable widget and session state is disposed on `session_shutdown`.
