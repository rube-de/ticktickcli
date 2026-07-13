# API Reference Docs

Vendored research material. Files are kept verbatim from their sources — corrections live
in errata banners and here, not in the vendored bodies. The project's source of truth for what
goes through which API is the capability manifest described in `docs/implementation-plan.md` §3
and implemented in `src/api/capabilities.ts`.

| File | Source | Covers | Trust notes |
|---|---|---|---|
| `openapi-v1-official.md` | Official TickTick Open API docs dump | v1: tasks (incl. move, filter, completed history), projects, focus, habits + check-ins | Authoritative for v1. Broader than third-party folklore claims. |
| `openapi-v1-tickteam-cli.md` | TickTeam/ticktick-cli repo | Same endpoint surface as the official dump (byte-identical) | Kept as provenance for the undocumented-v1 findings (project groups, columns, tag list/create, countdown, comments, `parentId`) — all live-verified including writes, 2026-07-13. |
| `api-v2-internals.md` | dev-mirzabicer/ticktick-sdk docs | v2 wire details: auth, batch envelope, `batch/check/0` sync, routing | **Its v1-coverage claims are wrong in places** — see the errata banner at the top. Use only for v2 wire details. |
| `api-v2-habits.md` | HAR-file reverse engineering | v2 habit batch endpoints + two-request check-in pattern | v1 already covers habit get/create/update and check-ins; this doc matters mainly for habit delete/archive and batch semantics. |
| `api-v2-web-surfaces.md` | Web-app observation | v2 surfaces: filters, trash, calendar, statistics, pinning | Genuinely v2-only features. |
| `api-v2-probe-notes.md` | Prior Dida365 integration notes (Doris/OpenClaw) | v2 on the dida365.com host: sync/checkpoint behavior, cookie auth | Host-specific — Dida365, not ticktick.com. Cross-check per host before relying on it. |
| `api-v2-live-verified.md` | Our live verification (2026-07-13) + web-bundle extraction | First-hand v2 wire facts: batch semantics, trash restore, filter CRUD, column delete, pin/unpin, archive, recurring semantics | Most trustworthy file here — overrides the others where they conflict. |

Our own live verification (2026-07-13, real ticktick.com account) is recorded in the
implementation plan's §13 verification gates: v1 personal API token works across documented
and undocumented endpoints; v2 works with the `t` cookie plus a minimal `X-Device` header.
The two credentials are not interchangeable (v1 token gets 401 on v2 routes).
