# Waypoint

Waypoint is a local-first desktop GUI for coding-agent harnesses. Bring your own
provider subscription and work with Codex, Claude Code, Cursor, Grok Build,
OpenCode, Google Antigravity, and Pi from one workspace.

Waypoint is a fork of [T3 Code](https://github.com/pingdotgg/t3code), with selected
UX ideas and presentation elements informed by
[FACT3](https://github.com/yappologistic/FACT3). See [LICENSE](./LICENSE) for the
upstream license and attribution.

## Status

This is an early alpha. The desktop app is the supported development target;
mobile builds are deliberately paused while the desktop workflow is validated.

## Build the desktop app

See [Desktop builds](./docs/operations/desktop-build.md) for prerequisites,
development, and distributable artifacts. The short version is:

```bash
vp i
vp run build:desktop
vp run start:desktop
```

On Linux, install `pkg-config` and the `libsecret` development headers first.

## Runtime isolation

Waypoint keeps its data separate from T3 Code under `~/.waypoint` (or
`WAYPOINT_HOME`). Desktop identifiers, URL schemes, browser partitions, and
local storage also use the Waypoint name, so both apps can coexist.

## Roadmap

See [ROADMAP.md](./ROADMAP.md).
