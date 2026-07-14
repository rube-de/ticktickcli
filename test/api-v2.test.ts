import { describe, expect, test } from "bun:test"
import { AppError, PartialFailureError } from "../src/api/errors"
import { V2Client } from "../src/api/v2/client"
import { VERSION } from "../src/version"
import { createSequenceFetch, jsonResponse, requestAt, requestJson } from "./api-test-helpers"

const TASK = {
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  projectId: "project-1",
  title: "Task",
  status: 0,
  priority: 0,
}

function sync(overrides: Record<string, unknown> = {}) {
  return {
    inboxId: "inbox-1",
    checkPoint: 123,
    projectProfiles: [],
    projectGroups: [],
    syncTaskBean: { update: [] },
    tags: [],
    filters: [],
    ...overrides,
  }
}

describe("V2Client", () => {
  test("uses the t cookie, minimal X-Device header, and full checkpoint route", async () => {
    const mock = createSequenceFetch([jsonResponse(sync())])
    const client = new V2Client({
      sessionToken: "session-secret",
      deviceId: "0123456789abcdef01234567",
      fetch: mock.fetch,
    })
    const state = await client.batchCheck("0")

    const headers = new Headers(mock.requests[0]?.init.headers)
    expect(state.checkPoint).toBe(123)
    expect(mock.requests[0]?.url.pathname).toBe("/api/v2/batch/check/0")
    expect(headers.get("cookie")).toBe("t=session-secret")
    expect(headers.get("user-agent")).toBe(`Mozilla/5.0 (compatible; TickTickCLI/${VERSION})`)
    expect(JSON.parse(headers.get("x-device") ?? "{}")).toEqual({
      platform: "web",
      version: 6430,
      id: "0123456789abcdef01234567",
    })
  })

  test("accepts a full-sync snapshot carrying the live nullable and string-typed shapes", async () => {
    const mock = createSequenceFetch([
      jsonResponse(
        sync({
          projectProfiles: [
            { id: "project-1", name: "Work", color: null, viewMode: null, permission: null },
          ],
          syncTaskBean: {
            update: [
              {
                id: "task-1",
                projectId: "project-1",
                title: "Task",
                repeatFrom: "2",
                startDate: null,
                dueDate: null,
                completedTime: null,
                createdTime: null,
                modifiedTime: null,
                items: [{ id: "item-1", title: "Step", completedTime: null, startDate: null }],
              },
            ],
          },
        }),
      ),
    ])
    const client = new V2Client({ sessionToken: "session", fetch: mock.fetch })
    const state = await client.batchCheck("0")

    expect(state.projectProfiles?.[0]).toMatchObject({
      color: null,
      viewMode: null,
      permission: null,
    })
    const updated = state.syncTaskBean?.update?.[0]
    expect(updated?.repeatFrom).toBe("2")
    expect(updated).toMatchObject({ startDate: null, dueDate: null, completedTime: null })
    expect(updated?.items?.[0]).toMatchObject({ completedTime: null, startDate: null })
  })

  test("gates incremental sync before any network request", () => {
    let calls = 0
    const client = new V2Client({
      sessionToken: "session",
      fetch: async () => {
        calls += 1
        return jsonResponse(sync())
      },
    })
    expect(() => client.batchCheck("123")).toThrow(AppError)
    expect(calls).toBe(0)
  })

  test("turns id2error into a structured partial failure", async () => {
    const mock = createSequenceFetch([
      jsonResponse({
        id2etag: { good: "etag" },
        id2error: { bad: "TASK_NOT_FOUND" },
      }),
    ])
    const client = new V2Client({ sessionToken: "session", fetch: mock.fetch })
    const error = await client
      .batchTasks({ delete: [{ taskId: "bad", projectId: "project-1" }] })
      .catch((cause) => cause)

    expect(error).toBeInstanceOf(PartialFailureError)
    expect(error.failures).toEqual([
      { id: "bad", code: "TASK_NOT_FOUND", message: "TASK_NOT_FOUND" },
    ])
    expect(error.successes).toEqual(["good"])
  })

  test("reports a successful batch followed by failed readback as an unknown write outcome", async () => {
    const mock = createSequenceFetch([
      jsonResponse({ id2etag: { created: "etag" }, id2error: {} }),
      jsonResponse({ message: "readback unavailable" }, { status: 503 }),
    ])
    const client = new V2Client({
      sessionToken: "session",
      fetch: mock.fetch,
      maxReadRetries: 0,
    })

    const error = await client
      .createTask({ projectId: TASK.projectId, title: "Created" })
      .catch((cause) => cause)
    expect(error).toMatchObject({
      code: "write_outcome_unknown",
      details: {
        operation: "task.add",
        guidance: "Read the affected resource before retrying the mutation.",
      },
    })
  })

  test("unpins with the verified -1 sentinel and confirms by readback", async () => {
    const mock = createSequenceFetch([
      jsonResponse({ ...TASK, pinnedTime: "2026-07-13T09:10:00.000+0000", unknown: "keep" }),
      jsonResponse({ id2etag: { [TASK.id]: "next" }, id2error: {} }),
      jsonResponse({ ...TASK, pinnedTime: "-1", unknown: "keep" }),
    ])
    const client = new V2Client({ sessionToken: "session", fetch: mock.fetch })
    await client.unpinTask(TASK.id, TASK.projectId)

    const payload = requestJson(requestAt(mock.requests, 1)) as {
      update: Record<string, unknown>[]
    }
    expect(payload.update[0]).toMatchObject({
      id: TASK.id,
      projectId: TASK.projectId,
      pinnedTime: "-1",
      unknown: "keep",
    })
  })

  test("restores trash with exact from/task/to keys and confirms deletion cleared", async () => {
    const mock = createSequenceFetch([
      jsonResponse({ id2etag: { [TASK.id]: "restored" }, id2error: {} }),
      jsonResponse({ ...TASK, deleted: 0 }),
    ])
    const client = new V2Client({ sessionToken: "session", fetch: mock.fetch })
    await client.restoreTrash([
      { fromProjectId: TASK.projectId, taskId: TASK.id, toProjectId: TASK.projectId },
    ])

    expect(requestJson(requestAt(mock.requests, 0))).toEqual([
      { fromProjectId: TASK.projectId, taskId: TASK.id, toProjectId: TASK.projectId },
    ])
  })

  test("serializes filter rules as JSON strings and verifies the sync readback", async () => {
    const filterId = "bbbbbbbbbbbbbbbbbbbbbbbb"
    const mock = createSequenceFetch([
      jsonResponse({ id2etag: { [filterId]: "etag" }, id2error: {} }),
      jsonResponse(
        sync({
          filters: [
            {
              id: filterId,
              name: "Today",
              rule: '{"type":0}',
              sortOrder: 1,
            },
          ],
        }),
      ),
    ])
    const client = new V2Client({ sessionToken: "session", fetch: mock.fetch })
    await client.batchFilters({
      add: [{ id: filterId, name: "Today", rule: '{"type":0}', sortOrder: 1 }],
    })

    expect(requestJson(requestAt(mock.requests, 0))).toEqual({
      add: [{ id: filterId, name: "Today", rule: '{"type":0}', sortOrder: 1 }],
      update: [],
      delete: [],
    })
  })

  test("preserves unknown project fields during archive and verifies closed state", async () => {
    const project = {
      id: "project-1",
      name: "Work",
      etag: "etag-1",
      closed: false,
      futureField: { keep: true },
    }
    const mock = createSequenceFetch([
      jsonResponse(sync({ projectProfiles: [project] })),
      jsonResponse({ id2etag: { [project.id]: "etag-2" }, id2error: {} }),
      jsonResponse(sync({ projectProfiles: [{ ...project, closed: true }] })),
    ])
    const client = new V2Client({ sessionToken: "session", fetch: mock.fetch })
    await client.setProjectArchived(project.id, true)

    const payload = requestJson(requestAt(mock.requests, 1)) as {
      update: Record<string, unknown>[]
    }
    expect(payload.update[0]).toMatchObject({
      id: project.id,
      etag: "etag-1",
      closed: true,
      futureField: { keep: true },
    })
  })

  test("deletes a column with the verified object shape", async () => {
    const mock = createSequenceFetch([
      jsonResponse({ id2etag: { "column-1": "etag" }, id2error: {} }),
      jsonResponse([]),
    ])
    const client = new V2Client({ sessionToken: "session", fetch: mock.fetch })
    await client.deleteColumn("project-1", "column-1")

    expect(requestJson(requestAt(mock.requests, 0))).toEqual({
      add: [],
      update: [],
      delete: [{ columnId: "column-1", projectId: "project-1" }],
    })
  })
})
