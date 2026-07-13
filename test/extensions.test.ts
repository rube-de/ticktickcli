import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Command } from "commander"
import { AppError, ProtocolError } from "../src/api/errors"
import { mapV2CalendarEvent } from "../src/api/v2/mapper"
import { V2CalendarEventSchema, V2TaskSchema } from "../src/api/v2/schemas"
import {
  LOCAL_SEARCH_FALLBACK,
  calendarEventCacheRecords,
  collectTrashTasks,
  normalizeCalendarAccounts,
  normalizeCalendarSubscriptions,
  normalizeGeneralStatistics,
  normalizeTrashTasks,
  reconcileRestoredTaskCache,
  registerExtensionCommands,
  resolveTrashTask,
  searchCachedTasks,
  updateCalendarEventCache,
} from "../src/commands/extensions"
import { StoreDatabase } from "../src/store/db"
import { Repositories } from "../src/store/repositories"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function database(): StoreDatabase {
  const root = mkdtempSync(join(tmpdir(), "tt-extensions-"))
  roots.push(root)
  return StoreDatabase.open(join(root, "cache.db"))
}

function task(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return V2TaskSchema.parse({
    id,
    projectId: "project-1",
    title,
    status: 0,
    priority: 0,
    ...overrides,
  })
}

describe("extension command registration", () => {
  test("registers calendar, stats, trash, and search without exposing remote search", () => {
    const program = new Command()
    registerExtensionCommands(program)

    expect(
      Object.fromEntries(
        program.commands.map((command) => [
          command.name(),
          command.commands.map((child) => child.name()).sort(),
        ]),
      ),
    ).toEqual({
      calendar: ["accounts", "events", "subscriptions"],
      stats: [],
      trash: ["list", "restore"],
      search: [],
    })

    const restore = program.commands
      .find((command) => command.name() === "trash")
      ?.commands.find((command) => command.name() === "restore")
    expect(restore?.options.map((option) => option.long).sort()).toEqual([
      "--dry-run",
      "--to-project",
      "--yes",
    ])
    expect(LOCAL_SEARCH_FALLBACK).toEqual({
      mode: "local_cache",
      remoteOperation: "search.remote",
      reason: "remote_search_not_live_verified",
    })
  })
})

describe("extension output normalization", () => {
  test("whitelists calendar identity fields and does not expose feed URLs or secrets", () => {
    expect(
      normalizeCalendarAccounts([
        {
          accountId: "account-1",
          name: "Work",
          sessionToken: "must-not-leak",
        },
      ]),
    ).toEqual([{ id: "account-1", name: "Work" }])

    expect(
      normalizeCalendarSubscriptions([
        {
          subscriptionId: "subscription-1",
          accountId: "account-1",
          title: "Team calendar",
          color: "#00aaff",
          enabled: true,
          url: "https://example.test/private.ics?token=secret",
          cookie: "must-not-leak",
        },
      ]),
    ).toEqual([
      {
        index: 0,
        id: "subscription-1",
        accountId: "account-1",
        name: "Team calendar",
        color: "#00aaff",
        enabled: true,
      },
    ])
  })

  test("keeps only verified statistics fields and strips nested credential-shaped keys", () => {
    expect(
      normalizeGeneralStatistics({
        level: 4,
        score: 99,
        taskByDay: {
          "2026-07-13": 3,
          accessToken: "must-not-leak",
        },
        futureField: "must-not-leak",
      }),
    ).toEqual({
      level: 4,
      score: 99,
      taskByDay: { "2026-07-13": 3 },
    })
  })

  test("normalizes trashed tasks without returning retained raw wire fields", () => {
    const normalized = normalizeTrashTasks(
      [
        task("aaaaaaaaaaaaaaaaaaaaaaaa", "Restore me", {
          deleted: 1,
          content: "body",
          futureSecret: "must-not-leak",
        }),
      ],
      "2026-07-13T10:00:00Z",
    )

    expect(normalized[0]).toMatchObject({
      id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      projectId: "project-1",
      title: "Restore me",
      content: "body",
      deleted: true,
      source: "v2",
      fetchedAt: "2026-07-13T10:00:00Z",
    })
    expect(normalized[0]).not.toHaveProperty("raw")
    expect(normalized[0]).not.toHaveProperty("futureSecret")
  })

  test("creates authoritative cache records from normalized calendar dates", () => {
    const event = mapV2CalendarEvent(
      V2CalendarEventSchema.parse({
        eventId: "event-1",
        summary: "Meeting",
        accountId: "account-1",
        startTime: "2026-07-13T09:00:00+0000",
        endTime: "2026-07-13T10:00:00+0000",
        futureField: "retained-in-cache-only",
      }),
      { fetchedAt: "2026-07-13T08:00:00Z" },
    )

    expect(calendarEventCacheRecords([event])).toEqual([
      expect.objectContaining({
        id: "event-1",
        accountId: "account-1",
        title: "Meeting",
        startDate: "2026-07-13T09:00:00Z",
        endDate: "2026-07-13T10:00:00Z",
        futureField: "retained-in-cache-only",
      }),
    ])
  })

  test("replaces complete event snapshots but invalidates freshness on partial results", () => {
    const store = database()
    const repositories = new Repositories(store)
    const oldEvent = mapV2CalendarEvent(
      V2CalendarEventSchema.parse({
        id: "old-event",
        title: "Old",
        startDate: "2026-07-12T09:00:00Z",
      }),
    )
    const newEvent = mapV2CalendarEvent(
      V2CalendarEventSchema.parse({
        id: "new-event",
        title: "New",
        startDate: "2026-07-13T09:00:00Z",
      }),
    )
    const cache = { store, repositories, profile: { accountIdentity: "account-1" } }

    updateCalendarEventCache(cache, [oldEvent], "2026-07-13T08:00:00Z", true)
    expect(repositories.getFreshness("calendar.events")?.accountFingerprint).toBe("account-1")

    updateCalendarEventCache(cache, [newEvent], "2026-07-13T09:00:00Z", false)
    expect(repositories.listRawResource("events").map((record) => record.id)).toEqual([
      "old-event",
      "new-event",
    ])
    expect(repositories.getFreshness("calendar.events")).toBeUndefined()

    updateCalendarEventCache(cache, [newEvent], "2026-07-13T10:00:00Z", true)
    expect(repositories.listRawResource("events").map((record) => record.id)).toEqual(["new-event"])
    expect(repositories.getFreshness("calendar.events")?.fetchedAt).toBe("2026-07-13T10:00:00Z")
    store.close()
  })
})

describe("local search fallback", () => {
  test("searches title and content, excludes deleted tasks, and never returns raw cache data", () => {
    const store = database()
    const repositories = new Repositories(store)
    repositories.upsertTasks(
      [
        { id: "title", projectId: "p1", title: "Needle task" },
        { id: "content", projectId: "p1", title: "Other", content: "A needle here" },
        { id: "deleted", projectId: "p1", title: "Needle removed", deleted: 1 },
        { id: "unrelated", projectId: "p1", title: "Nothing" },
      ],
      "v2",
      "2026-07-13T08:00:00Z",
    )

    const results = searchCachedTasks(repositories, "needle")
    expect(results.map((result) => result.id)).toEqual(["title", "content"])
    expect(results.every((result) => !("raw" in result))).toBe(true)
    store.close()
  })

  test("rejects an empty query before touching the repository", () => {
    let called = false
    expect(() =>
      searchCachedTasks(
        {
          searchTasks: () => {
            called = true
            return []
          },
        },
        "  ",
      ),
    ).toThrow(AppError)
    expect(called).toBe(false)
  })
})

describe("trash resolution and pagination", () => {
  test("resolves exact names and reports ambiguity without guessing", () => {
    const tasks = [
      task("aaaaaaaaaaaaaaaaaaaaaaaa", "Duplicate"),
      task("bbbbbbbbbbbbbbbbbbbbbbbb", "Duplicate"),
      task("cccccccccccccccccccccccc", "Unique task"),
    ]
    expect(resolveTrashTask("Unique task", tasks).id).toBe("cccccccccccccccccccccccc")

    const error = (() => {
      try {
        resolveTrashTask("Duplicate", tasks)
      } catch (cause) {
        return cause
      }
    })()
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe("ambiguous")
  })

  test("follows cursors, de-duplicates tasks, and rejects cursor loops", async () => {
    const first = task("aaaaaaaaaaaaaaaaaaaaaaaa", "First")
    const second = task("bbbbbbbbbbbbbbbbbbbbbbbb", "Second")
    const calls: string[] = []
    const collected = await collectTrashTasks({
      listTrash: async () => ({ tasks: [first], next: { cursor: "page-2" } }),
      listTrashPage: async (cursor) => {
        calls.push(cursor ?? "")
        return { tasks: [first, second] }
      },
    })
    expect(calls).toEqual(["page-2"])
    expect(collected.map((item) => item.id)).toEqual([first.id, second.id])

    await expect(
      collectTrashTasks({
        listTrash: async () => ({ tasks: [first], next: "same" }),
        listTrashPage: async () => ({ tasks: [], next: "same" }),
      }),
    ).rejects.toBeInstanceOf(ProtocolError)
  })

  test("writes the confirmed restore readback and invalidates core freshness atomically", () => {
    const store = database()
    const repositories = new Repositories(store)
    repositories.upsertTasks(
      [{ id: "restored", projectId: "p1", title: "Restore", deleted: 1 }],
      "v2",
      "2026-07-13T08:00:00Z",
    )
    repositories.setFreshness({
      resource: "core",
      source: "v2",
      fetchedAt: "2026-07-13T08:00:00Z",
    })

    reconcileRestoredTaskCache(
      { store, repositories },
      task("restored", "Restore", { projectId: "p1", deleted: 0 }),
      "2026-07-13T09:00:00Z",
    )

    expect(repositories.getTask("restored")).toMatchObject({
      id: "restored",
      deleted: false,
      fetchedAt: "2026-07-13T09:00:00Z",
    })
    expect(repositories.getFreshness("core")).toBeUndefined()
    store.close()
  })
})
