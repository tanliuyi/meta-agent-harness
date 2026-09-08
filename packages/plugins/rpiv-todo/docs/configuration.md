# Configuration

Meta Agent Desktop supplies plugin configuration through `pi.getConfig()`.

| Field | Type | Default | Range | Purpose |
| --- | --- | --- | --- | --- |
| `maxWidgetLines` | number | `12` | `4`–`40` | Maximum total rows rendered when the Composer panel is expanded. |

The value is normalized to an integer. Missing or invalid values fall back to `12`.

The Desktop adaptation does not read an upstream dotfile and does not expose terminal shortcut configuration.
