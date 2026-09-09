# Todo plugin API

Canonical plugin ID: `rpiv.todo`

## `todo(args)`

Manage the current session's structured task list.

```ts
const result = await plugin["rpiv.todo"].todo(args);
```

### Common arguments

- `action`: required; `create`, `update`, `list`, `get`, `delete`, or `clear`
- `subject`: short imperative title; required for `create`
- `description`: optional long-form details
- `activeForm`: present-continuous label shown for active work
- `status`: `pending`, `in_progress`, `completed`, or `deleted`; used by `update` and as a `list` filter
- `id`: positive task ID; required for `update`, `get`, and `delete`
- `blockedBy`: initial dependency IDs for `create`
- `addBlockedBy` / `removeBlockedBy`: dependency changes for `update`
- `metadata`: arbitrary key-value data; a null value deletes that key during update
- `includeDeleted`: include deleted tombstones in `list`

### Examples

Create:

```ts
return await plugin["rpiv.todo"].todo({
  action: "create",
  subject: "Verify Desktop tests",
  activeForm: "verifying Desktop tests"
});
```

Start work:

```ts
return await plugin["rpiv.todo"].todo({
  action: "update",
  id: 1,
  status: "in_progress"
});
```

Complete:

```ts
return await plugin["rpiv.todo"].todo({
  action: "update",
  id: 1,
  status: "completed"
});
```

List active tasks:

```ts
return await plugin["rpiv.todo"].todo({
  action: "list",
  status: "in_progress"
});
```

### Result

The run_code method returns:

- `text`: a textual summary of the operation

The plugin writes a bounded custom session snapshot after each effective mutation so reload, tree navigation, and compaction can restore state. Validation failures are returned as text; runtime failures may throw.
