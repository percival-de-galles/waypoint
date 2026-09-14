# Pi

Waypoint embeds the Pi SDK. Authenticate Pi on the machine running the environment,
then enable **Pi** in **Settings > Providers**. By default, Waypoint reads models,
credentials, settings, skills, prompts, and extensions from `~/.pi/agent`. Set **Pi
agent directory** when that configuration lives elsewhere.

Pi skills and commands discovered for the current project appear in the composer.
Use `$` to invoke a skill. Pi sessions support streaming, extension questions,
cancellation, compaction, and resume, but not conversation rollback. Because the SDK
does not expose interactive tool approvals, restricted turns use read-only tools.

## Context and account limits

Waypoint can show Pi's current-thread context consumption because Pi reports request token
usage and each selected model's context window. This is different from a subscription quota.
Pi itself does not expose an account-wide allowance or reset schedule, so Waypoint does not
turn a model context ceiling into a limit bar.

One exception is an OpenCode Go model: when Pi resolves its `opencode-go` credential,
Waypoint reads OpenCode Go's separate account usage endpoint and shows its 5-hour, weekly,
and monthly allowance under **Usage → Limits**. The same account can therefore be tracked
while you use Pi instead of the OpenCode harness.

## Check the integration

Run an isolated check without starting the server:

```bash
waypoint doctor pi /path/to/project
```

The check copies `auth.json` and `models.json` into temporary storage before loading
them. It does not read or write Waypoint's persistent state, and it does not make a
model request unless you pass `--prompt`.

```bash
waypoint doctor pi /path/to/project --prompt "Reply exactly PI_OK"
```

The live check uses the first available model, disables every tool, keeps the session
in memory, and consumes one provider request. Use `--agent-dir /path/to/pi/agent` for
a non-default Pi configuration or `--json` for machine-readable output.

If no models are available, authenticate Pi in that agent directory and run the
check again. Resource diagnostics name malformed skills, prompts, or extensions that
Pi could not load.
