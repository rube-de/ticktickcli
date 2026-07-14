# TickTick CLI

[![npm version](https://img.shields.io/npm/v/@rube-de/ticktickcli.svg)](https://www.npmjs.com/package/@rube-de/ticktickcli)
[![npm downloads](https://img.shields.io/npm/dm/@rube-de/ticktickcli.svg)](https://www.npmjs.com/package/@rube-de/ticktickcli)
[![CI](https://github.com/rube-de/ticktickcli/actions/workflows/ci.yml/badge.svg)](https://github.com/rube-de/ticktickcli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/@rube-de/ticktickcli.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3.14-fbf0df?logo=bun&logoColor=black)](https://bun.sh)

`tt` is an agent-first TickTick command-line client for macOS and Linux. It favors a stable
JSON contract, headless credentials, explicit capability checks, safe mutations, and a
profile-isolated local cache. Human-friendly rendering and quick-add syntax are layered on top
without changing the machine interface.

The CLI uses TickTick's documented v1 API where possible. Features that require the unofficial
v2 API are opt-in and require a separate session credential. TickTick and Dida365 capabilities
are evaluated independently.

## Requirements

- Bun 1.3.14 or newer
- A TickTick personal API token for v1 commands
- Optionally, a TickTick session credential for verified v2-only commands

Windows is not currently a supported release target.

## Install

Install the public release from npm:

```sh
npm install --global @rube-de/ticktickcli
tt --help
```

For a one-off invocation with Bun:

```sh
bunx --package @rube-de/ticktickcli tt --help
```

For repository development:

```sh
bun install --frozen-lockfile
bun link
tt --help
```

## Install with an agent

Two ways to get an agent operating `tt`, either works:

### Option 1: install the skill, then let it install the CLI

If your agent supports [Agent Skills](https://agentskills.io):

```sh
npx skills add rube-de/ticktickcli
```

This installs [`skills/ticktick-cli/SKILL.md`](skills/ticktick-cli/SKILL.md) into your agent's
skill directory. Point the agent at it (skill-aware harnesses like Claude Code load it
automatically when relevant); its first "Establish capability" step runs `scripts/install.sh` to
install `tt` via npm and stops before touching credentials — then follow the same v1/v2 choice
described in [Authenticate without a browser](#authenticate-without-a-browser) below.

### Option 2: copy-paste prompt

Copy and paste this prompt into a coding agent that has terminal access to your macOS or Linux
machine:

```text
Install and verify TickTick CLI (npm package `@rube-de/ticktickcli`, executable `tt`) on this
machine.

Before starting, read the Install and Authenticate without a browser sections in README.md, the
detailed docs/authentication.md guide, and skills/ticktick-cli/SKILL.md. If this is not a source
checkout (skill files only exist locally after install), use these canonical copies:

- https://github.com/rube-de/ticktickcli#install
- https://github.com/rube-de/ticktickcli#authenticate-without-a-browser
- https://github.com/rube-de/ticktickcli/blob/main/docs/authentication.md
- https://github.com/rube-de/ticktickcli/blob/main/skills/ticktick-cli/SKILL.md

Treat those docs and `tt --help` as authoritative; do not invent credential names or commands.

1. Check the operating system and confirm Bun 1.3.14 or newer is available.
2. Prefer `npm install --global @rube-de/ticktickcli` without `sudo`. If npm reports that the
   package does not exist and this is a source checkout, use
   `bun install --frozen-lockfile` followed by `bun link`.
3. Run `tt --version` and `tt --help`, then report the installed executable path and version.
4. Summarize the documented v1 token and v2 session choices and ask which one I want to configure.
   Do not read, print, transmit, or ask me to paste credentials into chat. Use only the documented
   secret-file or stdin flow, and do not authenticate until I explicitly ask you to.
5. Do not modify unrelated files or system-wide configuration.
```

## Authenticate without a browser

The v1 and v2 APIs use independent credentials. Configure either one or both depending on the
commands you need.

### v1 token auth

For the documented v1 API, use a personal API token. The simplest ephemeral setup is an
environment variable:

```sh
export TT_ACCESS_TOKEN="$(< /secure/path/ticktick-token)"
tt auth status --verify --json --no-input
```

Prefer the secret-file form when the harness supports it, because it avoids copying the secret
into multiple process environments:

```sh
export TT_ACCESS_TOKEN_FILE=/secure/path/ticktick-token
tt auth status --verify --json --no-input
```

### v2 session auth

Verified unofficial v2 commands require a TickTick web session. Use either the value of the
authenticated session's `t` cookie or a full Cookie header containing `t=...`. While signed in to
the TickTick web app, copy the cookie locally from your browser's developer tools under
Application or Storage > Cookies. The session is host-specific and is as sensitive as your
password.

For an ephemeral session, place only the `t` cookie value in a protected file:

```sh
export TT_SESSION_TOKEN_FILE=/secure/path/ticktick-session
tt auth status --verify --json --no-input
```

If your integration provides a complete Cookie header instead, use the cookie-file variable:

```sh
export TT_SESSION_COOKIE_FILE=/secure/path/ticktick-cookie-header
tt auth status --verify --json --no-input
```

To validate and save the `t` cookie value in the selected profile, pipe it over stdin:

```sh
read -r -s TT_SESSION
printf '%s' "$TT_SESSION" | tt auth session --stdin
unset TT_SESSION
```

For a full Cookie header, add `--cookie`:

```sh
read -r -s TT_COOKIE
printf '%s' "$TT_COOKIE" | tt auth session --stdin --cookie
unset TT_COOKIE
```

Never put a credential in a positional argument, ordinary flag, chat message, or shell history.
See [Authentication](docs/authentication.md) for credential precedence, saved profiles, logout,
and external OAuth setup.

## Agent workflow

Agents with access to [Agent Skills](https://agentskills.io) should load
[`skills/ticktick-cli/SKILL.md`](skills/ticktick-cli/SKILL.md) first (see
[Install with an agent](#install-with-an-agent) for `npx skills add`); harnesses like Claude Code
do this automatically when it matches. In internal with/without-skill comparisons, agents using it
needed roughly a third to half as many tool calls for the same tasks (3 vs. 9 to correctly diagnose
a missing-capability error, 7 vs. 15 to resolve an ambiguous task title) because exit-code
semantics, credential channel names, and CLI-specific gotchas are stated up front instead of
discovered through trial and error.

Use canonical noun–verb commands, explicit fields, JSON output, and non-interactive mode:

```sh
tt task add \
  --title "Send status report" \
  --project Work \
  --due 2026-07-14 \
  --priority high \
  --dry-run \
  --json \
  --no-input
```

Inspect the dry run, then repeat without `--dry-run` when the mutation is intended. Do not retry
an ambiguous write automatically; a `write_outcome_unknown` response includes reconciliation
guidance.

Every contracted JSON response uses a versioned envelope:

```json
{
  "version": 1,
  "ok": true,
  "data": {},
  "meta": {
    "profile": "default",
    "host": "ticktick.com",
    "source": "v1",
    "stale": false
  }
}
```

Structured output goes to stdout. Diagnostics and progress go to stderr. `--json`,
`--no-input`, non-TTY stdin, and CI mode never open a browser, editor, or picker.

## Documentation

- [Agent Skill](skills/ticktick-cli/SKILL.md) — canonical command patterns for AI agents;
  install with `npx skills add rube-de/ticktickcli` or let skill-aware harnesses auto-load it
- [Authentication](docs/authentication.md)
- [Configuration and profiles](docs/configuration.md)
- [Command and machine contract reference](docs/commands.md)
- [Generated command index](docs/command-index.md)
- [Release process](docs/releasing.md)
- [Implementation plan](docs/implementation-plan.md)
- [API research provenance](docs/reference/README.md)

The installed `tt --help` output is authoritative for the commands present in a particular
release. Source-only or unverified mutations are intentionally omitted from stable help.

## Development

Run the complete local gate:

```sh
just check
```

The equivalent package script is:

```sh
bun run check
```

It runs strict type checking, Biome, generated-document checks, the Bun test suite, and a clean
npm/bunx package smoke test.
Live API tests require `TICKTICK_LIVE=1`, a dedicated disposable account, and explicit local or
trusted-CI credentials; they are never enabled for untrusted pull requests.

## License

MIT. See [LICENSE](LICENSE).
