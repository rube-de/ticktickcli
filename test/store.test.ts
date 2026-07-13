import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AppContext } from "../src/app/context"
import { ensureCoreState } from "../src/app/state"
import { applyCompletedTaskCache } from "../src/commands/task"
import { StoreDatabase } from "../src/store/db"
import { Repositories } from "../src/store/repositories"
import { SyncService } from "../src/store/sync"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function database(name = "cache.db"): StoreDatabase {
  const root = mkdtempSync(join(tmpdir(), "tt-store-"))
  roots.push(root)
  return StoreDatabase.open(join(root, name))
}

describe("store", () => {
  test("isolates independent profile databases", () => {
    const left = database("left.db")
    const right = database("right.db")
    new Repositories(left).upsertProjects([{ id: "p1", name: "Left" }], "test")
    expect(new Repositories(left).listProjects()).toHaveLength(1)
    expect(new Repositories(right).listProjects()).toHaveLength(0)
    left.close()
    right.close()
  })

  test("rolls back entities and checkpoint together", () => {
    const db = database()
    const repositories = new Repositories(db)
    expect(() =>
      db.transaction(() => {
        repositories.upsertTasks([{ id: "t1", projectId: "p1", title: "Transient" }], "v2")
        repositories.setFreshness({
          resource: "core",
          source: "v2",
          fetchedAt: "now",
          checkpoint: "10",
        })
        throw new Error("crash")
      }),
    ).toThrow("crash")
    expect(repositories.getTask("t1")).toBeUndefined()
    expect(repositories.getFreshness("core")).toBeUndefined()
    db.close()
  })

  test("rejects a fresh cache bound to different credentials", async () => {
    const db = database()
    const repositories = new Repositories(db)
    repositories.setFreshness({
      resource: "core",
      source: "v1",
      fetchedAt: new Date().toISOString(),
      accountFingerprint: "credentials:old",
    })
    const context = {
      repositories,
      cacheIdentity: "credentials:new",
      profile: { cacheTtlSeconds: 300 },
      options: { offline: true },
    } as unknown as AppContext

    await expect(ensureCoreState(context)).rejects.toMatchObject({
      code: "credential_account_mismatch",
    })
    db.close()
  })

  test("removes completed active tasks and invalidates core freshness", () => {
    const db = database()
    const repositories = new Repositories(db)
    repositories.upsertTasks([{ id: "task-1", projectId: "project-1", title: "Active" }], "v1")
    repositories.setFreshness({
      resource: "core",
      source: "v1",
      fetchedAt: new Date().toISOString(),
    })

    applyCompletedTaskCache({ store: db, repositories }, ["task-1"])

    expect(repositories.getTask("task-1")).toBeUndefined()
    expect(repositories.getFreshness("core")).toBeUndefined()
    db.close()
  })

  test("full v2 sync reconciles deletions before advancing checkpoint", async () => {
    const db = database()
    const repositories = new Repositories(db)
    repositories.upsertProjects([{ id: "old", name: "Old" }], "v2")
    repositories.upsertTasks([{ id: "old-task", projectId: "old", title: "Old" }], "v2")
    const sync = new SyncService(db, {
      v2: {
        batchCheck: async () => ({
          inboxId: "inbox-1",
          checkPoint: 9,
          projectProfiles: [{ id: "p1", name: "Project" }],
          projectGroups: [],
          syncTaskBean: {
            update: [{ id: "t1", projectId: "p1", title: "Current" }],
          },
          tags: [],
        }),
      },
    })
    const result = await sync.sync({ full: true })
    expect(result.checkpoint).toBe("9")
    expect(repositories.getProject("old")).toBeUndefined()
    expect(repositories.getTask("old-task")).toBeUndefined()
    expect(repositories.getTask("t1")?.title).toBe("Current")
    db.close()
  })

  test("rejects a partial v2 full snapshot without wiping cache or advancing freshness", async () => {
    const db = database()
    const repositories = new Repositories(db)
    repositories.upsertProjects([{ id: "old", name: "Old" }], "v2")
    repositories.setFreshness({
      resource: "core",
      source: "v2",
      fetchedAt: "2026-07-13T10:00:00Z",
      checkpoint: "8",
    })
    const sync = new SyncService(db, {
      v2: {
        batchCheck: async () => ({
          checkPoint: 9,
          projectProfiles: [],
          syncTaskBean: { update: [] },
        }),
      },
    })

    await expect(sync.sync({ full: true })).rejects.toMatchObject({ code: "protocol_error" })
    expect(repositories.getProject("old")?.name).toBe("Old")
    expect(repositories.getFreshness("core")?.checkpoint).toBe("8")
    db.close()
  })

  test("does not reconcile a v1 snapshot when verified inbox retrieval fails", async () => {
    const db = database()
    const repositories = new Repositories(db)
    repositories.upsertProjects([{ id: "old", name: "Old" }], "v1")
    repositories.upsertTasks([{ id: "old-task", projectId: "old", title: "Old" }], "v1")
    repositories.setFreshness({
      resource: "core",
      source: "v1",
      fetchedAt: "2026-07-13T10:00:00Z",
    })
    const sync = new SyncService(db, {
      v1: {
        listProjects: async () => [{ id: "p1", name: "Current" }],
        getProjectData: async () => ({
          project: { id: "p1", name: "Current" },
          tasks: [],
          columns: [],
        }),
        getInboxData: async () => {
          throw new Error("temporary inbox failure")
        },
      },
    })

    await expect(sync.sync({ full: true, includeInbox: true })).rejects.toThrow(
      "temporary inbox failure",
    )
    expect(repositories.getProject("old")?.name).toBe("Old")
    expect(repositories.getTask("old-task")?.title).toBe("Old")
    expect(repositories.getFreshness("core")?.fetchedAt).toBe("2026-07-13T10:00:00Z")
    db.close()
  })

  test("quarantines a corrupt cache and recreates it", () => {
    const root = mkdtempSync(join(tmpdir(), "tt-corrupt-"))
    roots.push(root)
    const path = join(root, "cache.db")
    writeFileSync(path, "definitely not sqlite")
    const db = StoreDatabase.open(path)
    expect(db.integrityCheck()).toBe(true)
    db.close()
  })
})
