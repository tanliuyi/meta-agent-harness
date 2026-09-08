# Upstream

- Repository: https://github.com/narumiruna/pi-extensions
- Package: `packages/pi-goal`
- npm version: `@narumitw/pi-goal@0.54.4`
- Commit: `d55a76fa01153ff20bedda25625c5edc5cf810b7`
- npm tarball SHA-1: `ac26c3ea907bde43a311620726f0afb4e2fddc98`
- npm tarball integrity: `sha512-WqGGYnX5YBaEUlkC2Lh3sFHizJ6/hiGBijybOBv/7RRDZvpMdfygORIl5OHhzqSPekC9+z0ROxiCzPE6hS17jQ==`
- License: MIT, retained in `LICENSE`

## Desktop adaptations

- Vendored runtime source uses repository-local TypeScript imports.
- The dynamic `pi-tui-kit` goal/settings menu is replaced by native Desktop React controls.
- Goal state and actions are exposed through a session-scoped Desktop service.
- The TUI-specific tool result renderer is omitted; Desktop renders normal tool results.
