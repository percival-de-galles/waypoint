# Waypoint roadmap

Waypoint is becoming a focused desktop workspace for people who already use
coding-agent subscriptions. The immediate goal is a dependable local app before
expanding the product surface.

## Now

- Stabilize the Waypoint rebrand, isolated data paths, desktop identifiers, and
  provider setup.
- Finish Pi as an early-access provider and validate usage reporting across
  Codex, OpenCode, Antigravity, Claude, and Pi.
- Refine the working experience: agent activity detail, concise tool output,
  clearer limits, and accessible command-palette actions.
- Validate the manual project board: Queue, Running, Review, and Done with
  durable ordering and safe, reversible lifecycle actions.

## Next

- Make the board more useful without adding an autonomous scheduler: richer
  review context, project-level filtering, and stronger source-control links.
- Continue desktop reliability work: startup recovery, provider diagnostics,
  safe update paths, and installable Linux, macOS, and Windows artifacts.
- Improve remote use from the desktop host while preserving a local-first
  default and explicit pairing.
- Add focused regression coverage for provider usage meters and agent activity.

## Later

- Align the board with a stable orchestration-v2 model when that architecture
  is production-ready upstream. Waypoint will not import an unmerged automation
  scheduler merely to imitate a board.
- Explore optional, user-controlled workflows after manual queue and review
  behavior is proven reliable.
- Publish signed desktop releases and establish a Waypoint-owned update and
  distribution path.

## Deliberately not in scope yet

- Mobile builds and mobile-store releases. They stay paused until the desktop
  app, provider integrations, and core interaction model have been tested end
  to end.
- FACT3's autonomous worktree, verification, integration, and pull-request
  delivery backend.
- A Waypoint theme system; product focus is workflow clarity and reliability.
