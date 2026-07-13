# Configuration and profiles

TickTick CLI keeps configuration, credentials, cache databases, and logs in separate
platform-correct locations derived from the stable application identifier `ticktickcli`.
Use CLI commands rather than depending on a hard-coded filesystem path.

## Profiles and hosts

A profile selects credentials, host, timezone, and cache isolation:

```sh
tt profile list
tt profile add work
tt profile use work
tt profile remove work --yes
```

Override the saved profile for one process with `--profile` or `TT_PROFILE`. Select the service
host with configuration or `TT_HOST`. TickTick and Dida365 use separate capability results and
separate cache databases even when profile names match.

Profile names are validated before being mapped to paths. Do not move or share a cache database
between profiles or hosts.

## Configuration commands

```sh
tt config get
tt config get profiles.default.timeZone
tt config set profiles.default.timeZone Europe/Zurich
tt config set profiles.default.host ticktick.com
```

`config.json` contains non-secret settings only. Credentials are stored separately and are never
returned by `tt config get`.

## Timezone precedence

Date boundaries and natural-language dates use this order:

1. An explicit command flag.
2. The saved profile timezone.
3. A verified account timezone.
4. The operating system's IANA timezone.

Use an IANA name such as `Europe/Zurich`, not a fixed abbreviation such as `CET`. All-day tasks
remain calendar dates and are not shifted through UTC. Timed values preserve their declared
timezone and use an explicit DST disambiguation policy.

## Cache freshness

Read commands use the cache according to these mutually exclusive flags:

| Flag | Behavior |
|---|---|
| default | Render a fresh cache; synchronously refresh a stale cache before rendering |
| `--fresh` | Force a network refresh |
| `--stale-ok` | Return available stale data immediately without background work |
| `--offline` | Forbid network access and fail if required local data is absent |

JSON metadata identifies the source, fetch time, and stale state. Mutations are always online;
there is no offline mutation queue in the stable release.

```sh
tt cache status --json --no-input
tt sync --full --json --no-input
tt cache clear --yes --no-input
```

Cache clearing is independent of credential logout.

## Output and input policy

Common global flags include:

| Flag | Purpose |
|---|---|
| `--json` | Emit the versioned machine envelope |
| `--fields a,b` | Filter fields inside `data`, never envelope fields |
| `--plain` | Disable decorative table output |
| `--csv` | Emit correctly quoted CSV data |
| `--profile NAME` | Select a profile for this command |
| `--no-input` | Reject missing input instead of prompting |
| `--verbose` | Send redacted diagnostics to stderr |

`--json`, `--no-input`, CI mode, and non-TTY stdin prohibit pickers, editors, and browser launches.
`--yes` bypasses confirmation only; it does not choose a default or make an ambiguous command
deterministic.

## Contexts and aliases

Contexts provide saved, explicit command defaults:

```sh
tt context list
tt context use work
tt context off
```

Aliases expand CLI tokens only:

```sh
tt alias set mine task list project:Personal
tt alias list
tt alias remove mine
```

Aliases never invoke a shell. Recursive expansion and cycles are rejected. Agents should prefer
canonical noun–verb commands because their grammar is the stable automation contract.

## Shell completion

Generate completion text without modifying shell startup files:

```sh
tt completion bash > ~/.local/share/bash-completion/completions/tt
tt completion zsh > ~/.zfunc/_tt
tt completion fish > ~/.config/fish/completions/tt.fish
```

Review paths for your shell and package manager. Generation writes only to stdout; redirection is
controlled by the caller.
