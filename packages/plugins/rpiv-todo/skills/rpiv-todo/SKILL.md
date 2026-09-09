---
name: rpiv-todo
description: Manage the current session's structured task list through the rpiv.todo run_code plugin method.
---

# Todo

Use this skill when work has multiple steps, when the user gives a task list, or when progress should remain visible in Desktop's Session Info Panel.

## Calling the plugin

Call the generation-scoped plugin method through `run_code`:

```ts
return await plugin["rpiv.todo"].todo({
  action: "create",
  subject: "Implement native panel",
  activeForm: "implementing native panel"
});
```

Use one call per state transition so the Session Info task list updates immediately. Independent read-only operations may be composed in one `run_code` program when useful.

## Workflow

1. Create concise imperative tasks.
2. Set exactly one actionable task to `in_progress` before beginning it.
3. Mark a task `completed` immediately after it is fully verified.
4. Use `blockedBy`, `addBlockedBy`, and `removeBlockedBy` for real dependencies.
5. Never mark partial, failing, or blocked work complete.
6. Use `list` or `get` to inspect current state before an uncertain mutation.
7. Use `delete` for one tombstone and `clear` only when the entire list should reset.

## API reference

Read [references/api.md](references/api.md) for the exact method arguments, action requirements, statuses, and return envelope.
