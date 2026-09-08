# Composer panel

The plugin renders a centered read-only progress trigger immediately above the Desktop Composer input.

## Compact state

The compact trigger shows the localized title and `completed/total` count. It does not grow to the Composer width.

## Expanded state

Pointer hover or keyboard focus opens a separate, wider popover above the trigger. Moving the pointer from the trigger into the popover keeps it open. Leaving both surfaces or moving focus away closes it. The renderer constrains the list to the structured rows produced by the plugin; `maxWidgetLines` bounds that output.

## Compatibility

The plugin sends bounded structured task data as a Desktop-only structural widget option and also supplies plain-text widget lines. Desktop validates the data and renders the native React card. The public Pi extension API is unchanged; hosts that do not support the option render the plain-text fallback instead.

The upstream `Ctrl+Shift+T` terminal shortcut is not registered in Desktop.
