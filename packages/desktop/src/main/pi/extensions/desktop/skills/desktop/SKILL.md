---
name: desktop
description: "Inspect, debug, configure and verify the Desktop application, including its windows, renderer, main-agent profiles and local plugin runtime."
---

# Desktop

Call `plugin["desktop"].method({...})` inside `run_code`. Methods return `{text}`; parse JSON text for structured results. `screenshot` attaches a PNG image. Read [the API reference](references/api.md) for all parameter schemas. This plugin controls Desktop application windows and the currently calling agent worker.

## Inspect, debug, modify, verify

Start with `inspect({})` to read Electron/runtime versions and application window IDs. Pass `windowId` for deterministic targeting; otherwise the host selects a focused application window, then the first live window. `navigation_state` reads the application router. `window_action` supports show, focus, minimize, maximize, restore and set_bounds.

```ts
const windows = JSON.parse((await plugin["desktop"].inspect({})).text);
const windowId = windows.windows[0].windowId;
await plugin["desktop"].cdp_send({windowId, method:"Runtime.enable"});
const before = await plugin["desktop"].evaluate({windowId, expression:"document.title"});
await plugin["desktop"].navigate({windowId, path:"/settings/personalization"});
return {before, route: await plugin["desktop"].navigation_state({windowId})};
```

`evaluate` executes JavaScript in the main renderer, awaits promises and returns a CDP result envelope. JavaScript exceptions throw an explicit error. Use it to inspect UI/DOM state or experiment with temporary changes; DOM and in-memory changes do not persist across reloads. Persist supported settings through configuration methods. Expressions can read application data and cause side effects; this is trusted automation, not a JavaScript sandbox.

`cdp_send` accepts a method and optional `paramsJson` containing a JSON object. Supported domains are Accessibility, DOM, DOMSnapshot, CSS, Runtime, Input, Network, Log, Page, Emulation and Performance. Target/Browser commands and direct page navigation/reload/close are rejected. CDP protocol errors throw; inspect exceptionDetails when using raw Runtime commands. No arbitrary main-process evaluation or IPC dispatch is provided.

`screenshot` captures the application renderer viewport. `cdp_events` reads console, exception, network and other CDP events after their domains have been enabled. For console/errors, call `cdp_send({method:"Runtime.enable"})`, reproduce the behavior, then `cdp_events({after:0,limit:20})`. Advance `after` to the last returned event sequence. Sequences remain monotonic for the same window across debugger detach/reattach. Reattachment discards the old buffer and adds those discarded events to dropped; events occurring while detached cannot be observed. `latestSequence` and `dropped` report buffer position and loss; reads may stop early to fit the output budget. An existing debugger owner produces an error. Window closure or application shutdown releases debugger resources.

`navigate` changes the SPA route and returns requestedPath, reached, path, href, status and isLoading. It refuses navigation while a settings editor has unsaved changes. Redirects may return reached=false; inspect the observed route before claiming success. Supported routes: `/`, `/new`, `/plugins`, `/settings`, `/settings/personalization`, `/settings/keyboard`, `/settings/models`, `/settings/auth`, `/settings/extensions`, `/settings/browser`, `/settings/memory`, `/settings/auto-title`, `/settings/subagents`, `/settings/agents`, `/settings/archives`, `/settings/dependencies`, `/settings/about`, and `/projects/{projectId}/session/{threadId}` using existing route-safe IDs. External URLs, query strings and fragments are not accepted.

## Persistent application settings

`get_settings` returns the settings snapshot and revision. `update_settings` accepts expectedRevision and a partial patch for showThinking, autoExpandRunning, showAvatars, messageWidth, userName and userAvatarPath. Saved updates notify open renderers. Width follows the application's clamping rules; null means full width. A stale revision returns conflict and the current snapshot; reconsider the patch before retrying.

```ts
const current = JSON.parse((await plugin["desktop"].get_settings({})).text);
return await plugin["desktop"].update_settings({expectedRevision:current.revision, patch:{showThinking:false}});
```

## Create a specialist main agent

`main_agents({offset:0,limit:20})` returns a byte-bounded page of profile summaries, the store revision/default, available tools/plugins and the configuration schema. Follow nextOffset until null for all summaries; if the store revision changes between pages, restart the listing. Summaries omit configuration. `get_main_agent({id})` returns one complete profile when small, or a serialized JSON chunk when large. Join chunk strings using nextOffset (UTF-16 code-unit offsets), passing expectedRevision on every subsequent read, then JSON.parse the combined string. A conflict returns the current store revision; discard partial chunks and restart. Chunk limits measure UTF-8 bytes after JSON escaping, so Unicode and escaped text remain recoverable.

`validate_main_agent` validates without saving and returns valid plus the normalized name without echoing configuration. `save_main_agent` accepts create, update or set-default with expectedRevision. Saved acknowledgements contain status, revision and the affected profile's id/revision/name/builtin; conflict contains status and the current store revision. Fetch the complete profile before updating, including its id, revision and builtin flag. Saved profiles apply to newly created sessions; existing sessions keep their creation-time profile snapshots.

```ts
const {snapshot} = JSON.parse((await plugin["desktop"].main_agents({})).text);
const profile = {
  name:"Graphic Designer", description:"Layout, typography and print design",
  configuration:{
    prompt:{mode:"append",text:"Specialize in graphic design. Check typography, layout and output dimensions.",includeGlobalRules:true,includeProjectRules:true,includeSkills:true},
    tools:["read","write","edit","run_code"], builtinPluginIds:["desktop"]
  }
};
await plugin["desktop"].validate_main_agent({profile});
return await plugin["desktop"].save_main_agent({mutation:{action:"create",expectedRevision:snapshot.revision,profile}});
```

Prompt mode is default, append or replace; replacement text cannot be blank. Null tools/builtinPluginIds preserves defaults; an empty array deliberately disables all configurable entries. Keep run_code and desktop enabled when this agent should control Desktop. Read the catalog instead of guessing IDs. Change the default only when requested, using a fresh store revision.

## Develop, approve, configure, reload and verify a plugin

Write the plugin's source/manifest with the normal file tools. Then:

1. Call `plugins` to read persisted approvals, Developer Mode and applied/desired worker generations.
2. If needed, call `set_developer_mode({requestId,expectedRevision,enabled:true})` with a fresh persisted revision.
3. Call `load_local_plugin({requestId,expectedRevision,path})` with an absolute local directory or entry path. The existing native file/directory approval dialog opens at that path; the user must select the trusted extension. Cancelled approval does not load code.
4. Read `plugin_configuration({pluginId})`. Use the returned development:<id> approval ID for local configuration. Save with `save_plugin_configuration({requestId,pluginId,expectedRevision,valuesJson})`; the service validates values and returns saved, invalid or conflict. Optional secretValuesJson contains secret strings and clearSecrets contains keys to clear. Secret storage uses the host's encryption; read snapshots expose presence flags, never secret plaintext. Obtain secrets from an authorized credential source, do not embed or print them in generated code/results.
5. Call `reload_plugins` and end the current turn. Supply a continuation to let the reloaded agent verify the result:

```ts
return await plugin["desktop"].reload_plugins({
  requestId:"design-plugin-reload-1",
  continuation:"Inspect plugin_runtime for design.tools, check diagnostics, and exercise its read-only inspection method."
});
```

The initial request schedules work; it does not prove application. Reload waits for the agent to settle, outstanding commands to finish and metadata writes to complete. It uses the existing controlled resource reload/worker replacement and never aborts a busy worker. The same generation still reloads source resources. `reload_status({requestId})` reports scheduled, applying, applied or failed, worker identity, generation and any error. A supplied continuation becomes a new verification prompt after application; check continuationAccepted/error. Without continuation, a later turn must verify. Requests are scoped to the calling thread and retained in bounded application-lifetime history, not across application restarts.

`plugin_runtime({pluginId})` reads the calling worker's actual loaded extension paths, captured method schemas/catalog, native tools, skills, phase and diagnostics. Omit pluginId for all captured methods; filter if the output is too large. `plugins` reports persisted configuration separately. Only an applied reload plus actual loaded/captured metadata supports a claim that a plugin is running. A failed or rolled-back load must be reported as such.

## Limits and recovery

Desktop requests are limited to 64 KiB, JSON results to 48 KiB and screenshot transport to 4 MiB. Host operations time out after 15 seconds, except native local approval (60 seconds). Evaluation/navigation use 10-second limits. Each window retains 200 CDP events, at most 8 KiB each; reads return at most 100 events and about 40 KiB. Abort and window destruction end pending waits. Commands already issued, navigation already started and atomic saves may finish after caller cancellation; inspect state before retrying a mutation. Ordinary runtime controls do not add per-call confirmation dialogs; local extension trust approval and dirty-editor protection remain active.
