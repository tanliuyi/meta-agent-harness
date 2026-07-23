# Desktop application updates

## Release source order

Packaged Desktop builds check update sources in this order:

1. Mirror base URLs compiled from `PI_DESKTOP_UPDATE_URLS`.
2. `tanliuyi/meta-agent-harness` GitHub Releases.

`PI_DESKTOP_UPDATE_URLS` accepts either a JSON string array or a semicolon/newline-separated list:

```text
PI_DESKTOP_UPDATE_URLS=["https://cdn.example.com/meta-agent/","https://backup.example.com/meta-agent/"]
```

The value is read by `electron.vite.config.ts` during the build and embedded in the main-process bundle. It is not a runtime end-user environment variable.

Each mirror must preserve the relative artifact names produced by `electron-builder`, including the platform channel metadata (`latest*.yml`), installers/archives, and blockmaps. The URL is a directory base, not a direct installer URL.

## Fallback behavior

- Update checks try each source in order until one returns valid metadata.
- A reachable source reporting no newer version is authoritative and stops the check.
- If an installer download fails, Desktop checks the next source again and downloads only when it advertises the same version. This prevents metadata from one release being combined with a different release's installer.
- `electron-updater` remains responsible for platform signature checks, SHA-512 validation, differential download, and installation.
- Development builds report updates as unsupported. Packaged builds check ten seconds after startup and every four hours, and also support manual checks from Settings > About.

## Publishing

`electron-builder.yml` publishes update metadata and artifacts to the GitHub repository. Mirror synchronization should run after the GitHub release artifacts are complete so a mirror never exposes metadata before its referenced files are available.
