# v2 Wire Facts — Live-Verified (first-hand)

Verified 2026-07-13 against a real Pro account on ticktick.com, in throwaway
`tt-verify*` projects (created and deleted by the verification scripts; no existing
data touched). This file records only what we observed ourselves — when it conflicts
with `api-v2-internals.md` (vendored SDK doc), THIS file wins. Payload shapes for
restore/filter/column were extracted from the live web-app bundle
(`web.ap-8114df6aa76c6714a267.js`, CDN build of 2026-07) and then confirmed live.

Auth for all calls: `Cookie: t=<session>` + `X-Device: {"platform":"web","version":6430,"id":"<24-hex>"}`
+ browser User-Agent. Nothing else needed.

## Batch envelope semantics (critical)

- HTTP 200 does NOT mean the operation happened. Wrong-shaped payloads can return
  200 with an empty `{"id2etag":{},"id2error":{}}` envelope and do nothing
  (observed on `/trash/restore` with wrong keys, and on `/batch/task` unpin with
  `null`/`""`). Every write must be confirmed by readback.
- Successful deletes may return an empty envelope too (`habits/batch`), OR an
  `id2etag` entry (`/column` delete). Endpoint-specific.
- Malformed delete entries on `/column` return `{"errorCode":"unknown_exception"}`.

## Tasks — POST /batch/task

- `add` items REQUIRE a client-generated 24-hex `id`. Response `id2etag` keys by it.
- `parentId` in an `add` item is silently IGNORED (differs from v1 open API, where
  parentId works on create and update!). Use `POST /batch/taskParent`:
  set: `[{"taskId","projectId","parentId"}]` — unset: `[{"taskId","projectId","oldParentId"}]`.
- Complete: update with `status:2` + `completedTime` — appears in
  `GET /project/all/closed?from=YYYY-MM-DD%20HH:MM:SS&to=...&status=Completed&limit=N`.
- Reopen: update with `status:0`.
- Pin: update with `pinnedTime:"<ISO 2026-07-13T09:10:00.000+0000>"`.
- **Unpin: update with `pinnedTime:"-1"`.** `null` and `""` are silent no-ops
  (the vendored SDK doc's recipe is wrong; `-1` is what the web app sends).
- Column assignment: update with `columnId` (readback via `GET /task/{id}?projectId=`).
- Move: `POST /batch/taskProject` `[{"taskId","fromProjectId","toProjectId"}]`.
- Single-task readback: `GET /task/{id}?projectId={pid}` works (also shows
  `deleted:1` for trashed tasks).

## Trash

- List: `GET /project/all/trash/pagination?start=0&limit=N` AND
  `GET /project/all/trash/page` both work (tasks under `.tasks`).
- **Restore: `POST /trash/restore` with `[{"fromProjectId","taskId","toProjectId"}]`**
  (from = to for in-place restore). Response `{"id2etag":{taskId:etag}}`.
  Wrong shapes (e.g. `[{taskId,projectId}]`) return 200 and do nothing.
- Empty trash: `DELETE /trash/cleanUp` exists (never called in verification —
  destructive account-wide; must never be used in tests).

## Filters — POST /batch/filter

Envelope `{"add":[...],"update":[...],"delete":["<filterId>"]}`.
Add item: `{"id":"<client 24-hex>","name":"...","rule":"<JSON-encoded string>","sortOrder":<int>}`.
Rule example (from the web bundle, confirmed live):
`"{\"and\":[{\"or\":[\"today\"],\"conditionName\":\"dueDate\",\"conditionType\":1}],\"type\":0,\"version\":1}"`.
Readback: `filters` array in `GET /batch/check/0`.

## Columns — POST /column (batch)

Envelope `{"add":[{"id":"<client 24-hex>","projectId","name","sortOrder"}],"update":[...],
"delete":[{"columnId":"<id>","projectId":"<pid>"}]}`.
Delete entries MUST be `{columnId, projectId}` objects — bare id strings or
`{id, projectId}` fail with `unknown_exception`. Readback via v1
`GET /open/v1/project/{id}/column`. (v1 can list/create/update columns; only
delete needs v2.)

## Projects, tags, misc

- Archive/unarchive: `POST /batch/project` update with `closed:true|false` —
  verified by v1 readback (`closed:true`, then `closed:null` when unarchived).
- Tag rename: `PUT /tag/rename` `{"name","newName"}`. Merge: `PUT /tag/merge`
  `{"name":<source>,"newName":<target>}` (source disappears). Delete:
  `DELETE /tag?name=`. All verified with v1 `GET /open/v1/tag` readbacks.
- Habit delete: `POST /habits/batch` `{"add":[],"update":[],"delete":["<habitId>"]}`
  (success envelope is fully empty — confirm by readback).

## Read surfaces (all 200)

- `GET /statistics/general` — keys incl. level, score, todayCompleted,
  totalCompleted, pomoByDay/Week/Month, taskByDay/Week/Month, todayPomoCount/Duration.
- `GET /pomodoros/statistics/heatmap/{YYYYMMDD}/{YYYYMMDD}` and
  `GET /pomodoros/statistics/dist/{YYYYMMDD}/{YYYYMMDD}`.
- `GET /calendar/subscription`, `GET /calendar/archivedEvent`,
  `GET /calendar/bind/events/all` (array of per-account bundles:
  `{accountId, events, errorIds, begin, end, ...}`).

## v1 semantics verified alongside

- Completing a RECURRING task advances the live task in place (same id,
  `dueDate` +1 interval, `status:0`) and writes a SEPARATE completed instance with
  a DIFFERENT id into completed history (`POST /open/v1/task/completed`).
- v1 reopen: `POST /open/v1/task/{id}` with `status:0` works.

## Routes seen in the web bundle but NOT yet verified

`/batch/tag`, `/batch/focusOp`, `/batch/pomodoro`, `/batch/columnProject`,
`/task/assign`, `/calendar/batch/subscribe`, `/calendar/bind/*` (OAuth binding).
Treat as UNVERIFIED in the capability manifest.
