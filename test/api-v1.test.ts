import { describe, expect, test } from "bun:test"
import { CapabilityError, ProtocolError } from "../src/api/errors"
import { V1Client } from "../src/api/v1/client"
import {
  createSequenceFetch,
  emptyResponse,
  jsonResponse,
  requestAt,
  requestJson,
} from "./api-test-helpers"

describe("V1Client", () => {
  test("uses bearer auth and validates project responses", async () => {
    const mock = createSequenceFetch([
      jsonResponse([{ id: "project-1", name: "Work", futureField: true }]),
    ])
    const client = new V1Client({ accessToken: "v1-secret", fetch: mock.fetch })
    const projects = await client.listProjects()

    expect(projects[0]).toMatchObject({ id: "project-1", name: "Work", futureField: true })
    expect(mock.requests[0]?.url.pathname).toBe("/open/v1/project")
    expect(new Headers(mock.requests[0]?.init.headers).get("authorization")).toBe(
      "Bearer v1-secret",
    )
  })

  test("accepts a documented 201 empty create response and sends parentId", async () => {
    const mock = createSequenceFetch([emptyResponse(201)])
    const client = new V1Client({ accessToken: "token", fetch: mock.fetch })
    const result = await client.createTask({
      title: "Child",
      projectId: "project-1",
      parentId: "parent-1",
      description: "Checklist description",
      repeatRule: "RRULE:FREQ=DAILY;INTERVAL=1",
      checklist: [{ title: "Step", completed: false }],
    })

    expect(result).toBeUndefined()
    expect(requestJson(requestAt(mock.requests, 0))).toEqual({
      title: "Child",
      projectId: "project-1",
      parentId: "parent-1",
      desc: "Checklist description",
      repeatFlag: "RRULE:FREQ=DAILY;INTERVAL=1",
      items: [{ title: "Step", status: 0 }],
    })
  })

  test("does not silently drop an unsupported v1 column assignment", async () => {
    let calls = 0
    const client = new V1Client({
      accessToken: "token",
      fetch: async () => {
        calls += 1
        return jsonResponse({})
      },
    })
    expect(() =>
      client.createTask({
        title: "Task",
        projectId: "project-1",
        columnId: "column-1",
      }),
    ).toThrow(CapabilityError)
    expect(calls).toBe(0)
  })

  test("uses exact move, completed-history, and no-content routes", async () => {
    const mock = createSequenceFetch([
      jsonResponse([{ id: "task-1", etag: "etag-2" }]),
      jsonResponse([]),
      emptyResponse(200),
      emptyResponse(200),
    ])
    const client = new V1Client({ accessToken: "token", fetch: mock.fetch })

    await client.moveTask("task-1", "from-1", "to-1")
    await client.completedTasks({ projectIds: ["to-1"] })
    await client.completeTask("to-1", "task-1")
    await client.deleteTask("to-1", "task-1")

    expect(mock.requests.map((request) => request.url.pathname)).toEqual([
      "/open/v1/task/move",
      "/open/v1/task/completed",
      "/open/v1/project/to-1/task/task-1/complete",
      "/open/v1/project/to-1/task/task-1",
    ])
    expect(requestJson(requestAt(mock.requests, 0))).toEqual([
      { taskId: "task-1", fromProjectId: "from-1", toProjectId: "to-1" },
    ])
  })

  test("uses official-client v1 endpoints for comments, groups, columns, tags, and countdowns", async () => {
    const mock = createSequenceFetch([
      jsonResponse([]),
      jsonResponse([]),
      jsonResponse([]),
      jsonResponse([]),
      jsonResponse([]),
    ])
    const client = new V1Client({ accessToken: "token", fetch: mock.fetch })
    await client.listComments("p", "t")
    await client.listGroups()
    await client.listColumns("p")
    await client.listTags()
    await client.listCountdowns()

    expect(mock.requests.map((request) => request.url.pathname)).toEqual([
      "/open/v1/project/p/task/t/comments",
      "/open/v1/project/group",
      "/open/v1/project/p/column",
      "/open/v1/tag",
      "/open/v1/countdown",
    ])
  })

  test("rejects incompatible required wire structure", async () => {
    const mock = createSequenceFetch([jsonResponse([{ name: "Missing id" }])])
    const client = new V1Client({ accessToken: "token", fetch: mock.fetch })
    expect(client.listProjects()).rejects.toBeInstanceOf(ProtocolError)
  })
})
