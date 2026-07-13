# Command and machine contract reference

The installed `tt --help` output is authoritative for a particular release. This document
describes the canonical automation grammar and its stable behavior. Commands backed by an
unverified operation are omitted from stable help even when research material mentions a route.
The concise [command index](command-index.md) and [`tt.1`](man/tt.1) are generated from the same
metadata used by shell completion.

## Global contract

Use noun–verb commands for automation, for example `tt task add` and `tt project list`. Put global
flags before or after the subcommand as supported by help.

Every `--json` invocation emits exactly one versioned envelope to stdout. Diagnostics and progress
go to stderr. `--fields` filters `data`, not `version`, `ok`, `error`, or `meta`.

| Exit | Meaning |
|---:|---|
| 0 | Success |
| 2 | Invalid input or usage |
| 3 | Authentication or capability missing |
| 4 | Not found or ambiguous resolution |
| 5 | Conflict or partial failure |
| 6 | Network, rate limit, or unknown write outcome |
| 7 | Protocol or schema drift |
| 8 | Local configuration, cache, or storage failure |

For writes, use `--dry-run` to inspect normalized intent without sending a mutation. Destructive
operations require `--yes` in non-interactive mode. Multiple-item operations can return both
successes and failures; any partial failure exits 5 while retaining every item result in JSON.

## Tasks and comments

```text
tt task add --title TEXT [--project PROJECT] [--due DATE] [--start DATE]
            [--priority PRIORITY] [--tags TAGS] [--content TEXT]
            [--checklist ITEM] [--repeat RULE] [--parent TASK] [--column COLUMN]
tt task list [FILTER ...]
tt task show TASK
tt task edit TASK [FIELDS ...]
tt task complete TASK ...
tt task delete TASK ...
tt task move TASK PROJECT
tt task reopen TASK
tt task checklist add|complete|delete TASK ITEM
tt task completed [--from DATE] [--to DATE] [--project PROJECT]
tt task pin|unpin TASK
tt comment list|add|delete TASK
tt search TEXT
tt trash list|restore
```

Pinning, server search, and trash require a verified v2 session. Search can explicitly identify a
local-cache fallback. Stable commands never silently drop fields to use a weaker API.

## Projects and organization

```text
tt project list|show|add|edit|delete
tt project archive|unarchive PROJECT
tt group list|add|rename|delete
tt column list|add|edit PROJECT
tt column delete PROJECT COLUMN
tt tag list|add
tt tag rename|merge|delete
tt filter list|show|add|edit|delete
```

Official-client v1 operations are reported separately from documented v1 operations in doctor
output. V2 organization writes are capability-gated and host-specific.

## Views, sync, and local state

```text
tt today
tt tomorrow
tt week
tt inbox
tt overdue
tt upcoming
tt all
tt next
tt agenda [DATE]
tt sync [--full]
tt cache status|clear
```

Today, overdue, and other due-date views evaluate normalized local due dates in the profile
timezone. They do not incorrectly compile due dates into v1's start-date filter fields.

## Habits and focus records

```text
tt habit list|show|log
tt habit checkin HABIT ... [--date DATE] [--value VALUE]
tt habit add|edit
tt habit stats

tt focus list [--from DATE] [--to DATE] [--type TYPE]
tt focus log [--task TASK] --duration DURATION [--note TEXT]
tt focus delete FOCUS_ID --type TYPE
tt focus stats|heatmap
```

Commands whose habit semantics have not passed the selected host's verification gate remain
hidden or return a stable capability error.

## Calendar and account data

```text
tt calendar accounts|subscriptions|events
tt stats
tt countdown list
```

Calendar account and event data require a verified v2 session. Agenda remains useful for tasks
when calendar capability is unavailable and labels omitted calendar data explicitly.

## Profiles, authentication, and diagnostics

```text
tt auth token|session|status|logout
tt doctor
tt profile list|add|remove|use
tt config get|set
tt context list|use|off
tt alias list|set|remove
tt completion bash|zsh|fish
```

See [Authentication](authentication.md) and [Configuration](configuration.md).

## Human quick-add and export

Agents should use explicit `tt task add` flags. Interactive users can use the English-only alias:

```sh
tt add "Pay rent tomorrow 9am !high #finance ~Personal *every month"
```

Recognized sigils are `#tag`, `!high|medium|low|none`, `~project` or `^project`, and a supported
`*date/recurrence` expression. Explicit flags override parsed values. `--keep-text` retains parsed
spans, while literal-title and escaping rules preserve intended sigil characters. Unsupported or
unanchored recurrence is an input error rather than a guess.

ICS export uses the existing task filter grammar and writes RFC 5545 calendar bytes to stdout:

```sh
tt export ics project:Work due.before:eom > work-tasks.ics
```

## Filter grammar

The initial grammar is implicit AND:

```text
project:Work
+tag
-tag
!high
due:today
due.before:eom
start.after:2026-07-01
text~substring
status:open|done|wontdo
bare title words
```

Unsupported clauses are reported and never ignored. Exact IDs and exact normalized names resolve
before unique ID prefixes. Prefixes contain at least four characters. Non-interactive mode never
uses fuzzy matching; ambiguity returns candidate IDs in a structured error.

## Raw API escape hatch

```text
tt api get RELATIVE_PATH [--v2]
```

The stable raw command is read-only. It accepts only a relative path on the configured API origin,
rejects redirects to another origin, and redacts credentials. Arbitrary raw writes are not part of
the stable release.
