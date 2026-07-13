---
name: ticktick-cli
description: Operate TickTick or Dida365 through the agent-first `tt` command-line interface. Use when an agent needs to inspect, create, edit, complete, organize, search, sync, or report on tasks, projects, tags, habits, focus records, calendar data, profiles, or CLI authentication while preserving deterministic JSON, headless operation, and safe mutation semantics.
---

# TickTick CLI

Use canonical noun–verb commands with `--json --no-input`. Treat the JSON envelope and process exit
code as the contract; never scrape human tables when JSON is available.

## Establish capability

1. Run `tt auth status --verify --json --no-input` when network capability is unclear.
2. Read `data.mode`, `data.fullCoverage`, and account-match state without printing credential data.
3. Use v1 commands with a personal API token and v2-only commands with a verified session.
4. Treat `capability_missing` as a request for the missing credential, not permission to obtain one.
5. Never launch OAuth, request a password, or extract a session from a browser.

Accept credentials only through `TT_ACCESS_TOKEN`, `TT_ACCESS_TOKEN_FILE`, `TT_SESSION_TOKEN`,
`TT_SESSION_TOKEN_FILE`, `TT_SESSION_COOKIE`, `TT_SESSION_COOKIE_FILE`, or stdin-based auth commands.
Never place a secret in argv, logs, fixtures, messages, or generated files.

## Read deterministically

Use explicit freshness and profile flags when they matter:

```sh
tt task list project:Work status:open --json --no-input --fresh
tt today --profile work --json --no-input
tt search "quarterly report" --json --no-input --stale-ok
```

Interpret `meta.source`, `meta.fetchedAt`, and `meta.stale`. Use `--offline` only when network access
must be forbidden. Do not combine `--fresh`, `--stale-ok`, and `--offline`.

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

- Use `tt cache clear` separately from `tt auth logout`; one must not imply the other.
- Do not assume TickTick and Dida365 wire behavior is identical.
- Do not use source-only or unverified raw mutations.
- Use `tt api get` only with a relative path on the configured origin.
- Prefer canonical commands over user aliases in reusable automation.
- Do not allow a human picker, browser, or editor in JSON, CI, non-TTY, or `--no-input` mode.
