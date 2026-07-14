---
name: ticktick-cli
description: Operate TickTick or Dida365 through the agent-first `tt` command-line interface. Use when an agent needs to inspect, create, edit, complete, organize, search, sync, or report on tasks, projects, tags, habits, focus records, calendar data, profiles, or CLI authentication - even if the request doesn't name TickTick or Dida365, e.g. 'add this to my to-do list', 'mark that done', or 'log a pomodoro'.
---

# TickTick CLI

Use canonical noun–verb commands with `--json --no-input`. Treat the JSON envelope and process exit
code as the contract; never scrape human tables when JSON is available.

## Establish capability

1. If `tt` is not on PATH, run `scripts/install.sh` from this skill's directory. It installs the
   published package via npm and stops before touching credentials.
2. Run `tt auth status --verify --json --no-input` when network capability is unclear.
3. Read `data.mode`, `data.fullCoverage`, and account-match state without printing credential data.
4. Use v1 commands with a personal API token and v2-only commands with a verified session.
5. Treat `capability_missing` as a request for the missing credential, not permission to obtain it.
6. Never launch OAuth, request a password, or extract a session from a browser — these flows can't be
   observed in a headless run and would bypass the accepted credential channels below.

Accept credentials only through `TT_ACCESS_TOKEN`, `TT_ACCESS_TOKEN_FILE`, `TT_SESSION_TOKEN`,
`TT_SESSION_TOKEN_FILE`, `TT_SESSION_COOKIE`, `TT_SESSION_COOKIE_FILE`, or stdin-based auth commands.
Never place a secret in argv, logs, fixtures, messages, or generated files.

## Gotchas

- `tt cache clear` and `tt auth logout` are independent stores: clearing the cache never touches
  credentials, and logging out never touches the cache. Clearing one does not imply the other.
- `data.fullCoverage` means a v1 token AND a v2 session are both present at once (`mode: "hybrid"`) —
  it does not mean "fully authenticated." A single valid credential still reports `fullCoverage: false`.
- A v1 token is not enough for every mutation: `task pin/unpin`, `project archive/unarchive`, and
  focus/organization writes require a verified v2 session even when a valid v1 token exists.
- Dida365 is excluded from the v1 API entirely — v1 read/write only works against TickTick hosts, so
  never assume wire behavior is interchangeable between the two.
- `tt api get` rejects any absolute or protocol-relative path, and rejects a relative path that
  resolves to a different origin than the one configured.
- `write_outcome_unknown` means either a post-write readback found zero or multiple matching
  candidates, or a transport failure happened mid-write. Re-read the resource to reconcile state
  before retrying — there is no single fixed lookup command for this.

## Read deterministically

Use explicit freshness and profile flags when they matter:

```sh
tt task list project:Work status:open --json --no-input --fresh
tt today --profile work --json --no-input
tt search "quarterly report" --json --no-input --stale-ok
```

Interpret `meta.source`, `meta.fetchedAt`, and `meta.stale`. Use `--offline` only when network access
must be forbidden. Do not combine `--fresh`, `--stale-ok`, and `--offline` — they express contradictory
freshness intents and are validated as mutually exclusive, so combining any two fails before the
command runs.

Resolve IDs from command results. Prefer exact IDs, then exact normalized names, then unique ID
prefixes of at least four characters. Never choose among ambiguous candidates in non-interactive
mode.

## Mutate safely

Prefer explicit flags over natural-language quick-add. For a complex or destructive change:

1. Run the same command with `--dry-run --json --no-input`.
2. Verify the normalized target, profile, host, capability, and fields.
3. Remove `--dry-run` only when the requested mutation is clear.
4. Add `--yes` for a destructive non-interactive operation.
5. Read every per-item result in a batch.

Example:

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

Never blindly retry a create, comment, check-in, focus write, or any response with
`write_outcome_unknown`. Follow the returned reconciliation guidance first. A partial batch exits
nonzero while preserving successes and failures; do not discard the successful items.

## Interpret errors

Map exit codes before deciding the next action:

| Exit | Meaning | Agent response |
|---:|---|---|
| 0 | Success | Consume `data` |
| 2 | Invalid input | Correct arguments; do not retry unchanged |
| 3 | Auth or capability missing | Request the named credential/capability |
| 4 | Not found or ambiguous | Use returned candidate IDs or refresh explicitly |
| 5 | Conflict or partial failure | Inspect every item and reconcile |
| 6 | Network, rate limit, or unknown write outcome | Honor guidance; never assume failure |
| 7 | Protocol drift | Stop mutation and report incompatibility |
| 8 | Local state failure | Diagnose config/cache without deleting credentials |

Structured results belong to stdout. Treat stderr as redacted diagnostics, never as an alternate
data channel. Preserve the envelope even when selecting fields.

## Preserve boundaries

- Do not use source-only or unverified raw mutations — they bypass the dry-run/verify contract above.
- Prefer canonical commands over user aliases in reusable automation — aliases are user-local and may
  not exist in another environment or agent session.
- Do not allow a human picker, browser, or editor in JSON, CI, non-TTY, or `--no-input` mode — these
  modes assume no human is present to respond.
