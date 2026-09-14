# Install Waypoint

Waypoint runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

Command-line use, SSH hosts, and WSL backends need Node.js 22.19+ (22.x), 23.11+
(23.x), or 24.10 and later. The native desktop app includes its server runtime.

You need an installed, authenticated provider before starting a thread. You can
launch Waypoint and configure providers afterwards.

## Run from this source tree

Waypoint does not currently publish an npm package, desktop release, mobile app,
or package-manager formula. Do not run `npx waypoint` until a Waypoint-owned
package has been configured.

```bash
pnpm install
pnpm --filter waypoint build:bundle
node apps/server/dist/bin.mjs
```

The last command starts the server and opens the local web app. Add `--help` for
command-line options.

## Desktop app

Build a local desktop artifact with the relevant `dist:desktop:*` script in the
root `package.json`. Release downloads and package-manager installs will be
documented after Waypoint owns those distribution channels.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install Node.js and provider CLIs inside that distro. Waypoint installs its
matching server runtime there automatically; the first launch after an app
update can take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
node apps/server/dist/bin.mjs app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `node apps/server/dist/bin.mjs app ../my-project`, to open
another directory. It requires the desktop app, so a standalone server or an SSH
session is not enough. If the command cannot reach the app, start or update the
desktop app and try again.

## Mobile app

Build the Waypoint mobile app from this source tree; no Waypoint-owned App Store
or Google Play listing exists yet.
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to link it through Waypoint Connect or a pairing URL.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| Codex       | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.        |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`. |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                        |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                           |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                     |
| Antigravity | Install and sign in with Google from Waypoint's provider settings.                           |

Provider CLIs must be on the server's `PATH`. If Waypoint cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Antigravity can use its managed runtime without a `PATH` entry.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** appears only when Waypoint can tell which
installer owns the CLI (its own update command, Homebrew, or a global npm, pnpm,
bun, or Vite+ install) and runs that installer. Otherwise update the CLI the same
way you installed it. Homebrew installs compare against the version Homebrew
offers, which can trail the npm release by a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Waypoint does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md), and
[Antigravity](./providers-antigravity.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating Waypoint](./updating.md): update the app and connected servers.
