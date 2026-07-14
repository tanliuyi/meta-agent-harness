# Upstream Source

This headless UI package is vendored from the official TanStack AI repository:

- Repository: https://github.com/TanStack/ai
- Package path: `packages/ai-vue-ui`
- Commit: `5fcaf90dc82bc20b8c7a75faa3c129da04858af5`
- Imported version: `0.2.31`
- License: MIT, retained in `LICENSE`

## Local adaptations

- Replaced the upstream monorepo `workspace:*` dependency on `@tanstack/ai-vue` with the matching published version `0.14.3`.
- Made build and test tooling explicit because the upstream monorepo normally provides it from the root workspace.
- Inlined the upstream TypeScript base options so this package does not inherit unrelated settings from the Meta Agent root config.
- Added a `test` alias so the package participates in this repository's recursive test command.
- Pointed the workspace export at `src/index.ts` so desktop development consumes the vendored source without requiring a generated `dist` directory.
- Added `threadId` and `live` pass-through props to `Chat`, allowing an AG-UI subscription transport to use a stable desktop thread and receive idle server-pushed snapshots.
