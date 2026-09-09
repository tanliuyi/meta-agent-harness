# Session Info task list

The plugin publishes a bounded structured todo snapshot. Meta Agent Desktop renders that snapshot natively inside the current session's Session Info Panel.

## Native content

The panel displays:

- localized title and `completed/total` progress
- pending, in-progress, and completed status icons
- task subjects and active-work labels
- dependency IDs
- a localized hidden-task count when the configured row budget truncates the list

The Composer does not render the todo widget. It remains available for ordinary extension widgets and message input.

## Compatibility

The structured snapshot is sent as a Desktop-only widget option. The public Pi extension API is unchanged. Hosts that do not support the option render the plugin's standard plain-text fallback lines.

The upstream `Ctrl+Shift+T` terminal shortcut is not registered in Desktop.
