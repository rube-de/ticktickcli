# TickTick CLI — Implementation Plan

> Status: ready for implementation (2026-07-13). Product direction (agent-first, macOS/Linux-first, no OAuth in the CLI) confirmed by the user. Auth paths AND the full write surface for Phases 0–5 live-verified against the real API on ticktick.com (see §13 gates and docs/reference/api-v2-live-verified.md); remaining unverified items are confined to Phase 4 habit-semantics gates, Phase 7 stretch features, free-tier errors, and the Dida365 host. Decisions are recorded in §17. Research sources: the official Open API docs dump, TickTeam/ticktick-cli, dev-mirzabicer/ticktick-sdk, TickTickSync, dida-cli probe notes, and the vendored references under docs/reference/.

## 1. Vision and product priority

Build a general-purpose, cross-platform TickTick CLI whose primary consumer is an agent harness. Human-friendly features remain valuable, but they do not take precedence over deterministic automation.

Design priorities, in order:

1. Stable machine contracts: versioned JSON, documented exit codes, stdout/stderr separation, and no surprise prompts.
2. Headless operation: credentials injected by environment, secret files, or stdin; no browser required.
3. Safe mutations: capability-aware routing, explicit dry runs, no duplicate-producing retries, and structured partial failures.
4. Correct local state: profile-isolated cache, atomic sync, timezone-correct views, and observable freshness.
5. Broad TickTick coverage through documented v1 first and verified unofficial surfaces second.
6. Human conveniences such as natural-language quick-add, fuzzy pickers, and a TUI.

The CLI itself is the agent surface. An MCP server remains out of scope. Ship a SKILL.md that documents the deterministic command grammar and machine contracts.

## 2. Research findings and corrected assumptions

1. **Documented v1 is broader than old community summaries claim.** The current public docs cover task and project operations, task move/filter/completed history, habits and check-ins, and focus records.
2. **TickTick's official CLI uses additional v1 endpoints.** Project-group CRUD, column create/update, tag list/create, comments, countdown, and parentId updates exist in TickTeam/ticktick-cli. These are lower-risk than arbitrary reverse-engineered endpoints but remain undocumented and must be classified separately from documented v1.
3. **Hard v1 gaps remain.** There is no documented account-wide active-task endpoint, text search, tag rename/merge/delete, filter CRUD, trash, calendar data, account statistics, pinning, attachments, sharing, notifications, or webhooks. The observed GET /open/v1/project/inbox/data workaround must remain capability-gated.
4. **A successful v1 response may have no body.** Complete/delete endpoints explicitly return successful 2xx no-content responses, and some creates/updates may return 201 without a representation. Empty-body handling must be endpoint-specific; it is not a global NotFound signal.
5. **Unofficial v2 provides the broad account surface.** Verified or source-backed operations include core checkpoint sync, search, tags, filters discovery, trash listing, completed/abandoned history, project/task batch operations, pinning, statistics, comments, calendar accounts/subscriptions, habits, and focus statistics.
6. **GET /batch/check/0 is core sync, not the whole product.** It covers projects, groups, active tasks, tags, filters, ordering, and related deltas. Habits, check-ins, focus history, comments, trash, and calendar data require separate resource fetchers and freshness records.
7. **Advertised v2 routes: most now live-verified (2026-07-13), a few still gated.** Verified with exact shapes in `docs/reference/api-v2-live-verified.md`: trash restore, filter CRUD, column delete, calendar event listing, pin/unpin, archive. Still gated pending a trace or probe: remote timer status/control, pomodoro/focusOp writes, `/batch/tag`, `/task/assign`, calendar OAuth binding.
8. **v2 authentication is private and fragile.** The t cookie is the primary observed credential, but some web surfaces may also require a fuller cookie/CSRF context. Password sign-on has lockout/captcha risk and is not part of the initial implementation.
9. **v1 and v2 credentials do not interoperate.** A v1 bearer token and a v2 session credential are independent and optional. Commands declare which capability they require.
10. **Dida365 is similar, not identical.** Observed differences include checkpoint shapes, casing, datetime requirements, trash routes, headers, and unverified write payloads. TickTick and Dida365 require separate fixtures and capability results.
11. **Token lifetime data is not reliable enough to hard-code.** Store expiry and refresh fields only when actually returned. Validate credentials with an explicit status/doctor call instead of assuming a fixed lifetime.
12. **Live-verified 2026-07-13 on ticktick.com:** the personal API token from web settings works as the v1 bearer across documented and official-client endpoints (projects, habits, tags, groups, countdowns, focus, check-ins) and is correctly rejected (401) by v2 routes. grant_type=client_credentials mints a token despite the docs but it is app-bound: every data call returns 500 unknown_exception — doctor must map this signature to token_not_user_bound.
13. **v1 writes live-verified 2026-07-13 (33/33 in a throwaway project):** project create/update/delete, task create/update/complete/delete/move, parentId on create AND update, comments add/list/delete, column list/create/update, project-group CRUD, tag create, focus create/delete, habit create/update/checkin/checkins-query, inbox data. v2 cleanup writes verified: DELETE /tag?name= and habits/batch delete (envelope on success: `{"id2etag":{},"id2error":{}}` — both empty; deletion must be confirmed by readback, not by the envelope). **Quirk:** task create/update responses omit parentId even when it was applied — subtask state must be read back via `/project/{id}/data` (parentId + childIds are present there).

## 3. API strategy: official-first and capability-driven

### Tiers

- **Tier 0a — documented v1:** default for operations whose semantics cover the request.
- **Tier 0b — official-client v1:** undocumented endpoints used by TickTeam/ticktick-cli. Enabled normally, but identified as compatibility-dependent in diagnostics.
- **Tier 1 — verified unofficial v2:** opt-in through a session credential. Used only for capabilities unavailable in v1 or explicitly requested.
- **Experimental:** source-only or unverified operations. Hidden from the stable command surface until live verification passes for the selected host.

### Capability manifest

src/api/capabilities.ts is the single source of truth. Each operation records:

- API and endpoint
- supported host: TickTick, Dida365, or both
- required credential and Premium status
- verification state: DOCUMENTED, OFFICIAL_CLIENT, LIVE_VERIFIED, SOURCE_ONLY, or UNVERIFIED
- response mode: JSON_REQUIRED, JSON_OPTIONAL, or NO_CONTENT
- idempotency/reconciliation policy
- whether the operation is destructive
- fallback eligibility

Commands ask for a capability rather than choosing a client directly. Options that require richer fields also declare capabilities; they must never be silently dropped during fallback.

### Routing and fallback rules

- Choose the API before sending a mutation.
- Never fallback to another API after an ambiguous write failure.
- Never retry a write merely because the response was lost.
- Read-only operations may fallback only on known capability unavailability, never on validation, permission, or semantic errors.
- A v2 sync failure may fallback to v1 enumeration only when a valid v1 credential exists.
- V2-only commands return a stable capability_missing error when no valid session exists.

## 4. Stack and portability

**TypeScript on Bun**, targeting macOS and Linux first; Windows support is deferred until after the core phases and is not part of any phase's exit criteria:

- bun:sqlite for the cache
- Bun test runner and native fetch
- optional bun build --compile for local convenience, not release artifacts
- strict TypeScript, Biome, and a justfile

Core dependencies:

- commander — command tree and option parsing
- zod — per-API wire validation
- env-paths — platform-correct config, data, cache, and log directories
- @js-temporal/polyfill — deterministic IANA-timezone, all-day, and DST calculations across supported Bun versions
- chalk — TTY rendering while respecting NO_COLOR

Deferred human-UX dependencies:

- chrono-node and rrule — Phase 6 quick-add and recurrence parsing
- @inquirer/prompts — Phase 6 interactive picker fallback

Use config.json rather than TOML so the core has a native, deterministic format with no parser/serializer dependency. The stable application identifier for paths is ticktickcli; it does not depend on the npm package name or binary alias.

## 5. Architecture

    src/
      index.ts                   # commander root and global contract enforcement
      app/
        context.ts               # profile, credentials, clients, store, output mode
        operation.ts             # command execution and structured result envelope
      commands/                  # one module per noun
      core/                      # pure logic; no I/O
        dates.ts
        filters.ts               # parser, AST, verified remote compilation, local evaluation
        quickadd.ts              # Phase 6
        recur.ts                 # Phase 6
        resolve.ts
        urgency.ts
      domain/
        models.ts                # normalized read models
        inputs.ts                # create/patch models; never wire response types
      api/
        capabilities.ts
        errors.ts
        http.ts
        redact.ts
        v1/
          schemas.ts             # v1 wire schemas
          client.ts
          mapper.ts              # v1 wire ↔ domain
        v2/
          schemas.ts             # v2 wire schemas
          client.ts
          mapper.ts              # v2 wire ↔ domain
      store/
        db.ts
        migrations/
        repositories.ts
        sync.ts
      output/
        contract.ts              # JSON envelope and error codes
        json.ts
        render.ts
      platform/
        paths.ts
        credentials.ts
      config.ts

Rules:

- Wire response types, domain models, and write payloads are separate.
- Unknown additive fields are retained in raw wire data and reported as drift; missing or incompatible required structure is a protocol error and is not cached.
- Full-object v2 updates merge into a freshly fetched raw object and preserve unknown fields and etags.
- A command does not write directly to stdout/stderr; it returns a structured result to the output layer.
- API clients contain no CLI/UI code.
- The capability manifest owns response mode, retry, fallback, and destructive metadata.

## 6. Headless-first authentication and profiles

### Credential modes

- **v1 mode:** TT_ACCESS_TOKEN provides the documented and official-client v1 capabilities. The standard value is the personal API token from TickTick web settings (verified working); an OAuth-minted user token is equivalent.
- **v2 mode:** TT_SESSION_TOKEN or TT_SESSION_COOKIE provides only the verified unofficial-v2 capabilities supported by the selected host.
- **hybrid mode:** complete planned functionality requires both credentials in the same profile, targeting the same host and TickTick/Dida365 account.
- The CLI never globally requires both credentials. Each command checks only its declared capability and returns capability_missing when the required credential is absent.
- The CLI validates account alignment wherever the APIs expose enough overlapping identity. A detectable mismatch returns credential_account_mismatch and blocks mixed API/cache operations. When identity cannot be proven, status reports accountMatch as unknown rather than assuming a match.

### Credential precedence

For the selected profile, resolve credentials in this order:

1. Direct environment value
2. Environment-referenced secret file
3. Saved profile credential

Supported environment inputs:

- TT_ACCESS_TOKEN / TT_ACCESS_TOKEN_FILE — official v1 bearer token
- TT_SESSION_TOKEN / TT_SESSION_TOKEN_FILE — v2 t-cookie value
- TT_SESSION_COOKIE / TT_SESSION_COOKIE_FILE — optional full cookie header for capabilities proven to need it
- TT_PROFILE
- TT_HOST

Environment credentials are ephemeral and do not need an auth command.

### Credential commands

    tt auth token --stdin
    tt auth session --stdin
    tt auth status [--verify] --json
    tt auth logout --v1 | --session | --all

- With a TTY, token/session commands may use a hidden prompt; with non-TTY input they require --stdin.
- Secrets are never accepted as positional arguments or ordinary flag values.
- status never prints token fragments. With --verify it calls low-risk endpoints and reports credential source, host, account identity when available, and capability readiness.
- auth status --json reports mode as v1, v2, hybrid, or none; fullCoverage as a boolean; and accountMatch as verified, unknown, mismatch, or not_applicable.
- Validate a session and confirm its account/host before persisting it.
- Logout states exactly which credential was removed and whether cached account data remains; cache deletion is a separate explicit operation.

### Token acquisition (outside the CLI)

The CLI contains no OAuth or browser code. It consumes tokens; it never mints them. Documented acquisition paths:

- **Primary — TickTick web API token.** TickTick's web settings expose a personal API token that works directly as the v1 bearer. Live-verified 2026-07-13 against /project and /habit. This is the documented setup path for humans and agents alike; lifetime is unconfirmed, so auth status --verify is the expiry check.
- **Optional — OAuth authorization_code recipe.** For users who want app-scoped tokens: a documentation recipe (authorize URL opened in any browser once, then a curl token exchange with the user's own registered app). Never embedded in the CLI; never another party's client ID.
- **Trap, documented for doctor:** grant_type=client_credentials mints successfully (undocumented) but produces an app-bound token with no user context — every data endpoint then fails with HTTP 500 unknown_exception. Live-verified 2026-07-13. tt doctor and auth status --verify must recognize this signature (token authenticates, data calls 500) and report token_not_user_bound instead of a generic server error.

Password sign-on and 2FA are deferred. They add lockout/captcha risk without helping the primary harness workflow.

### Cross-platform storage

env-paths determines directories. Store config.json separately from credentials.json. Cache databases are isolated by normalized profile and host. Credential files use atomic creation and restrictive permissions (0600/0700). When Windows support is added later, it relies on user-scoped application directories and inherited ACLs. Platform keychains may be added later but are not the default contract.

## 7. Cache and sync

- One SQLite database per profile and host under the platform data/state directory. Profile names are validated and mapped safely; they are never used as unchecked paths.
- Schema includes versioned migrations, WAL mode, busy timeout, foreign keys, and tables for projects, tasks, groups, columns, tags, filters, habits, check-ins, focus records, events, and metadata.
- Store normalized query fields plus source, etag, fetched-at, and retained raw JSON where round-tripping may be required.

### V2 core sync

- Full: GET /batch/check/0.
- Incremental: GET /batch/check/{checkpoint}.
- Apply every delta, deletion, and ordering change in one SQLite transaction.
- Advance the checkpoint only in the same transaction after all supported deltas validate and apply.
- On checkpoint incompatibility, perform a full sync into a transaction and remove entities absent from the authoritative snapshot.
- Do not treat habits, focus, comments, trash, or calendar as part of core checkpoint freshness; each has its own fetcher and TTL.

### V1 sync

- GET /project, then per-project GET /project/{id}/data.
- Include the observed inbox-data endpoint only when its host capability is verified.
- Space requests conservatively and handle exceed_query_limit by semantic error code.
- Completed history is a bounded query, not an implicit all-time part of active-task sync.

### Timezone policy

- Profile timezone precedence is explicit command flag, then saved profile timezone, then a verified account setting, then the operating-system IANA timezone.
- Preserve the wire timezone, all-day/floating flags, and original wire timestamp alongside normalized Temporal values.
- Today/week/overdue boundaries use the profile timezone. Timed tasks are converted from their declared timezone; all-day tasks compare calendar dates without UTC shifting.
- Serialize each API request with that endpoint's required format rather than a single global formatter.
- DST gaps/overlaps require an explicit Temporal disambiguation policy and fixtures; silently relying on the host Date parser is forbidden.

### Freshness behavior

- Fresh cache: render immediately.
- Stale cache, default: refresh synchronously, then render.
- --stale-ok: render stale data immediately without starting unreliable background work.
- --fresh: force network refresh.
- --offline: forbid network; return local_state error when required data is absent.
- --fresh, --stale-ok, and --offline are mutually exclusive.
- JSON metadata reports source, fetchedAt, and stale.

Mutations are online-only. On success, write through the returned entity or invalidate the affected resource before returning. For no-content mutations, update known local state conservatively and schedule/require a targeted reconciliation. There is no offline mutation queue before the stretch phase.

Short IDs are unique prefixes with a minimum length of four. Exact ID and exact normalized name resolution precede prefix and fuzzy matching. Non-interactive mode never guesses: ambiguity returns candidate IDs in a structured error.

## 8. Stable command surface

Canonical automation commands use noun–verb grammar. Human aliases may be added later, but SKILL.md documents the canonical forms.

Global read/output flags:

- --json
- --fields a,b
- --plain
- --csv
- --profile
- --fresh
- --stale-ok
- --offline
- --no-input
- --verbose

Common write flags:

- --dry-run
- --yes
- --no-input

    # Tasks
    tt task add --title <text> [--project --due --start --priority --tags --content --checklist --repeat --parent --column]
    tt task list [filter...]
    tt task show <id|name>
    tt task edit <id> [flags...]
    tt task complete <id...>
    tt task delete <id...>
    tt task move <id> <project>
    tt task reopen <id>
    tt task checklist add|complete|delete <task> <title|item-id>
    tt comment list|add|delete <task>
    tt task completed [--from --to --project]
    tt task pin|unpin <id>                 # v2; verified on ticktick.com (unpin = pinnedTime "-1")
    tt task wont-do <id>                   # v2; still unverified — hidden until probed
    tt trash list|restore                  # v2; both verified on ticktick.com (restore = POST /trash/restore)
    tt search <text>                       # v2, with labeled local-cache fallback

    # Projects and organization
    tt project list|show|add|edit|delete
    tt project archive|unarchive <project>  # v2 batch/project closed flag; verified on ticktick.com
    tt group list|add|rename|delete         # official-client v1; writes verified
    tt column list|add|edit <project>       # official-client v1; writes verified
    tt column delete <project> <column>     # v2 POST /column; delete entries {columnId,projectId}; verified
    tt tag list|add                        # v1 add accepts name/label; color is not assumed
    tt tag rename|merge|delete              # v2; verified on ticktick.com
    tt filter list|show|add|edit|delete     # v2 batch/filter CRUD verified; rule support reported explicitly

    # Views, after cache foundation
    tt today | tomorrow | week | inbox | overdue | upcoming | all
    tt next
    tt agenda [date]                        # tasks always; calendar portion capability-gated

    # Habits
    tt habit list|show|log
    tt habit checkin <habit...> [--date --value]
    tt habit add|edit|archive
    tt habit stats

    # Focus records
    tt focus list [--from --to --type]
    tt focus log [--task] --duration <duration> [--note]
    tt focus delete <focus-id> --type <type>
    tt focus stats|heatmap

    # Calendar and account data
    tt calendar accounts|subscriptions      # v2; verified on ticktick.com
    tt calendar events                      # v2 GET /calendar/bind/events/all; route verified on ticktick.com
    tt stats                                # verified v2 fields only
    tt countdown list                       # official-client v1

    # Operations
    tt sync [--full]
    tt doctor --json
    tt profile list|add|remove|use
    tt cache status|clear
    tt context list|use|off
    tt alias list|set|remove
    tt auth token|session|status|logout
    tt config get|set
    tt completion bash|zsh|fish
    tt api get <relative-path> [--v2]        # read-only escape hatch

Stable help does not expose UNVERIFIED mutations. The raw API command accepts only relative paths on the configured API origin, rejects redirects to another origin, never prints credentials, and starts read-only. Arbitrary raw writes are not part of the initial plan.

## 9. Quick-add grammar — Phase 6 human convenience

Agents should prefer tt task add with explicit flags. A later tt add <text> alias may provide TickTick-style parsing:

    tt add "Pay rent tomorrow 9am !high #finance ~Personal *every month"

- #tag, !high|medium|low|none, ~project or ^project, and *date/recurrence.
- No @assignee until sharing/member resolution is implemented.
- Explicit command flags always override parsed text.
- --keep-text prevents removal of parsed spans.
- English parsing is the initial documented scope; locale support is explicit rather than inferred.
- A literal-title mode and escaping rules cover titles containing sigil characters.
- Recurrence requires a verified start-date anchor and timezone-safe serialization.

## 10. Filter language

Parse filters into a typed AST and then split them into:

1. Remote predicates whose API semantics are verified equivalent.
2. Local predicates evaluated against the cache.

Supported initial predicates:

- project:Work
- +tag and -tag
- !high
- due:today, due.before:eom
- start.after:<date>
- text~<substring>
- status:open|done|wontdo
- bare words as title substring

Implicit AND is initial scope; OR and parentheses follow only after parser tests exist.

Important: v1 /task/filter date parameters describe startDate, not dueDate. Due and overdue views therefore evaluate locally against normalized dueDate and must not be silently compiled to the v1 date window. Unsupported custom-filter clauses are reported; they are never ignored.

## 11. Errors, retries, and resilience

### Response handling

- Every endpoint declares JSON_REQUIRED, JSON_OPTIONAL, or NO_CONTENT.
- A successful empty response is valid for declared no-content mutations.
- An empty singleton read becomes NotFound only when that endpoint's observed contract says so.
- Parse semantic error bodies even when the HTTP status is 500.
- Preserve the raw status and redacted body in verbose diagnostics.

### Retry and ambiguity

- Rate-limit reads with a conservative configurable token bucket.
- Honor Retry-After in either supported format and use exponential backoff with jitter.
- Retry only operations marked idempotent/reconcilable in the capability manifest.
- Read-only POST queries may be idempotent; method alone does not decide.
- Never blindly retry v1 creates/comments/check-ins/focus writes after timeout.
- For reconcilable v2 writes, query by client-generated ID/checkpoint before deciding whether a retry is safe.
- An uncertain write returns write_outcome_unknown with reconciliation guidance.

### Batch behavior

- Always inspect v2 id2error and id2etag.
- Return per-item successes and failures.
- Any partial failure produces a nonzero partial_failure exit code while retaining all item results in JSON.
- Do not claim atomicity across multiple v1 requests.

### Protocol and security

- A v2 403 is generic forbidden unless a verified endpoint/error mapping proves Premium is required.
- Unknown additive fields are warnings with retained data; missing/type-incompatible required fields are protocol errors.
- Do not advance sync freshness or checkpoints after schema failure.
- Redact Authorization, Cookie, tokens, CSRF data, emails where unnecessary, and sensitive payload fields from logs and fixtures.
- Human rendering neutralizes control characters and terminal escape sequences from remote text.

## 12. Agent contract

### JSON

--json always emits one versioned envelope:

    {
      "version": 1,
      "ok": true,
      "data": {},
      "meta": {
        "profile": "default",
        "host": "ticktick.com",
        "source": "v1",
        "stale": false,
        "fetchedAt": "2026-07-12T12:00:00Z"
      }
    }

Errors use the same envelope:

    {
      "version": 1,
      "ok": false,
      "error": {
        "code": "capability_missing",
        "message": "Session authentication is required",
        "details": {}
      },
      "meta": {}
    }

--fields filters data, not the envelope. The explicitly uncontracted tt api get --raw mode may print the raw server response.

### Exit codes

| Code | Meaning |
|---:|---|
| 0 | Success |
| 2 | Invalid input or usage |
| 3 | Authentication or capability missing |
| 4 | Not found or ambiguous resolution |
| 5 | Conflict or partial failure |
| 6 | Network, rate limit, or unknown write outcome |
| 7 | Protocol/schema drift |
| 8 | Local config/cache/storage failure |

### Non-interactive rules

- --json, --no-input, CI mode, and non-TTY stdin never open a browser, launch an editor, or display a picker.
- Missing required input returns an error immediately.
- --yes bypasses confirmation only; it does not select defaults or make a command fully non-interactive.
- All write commands support --dry-run before live writes.
- Structured data goes to stdout. Diagnostics and progress go to stderr.
- Destructive operations require --yes in non-interactive mode.
- Aliases expand CLI tokens only; they never invoke a shell, and recursion/cycles are rejected.

Ship skills/ticktick-cli/SKILL.md in the first usable agent release, covering credentials, JSON, exit codes, ID resolution, dry runs, destructive operations, and capability errors.

## 13. Testing and verification

### Automated tests

- Unit: date normalization, timezone/DST boundaries, filters, resolver ambiguity, urgency, output envelope, error mapping, redaction, and later quick-add/RRULE.
- API fixtures: every response mode, 2xx empty success, 500 semantic error, Retry-After, timeout ambiguity, id2error partial failure, unknown additive fields, and incompatible schema.
- Store: migrations, profile/host isolation, atomic checkpoint application, crash before checkpoint commit, deletion reconciliation, WAL concurrency, mutation invalidation, and corrupt-cache recovery.
- CLI subprocess: stdout/stderr separation, exit codes, no prompt/browser under machine modes, dry-run guarantees, control-character rendering, and all global-option positions.
- Auth/storage: env/file/saved precedence, credential-mode reporting, hybrid account-match states, mismatch blocking, no secret output, restrictive file creation where supported, invalid session not persisted, and logout/cache separation.
- Packaging: npm pack contents, executable shebang/mode, clean global install, bunx invocation, and no dependency on repository-only files.
- Golden output: TTY, plain, CSV quoting, JSON envelopes, error envelopes, and partial batches.

Fixtures are synthetic or rigorously redacted. Never commit raw account dumps, cookies, bearer tokens, email addresses, or attachment contents.

### Live suite

TICKTICK_LIVE=1 runs only against a dedicated disposable account. Every created entity has a unique test prefix and cleanup runs in finally blocks. Live secrets are never available to untrusted fork CI.

### Verification gates

Before Phase 1:

- v1 bearer/API-token path on both supported hosts (done for ticktick.com 2026-07-13: web-settings API token verified against /project and /habit; dida365.com open)
- doctor detection of user-unbound client_credentials tokens (mint 200, all data calls 500 unknown_exception — verified 2026-07-13)
- per-endpoint 200/201 empty-body behavior
- inbox discovery/default-project behavior
- task create/update/complete/delete response shapes
- rate-limit and semantic error samples

Before Phase 3 undocumented-v1 commands (writes live-verified on ticktick.com 2026-07-13 in a throwaway project, 33/33 passed — see §2 item 13):

- ~~project-group CRUD~~ done (create/rename/delete 200)
- ~~column list/create/update~~ done (on a kanban project; create returns id)
- ~~tag list/create~~ done (`{name, label}` accepted; cleanup via v2 DELETE /tag?name= verified)
- ~~comments, parentId create/update~~ done (comment add/list/delete 200; parentId applies on create and update but is OMITTED from write responses — readback via project data required); countdown is list-only in the official client, no writes exist to verify
- ~~task reopen behavior~~ done (v1 `POST /task/{id}` with status:0 and v2 batch update status:0 both verified)
- ~~recurring-task current/series semantics~~ done (completing a recurring task advances it IN PLACE — same id, dueDate +1 interval, status 0 — and writes a SEPARATE completed instance with a different id into completed history)
- ~~two-step parent assignment recovery~~ done (v1 parentId on update works; v2 `batch/taskParent` set/unset works)
- ~~project archive~~ done via v2 `batch/project` update closed:true/false (readback-verified); project→group assignment shape still unverified

Before Phase 4:

- habit archive status
- check-in status, ID, backdating, and timezone semantics
- habit section discovery
- focus range truncation at 30 days and range chunking

Before each Phase 5 v2 capability — most gates CLOSED 2026-07-13 on ticktick.com; all first-hand wire facts recorded in `docs/reference/api-v2-live-verified.md` (t-only cookie + minimal X-Device suffices for every surface tested, including all writes):

- ~~t-only versus full-cookie/CSRF requirements~~ done (t-only sufficient everywhere tested, writes included)
- minimal/full X-Device per host — done for ticktick.com; Dida365 still open
- full and incremental checkpoint shapes, null deltas, deletes, and ordering — full checkpoint done; incremental/null-delta still open
- ~~trash route and pagination per host~~ done for ticktick.com (both `/trash/pagination` and `/trash/page`; restore = `POST /trash/restore` `[{fromProjectId,taskId,toProjectId}]`)
- ~~tag merge postconditions~~ done (source tag disappears; readback-verified)
- ~~filter read schema~~ done incl. WRITES (`POST /batch/filter`, client-generated id, rule as JSON-string); local rule coverage still open
- ~~batch payloads and id2error behavior~~ done (client-generated 24-hex ids on add; 200-no-op on wrong shapes; empty success envelopes on some deletes — readback mandatory)
- Premium-specific errors — still open (account is Pro; free-tier errors unobservable)
- ~~calendar accounts/subscriptions~~ done (+ `calendar/bind/events/all`, `archivedEvent`)
- v2 task semantics verified: add REQUIRES client id; parentId IGNORED on v2 create (v1 honors it!) — use `batch/taskParent`; pin `pinnedTime:<ISO>`, unpin `pinnedTime:"-1"` (null/"" are silent no-ops); complete `status:2`+`completedTime`; reopen `status:0`; columnId assignment on update
- column delete verified: `POST /column` delete entries must be `{columnId,projectId}` objects
- project archive/unarchive verified: `batch/project` update `closed:true|false`

Still gated until live-verified: remote timer control, pomodoro/focusOp writes, `/batch/tag`, `/task/assign`, calendar binding OAuth flows, habit archive status — and everything on Dida365 (separate host gates). `DELETE /trash/cleanUp` exists but is account-destructive: never used in verification, and if ever shipped it needs an explicit confirmation flag.

## 14. Distribution

- Publish an npm package requiring Bun; support bunx and global npm installation.
- The tt bin points to a published executable entry with an env bun shebang and executable mode.
- package.json must include runtime dependencies, files, repository metadata, scripts, supported Bun version, and private:false before release.
- npm pack is tested from a clean temporary directory.
- CI runs typecheck, lint, tests, and package smoke tests on current macOS and Ubuntu runners (Windows runner added only when Windows support lands).
- Direct repository use remains clone → bun install → bun link.
- No Homebrew tap and no prebuilt binary release initially.
- Completions, config documentation, SKILL.md, and later man pages are generated from shared command metadata.
- The published package contains no OAuth or browser code; installation verification is token-based only.

## 15. Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Contracts and scaffold** | Bun/TS strict, Biome, justfile, CI (macOS + Ubuntu), package skeleton, platform paths, JSON/exit contracts, capability manifest, wire/domain separation, initial migrations, plan copied into docs | just check is green; contract golden tests pass on macOS and Linux |
| **1. Agent foundation** | Headless v1/v2 credential resolution through env/files/stdin, auth status/doctor, safe HTTP response modes and retry policy, typed v1 client, project list, task add/show/complete/delete with explicit IDs/project or verified inbox, JSON, dry-run, initial SKILL.md | Using TT_ACCESS_TOKEN, an agent creates → reads → completes → deletes a task with no prompt/browser and correct JSON/exit codes; a supplied session is validated without password/browser auth |
| **2. Cache, sync, and views** | Per-profile/host SQLite, migrations, v1 enumeration, v2 core checkpoint sync when a session exists, atomic reconciliation, exact/prefix resolution, local filter AST, today/overdue/upcoming/all, cache status/clear | Profile isolation and crash tests pass; warm views under 100 ms; today/overdue correct across DST fixtures |
| **3. Core task and organization coverage** | Task edit/move/reopen/checklists/comments/completed; project CRUD; verified groups/columns/tags/countdown; batch partial results; contexts; cache search fallback | Every stable ID argument accepts exact name or unique prefix without guessing; all undocumented-v1 operations have live fixtures |
| **4. Habits and focus records** | Habit list/show/check-in/log/add/edit/archive/stats; focus list/log/delete/stats/heatmap with 30-day chunking | Verification gate resolved first; daily habit and focus-record workflows are agent-drivable |
| **5. Verified v2 extensions** | Server search, tag rename/merge/delete, filter CRUD, trash listing + restore, completed/abandoned, stats, pin/unpin, column delete, project archive, batch operations, calendar accounts/subscriptions/events, capability diagnostics | Every shipped v2 command has host-specific fixtures and degrades with stable capability errors without a session |
| **6. Human polish and release** | Natural-language quick-add, RRULE parser, optional fuzzy picker, human aliases, ICS export with RFC 5545 golden tests, completions, docs/man pages, npm publish | Clean npm/bunx install; agent workflow remains fully headless; human features do not alter machine contracts |
| **7. Stretch** | Local Pomodoro timer with full start/status/pause/resume/stop/cancel lifecycle, TUI, offline mutation queue, attachments, sharing, notifications, task wont-do, remote timer control (pomodoro/focusOp writes still unverified) | Separate designs and verification gates required |

Phases 0–2 create the reliable agent substrate. Phase 3 completes the official/official-client task surface. Phases 4–5 add breadth. Human-only conveniences intentionally come later.

## 16. Risks

| Risk | Mitigation |
|---|---|
| Duplicate or uncertain writes | Per-operation idempotency metadata, no post-write API fallback, reconciliation before retry, write_outcome_unknown |
| v2 API drift | Isolated wire schemas, raw-field preservation, hard structural failures, host-specific fixtures, capability gates |
| Cache corruption or cross-account leakage | One DB per profile/host, migrations, WAL, transactions, checkpoint-last commit, isolation tests |
| Undocumented v1 endpoint removal | Separate Tier 0b classification, diagnostics, no claim of permanent support |
| Account/ToS risk from v2 | Explicit opt-in, user-supplied session, no password sign-on initially, plain documentation |
| Dida/TickTick divergence | Separate host capabilities and live fixtures; no identical-API assumption |
| Credential leakage | Env/secret-file/stdin inputs, no argv secrets, redacted logs, atomic restrictive storage |
| Timezone/all-day/recurrence errors | Explicit timezone precedence, local due-date evaluation, DST fixtures, verified recurrence anchors |
| Unknown rate limits | Conservative read limiter, cache-first use, Retry-After, semantic error handling |
| Feature claims outrun evidence | Stable help exposes only verified capabilities; source-only endpoints stay experimental |

## 17. Decisions resolved by the user (confirmed 2026-07-12)

1. **Binary:** tt. The stable application ID for storage is ticktickcli; npm package name remains a release-time choice.
2. **Product:** agent-first CLI — the primary consumer is an agent harness; human conveniences come after the machine contracts. Confirmed explicitly by the user ("agent first is my decision, and I wanted that from the start").
3. **Platforms:** macOS and Linux first; Windows deferred.
4. **Stack:** TypeScript + Bun.
5. **Authentication:** headless token/session injection only ("OAuth is not best for agents" — user). The CLI ships no OAuth or browser code in any phase; the documented v1 credential is the personal API token from TickTick web settings (verified working 2026-07-13). An OAuth minting recipe lives in docs only and uses the user's own registered app.
6. **API policy:** documented v1 first, official-client v1 classified separately, unofficial v2 opt-in and capability-gated.
7. **Agent surface:** no MCP server; versioned JSON, stable exit codes, dry-run, and SKILL.md.
8. **Distribution:** npm/repository install, no Homebrew tap or prebuilt releases initially.
9. **License:** MIT.

## Appendix: vendored references

- docs/reference/openapi-v1-official.md — official documentation dump fetched 2026-07-12.
- docs/reference/openapi-v1-tickteam-cli.md — official CLI's vendored Open API documentation.
- docs/reference/api-v2-internals.md — community SDK internals and route/reference material; source-backed is not automatically live-verified.
- docs/reference/api-v2-habits.md — HAR-derived habit/check-in schemas and full-object update behavior.
- docs/reference/api-v2-web-surfaces.md and api-v2-probe-notes.md — DidaCLI observed routes, payloads, incompatibilities, and safety rules.
- docs/reference/api-v2-live-verified.md — our first-hand live verification (2026-07-13): exact write shapes and quirks; overrides other references on conflict.
- docs/reference/README.md — index with per-file provenance and trust notes.

The capability manifest records provenance and last verification date for every non-documented operation. Vendored reference text is evidence, not permission to advertise an unverified stable command.
