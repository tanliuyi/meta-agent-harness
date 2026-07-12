# Keybindings

Keyboard shortcuts are configured with namespaced action ids in `~/.pi/agent/keybindings.json`.

The desktop renderer owns the visual editor and picker UI. `packages/coding-agent` keeps the canonical action ids and default bindings so renderer and extensions can share the same configuration shape.

## Key Format

Use `modifier+key`, where modifiers are `ctrl`, `shift`, and `alt`.

Examples:

```json
{
  "desktop.editor.cursorUp": ["up", "ctrl+p"],
  "desktop.editor.cursorDown": ["down", "ctrl+n"],
  "app.tools.expand": "ctrl+o"
}
```

## Desktop Editor

| Keybinding id                       | Default          | Description               |
| ----------------------------------- | ---------------- | ------------------------- |
| `desktop.editor.cursorUp`           | `up`             | Move cursor up            |
| `desktop.editor.cursorDown`         | `down`           | Move cursor down          |
| `desktop.editor.cursorLeft`         | `left`           | Move cursor left          |
| `desktop.editor.cursorRight`        | `right`          | Move cursor right         |
| `desktop.editor.cursorWordLeft`     | `ctrl+left`      | Move cursor word left     |
| `desktop.editor.cursorWordRight`    | `ctrl+right`     | Move cursor word right    |
| `desktop.editor.cursorLineStart`    | `home`           | Move cursor to line start |
| `desktop.editor.cursorLineEnd`      | `end`            | Move cursor to line end   |
| `desktop.editor.pageUp`             | `pageup`         | Page up                   |
| `desktop.editor.pageDown`           | `pagedown`       | Page down                 |
| `desktop.editor.deleteCharBackward` | `backspace`      | Delete previous character |
| `desktop.editor.deleteCharForward`  | `delete`         | Delete next character     |
| `desktop.editor.deleteWordBackward` | `ctrl+backspace` | Delete previous word      |
| `desktop.editor.deleteWordForward`  | `ctrl+delete`    | Delete next word          |
| `desktop.editor.deleteToLineStart`  | `ctrl+u`         | Delete to line start      |
| `desktop.editor.deleteToLineEnd`    | `ctrl+k`         | Delete to line end        |
| `desktop.editor.undo`               | `ctrl+z`         | Undo                      |

## Desktop Input And Selection

| Keybinding id             | Default       | Description          |
| ------------------------- | ------------- | -------------------- |
| `desktop.input.newLine`   | `shift+enter` | Insert newline       |
| `desktop.input.submit`    | `enter`       | Submit input         |
| `desktop.input.tab`       | `tab`         | Tab                  |
| `desktop.input.copy`      | `ctrl+c`      | Copy                 |
| `desktop.select.up`       | `up`          | Select previous item |
| `desktop.select.down`     | `down`        | Select next item     |
| `desktop.select.pageUp`   | `pageup`      | Select previous page |
| `desktop.select.pageDown` | `pagedown`    | Select next page     |
| `desktop.select.confirm`  | `enter`       | Confirm selection    |
| `desktop.select.cancel`   | `escape`      | Cancel selection     |

## Application

| Keybinding id              | Default                       | Description                  |
| -------------------------- | ----------------------------- | ---------------------------- |
| `app.interrupt`            | `escape`                      | Cancel or abort              |
| `app.clear`                | `ctrl+c`                      | Clear editor                 |
| `app.exit`                 | `ctrl+d`                      | Exit when editor is empty    |
| `app.editor.external`      | `ctrl+g`                      | Open external editor         |
| `app.clipboard.pasteImage` | `ctrl+v` (`alt+v` on Windows) | Paste image from clipboard   |
| `app.tools.expand`         | `ctrl+o`                      | Toggle tool output expansion |
| `app.thinking.toggle`      | `ctrl+t`                      | Toggle thinking blocks       |
| `app.thinking.cycle`       | `shift+tab`                   | Cycle thinking level         |
| `app.model.select`         | `ctrl+l`                      | Open model selector          |
| `app.model.cycleForward`   | `ctrl+p`                      | Cycle to next model          |
| `app.model.cycleBackward`  | `shift+ctrl+p`                | Cycle to previous model      |

## Sessions And Tree

| Keybinding id                   | Default                   | Description                |
| ------------------------------- | ------------------------- | -------------------------- |
| `app.session.new`               | none                      | Start a new session        |
| `app.session.tree`              | none                      | Open session tree          |
| `app.session.fork`              | none                      | Fork current session       |
| `app.session.resume`            | none                      | Resume a session           |
| `app.session.rename`            | `ctrl+r`                  | Rename session             |
| `app.session.delete`            | `ctrl+d`                  | Delete session             |
| `app.tree.foldOrUp`             | `ctrl+left`, `alt+left`   | Fold branch or move up     |
| `app.tree.unfoldOrDown`         | `ctrl+right`, `alt+right` | Unfold branch or move down |
| `app.tree.editLabel`            | `shift+l`                 | Edit tree label            |
| `app.tree.toggleLabelTimestamp` | `shift+t`                 | Toggle label timestamps    |

## Model Selector

| Keybinding id               | Default    | Description                    |
| --------------------------- | ---------- | ------------------------------ |
| `app.models.save`           | `ctrl+s`   | Save model selection           |
| `app.models.enableAll`      | `ctrl+a`   | Enable all models              |
| `app.models.clearAll`       | `ctrl+x`   | Clear all models               |
| `app.models.toggleProvider` | `ctrl+p`   | Toggle all models for provider |
| `app.models.reorderUp`      | `alt+up`   | Move model up                  |
| `app.models.reorderDown`    | `alt+down` | Move model down                |
