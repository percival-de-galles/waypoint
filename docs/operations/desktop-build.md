# Build the desktop app

Waypoint's current release target is the Electron desktop application. Mobile
packages are intentionally excluded from the workflow below.

## Prerequisites

- Node.js 24.x
- Vite+ (`vp`)
- The repository dependencies installed with `vp i`

On Ubuntu or Debian, install the native prerequisites before building:

```bash
sudo apt update
sudo apt install build-essential pkg-config libsecret-1-dev
```

`libsecret-1-dev` is required by the desktop browser-secret helper. Without it,
the Electron build stops before packaging.

For other Linux distributions, install the equivalent C/C++ build tools,
`pkg-config`, and libsecret development package. macOS and Windows require the
usual Electron build prerequisites for their platform.

## Development desktop app

Run the desktop development loop from the repository root:

```bash
vp run dev:desktop
```

In a linked Git worktree, development state defaults to that worktree's
`.waypoint` directory. In a source snapshot or ordinary checkout, explicitly
choose an isolated home directory:

```bash
env PATH="$PWD/node_modules/.bin:$PATH" \
  node scripts/dev-runner.ts dev:desktop --home-dir "$PWD/.waypoint"
```

Do not point a development run at an installed Waypoint or T3 Code data
directory. The server applies database migrations during startup.

## Build and run locally

Build the packaged desktop application and run its Electron entry point:

```bash
vp run build:desktop
vp run start:desktop
```

The build creates the desktop Electron output and bundles the local server and
web client it needs. It does not build the mobile app.

## Produce release artifacts

Use the platform-specific artifact command from the repository root:

```bash
# Linux x64 AppImage
vp run dist:desktop:linux

# macOS DMG
vp run dist:desktop:dmg

# Windows NSIS installer
vp run dist:desktop:win
```

Cross-platform artifacts should be built on their target platform or a
maintained CI runner with the required signing and native-build tooling.

## Publish from GitHub Actions

Push a version tag such as `v0.1.0`. The `Desktop release` workflow builds
unsigned macOS (Apple Silicon and Intel), Windows x64, and Linux x64 binaries
on their native GitHub-hosted runners, then attaches them to that GitHub
Release. Rerun a failed tagged workflow from the Actions tab rather than
building an artifact locally.

Unsigned macOS and Windows builds will prompt users on first launch. Add
platform signing credentials only when the project is ready to distribute
trusted, notarized installers.

Before publishing an artifact, smoke-test it with:

```bash
vp run test:desktop-smoke
```

## Mobile is paused

Do not run mobile build, store, or release commands as part of the Waypoint
desktop release workflow. Mobile support remains in the source tree, but it is
not a tested or supported release target yet.
