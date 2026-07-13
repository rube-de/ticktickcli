import { ProtocolError } from "../api/errors"
import type { StoreDatabase } from "./db"
import { Repositories, type WireRecord } from "./repositories"

export interface V1SyncClient {
  listProjects(): Promise<unknown>
  getProjectData(projectId: string): Promise<unknown>
  getInboxData?(): Promise<unknown>
}

export interface V2SyncClient {
  batchCheck(checkpoint: string): Promise<unknown>
}

export interface SyncOptions {
  full?: boolean
  /** Incremental wire deltas are host-gated until their shapes are live verified. */
  allowIncremental?: boolean
  accountFingerprint?: string
  includeInbox?: boolean
}

export interface SyncResult {
  source: "v1" | "v2"
  full: boolean
  checkpoint?: string
  projects: number
  tasks: number
  deletedProjects: number
  deletedTasks: number
  fetchedAt: string
}

export class SyncService {
  private readonly repositories: Repositories

  constructor(
    private readonly store: StoreDatabase,
    private readonly clients: { v1?: V1SyncClient; v2?: V2SyncClient },
  ) {
    this.repositories = new Repositories(store)
  }

  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    if (this.clients.v2) return this.syncV2(options)
    if (this.clients.v1) return this.syncV1(options)
    throw new Error("No sync-capable credential is available")
  }

  private async syncV2(options: SyncOptions): Promise<SyncResult> {
    const previous = this.repositories.getFreshness("core")
    // Incremental deltas remain host-gated. A caller explicitly requesting full always sends 0.
    const checkpoint =
      options.allowIncremental && !options.full ? (previous?.checkpoint ?? "0") : "0"
    const payload = objectValue(await this.clients.v2?.batchCheck(checkpoint))
    const full = checkpoint === "0"
    if (full) assertAuthoritativeV2Snapshot(payload)
    const nextCheckpoint = checkpointValue(payload) ?? checkpoint
    const projects = recordArray(
      payload.projectProfiles ?? payload.projects ?? payload.projectProfile,
    )
    const tasks = collectTasks(payload)
    const groups = recordArray(payload.projectGroups)
    const tags = recordArray(payload.tags)
    const filters = recordArray(payload.filters)
    const columns = collectColumns(payload, projects)
    const syncTaskBean = objectValue(payload.syncTaskBean)
    const deletedProjects = stringIds(payload.deletedProjectIds ?? payload.projectDeletes)
    const deletedTasks = stringIds(
      payload.deletedTaskIds ?? payload.taskDeletes ?? syncTaskBean.delete,
    )
    const filtersAuthoritative = Array.isArray(payload.filters)
    const columnsAuthoritative =
      Array.isArray(payload.columns) ||
      (projects.length > 0 && projects.every((project) => Array.isArray(project.columns)))
    const fetchedAt = new Date().toISOString()

    this.store.transaction(() => {
      this.repositories.upsertProjects(projects, "v2", fetchedAt)
      this.repositories.upsertTasks(tasks, "v2", fetchedAt)
      this.repositories.upsertGroups(groups, "v2", fetchedAt)
      this.repositories.upsertTags(tags, "v2", fetchedAt)
      this.repositories.upsertFilters(filters, "v2", fetchedAt)
      this.repositories.upsertColumns(columns, "v2", fetchedAt)
      this.repositories.deleteProjects(deletedProjects)
      this.repositories.deleteTasks(deletedTasks)
      if (full) {
        this.repositories.reconcileIds(
          "projects",
          new Set(projects.map((item) => requiredId(item))),
        )
        this.repositories.reconcileIds("tasks", new Set(tasks.map((item) => requiredId(item))))
        this.repositories.reconcileResource(
          "project_groups",
          new Set(groups.map((item) => requiredId(item))),
        )
        if (columnsAuthoritative) {
          this.repositories.reconcileResource(
            "columns",
            new Set(columns.map((item) => requiredId(item))),
          )
        }
        if (filtersAuthoritative) {
          this.repositories.reconcileResource(
            "filters",
            new Set(filters.map((item) => requiredId(item))),
          )
        }
        this.repositories.reconcileTags(
          new Set(tags.flatMap((item) => (stringValue(item.name) ? [item.name as string] : []))),
        )
      }
      this.repositories.setFreshness({
        resource: "core",
        fetchedAt,
        source: "v2",
        checkpoint: nextCheckpoint,
        ...(options.accountFingerprint ? { accountFingerprint: options.accountFingerprint } : {}),
      })
    })

    return {
      source: "v2",
      full,
      checkpoint: nextCheckpoint,
      projects: projects.length,
      tasks: tasks.length,
      deletedProjects: deletedProjects.length,
      deletedTasks: deletedTasks.length,
      fetchedAt,
    }
  }

  private async syncV1(options: SyncOptions): Promise<SyncResult> {
    const client = this.clients.v1
    if (!client) throw new Error("No v1 client is available")
    const projects = requiredRecordArray(await client.listProjects(), "v1 project list")
    const allProjects = [...projects]
    const tasks: WireRecord[] = []
    const columns: WireRecord[] = []
    for (const project of projects) {
      const projectId = requiredId(project)
      const data = requiredRecord(await client.getProjectData(projectId), "v1 project data")
      tasks.push(
        ...requiredRecordArray(data.tasks, "v1 project tasks").map((task) =>
          withProjectId(task, projectId),
        ),
      )
      columns.push(
        ...requiredRecordArray(data.columns, "v1 project columns").map((column) =>
          stringValue(column.projectId) ? column : { ...column, projectId },
        ),
      )
    }
    if (options.includeInbox === true) {
      if (!client.getInboxData) {
        throw new ProtocolError("The selected v1 sync route cannot fetch inbox data")
      }
      const inbox = requiredRecord(await client.getInboxData(), "v1 inbox data")
      const inboxProject = requiredRecord(inbox.project ?? inbox.projectProfile, "v1 inbox project")
      const inboxId = stringValue(inboxProject.id) ?? stringValue(inbox.id)
      if (!inboxId) throw new ProtocolError("The v1 inbox response is missing its project id")
      if (!allProjects.some((project) => project.id === inboxId)) {
        allProjects.push({
          ...inboxProject,
          id: inboxId,
          name: stringValue(inboxProject.name) ?? "Inbox",
          kind: "INBOX",
        })
      }
      tasks.push(
        ...requiredRecordArray(inbox.tasks, "v1 inbox tasks").map((task) =>
          withProjectId(task, inboxId),
        ),
      )
      columns.push(
        ...requiredRecordArray(inbox.columns, "v1 inbox columns").map((column) =>
          stringValue(column.projectId) ? column : { ...column, projectId: inboxId },
        ),
      )
    }
    const fetchedAt = new Date().toISOString()
    this.store.transaction(() => {
      this.repositories.upsertProjects(allProjects, "v1", fetchedAt)
      this.repositories.upsertTasks(tasks, "v1", fetchedAt)
      this.repositories.upsertColumns(columns, "v1", fetchedAt)
      this.repositories.reconcileIds(
        "projects",
        new Set(allProjects.map((item) => requiredId(item))),
      )
      this.repositories.reconcileIds("tasks", new Set(tasks.map((item) => requiredId(item))))
      this.repositories.reconcileResource(
        "columns",
        new Set(columns.map((item) => requiredId(item))),
      )
      this.repositories.setFreshness({
        resource: "core",
        fetchedAt,
        source: "v1",
        ...(options.accountFingerprint ? { accountFingerprint: options.accountFingerprint } : {}),
      })
    })
    return {
      source: "v1",
      full: true,
      projects: allProjects.length,
      tasks: tasks.length,
      deletedProjects: 0,
      deletedTasks: 0,
      fetchedAt,
    }
  }
}

function assertAuthoritativeV2Snapshot(payload: WireRecord): void {
  const missing: string[] = []
  if (!stringValue(payload.inboxId)) missing.push("inboxId")
  for (const key of ["projectProfiles", "projectGroups", "tags"] as const) {
    if (!Array.isArray(payload[key])) missing.push(key)
  }
  const taskBean = objectValue(payload.syncTaskBean)
  if (!payload.syncTaskBean || !Array.isArray(taskBean.update)) missing.push("syncTaskBean.update")
  if (missing.length > 0) {
    throw new ProtocolError("The v2 full-sync response is not an authoritative snapshot", {
      missing,
    })
  }
}

function collectColumns(payload: WireRecord, projects: WireRecord[]): WireRecord[] {
  const columns = recordArray(payload.columns)
  for (const project of projects) {
    const projectId = stringValue(project.id)
    if (!projectId) continue
    for (const column of recordArray(project.columns)) {
      columns.push(stringValue(column.projectId) ? column : { ...column, projectId })
    }
  }
  return columns.filter((column) => stringValue(column.id) && stringValue(column.projectId))
}

function collectTasks(payload: WireRecord): WireRecord[] {
  const direct = recordArray(payload.tasks ?? payload.taskProfiles ?? payload.taskProfile)
  const syncTaskBean = objectValue(payload.syncTaskBean)
  direct.push(...recordArray(syncTaskBean.add), ...recordArray(syncTaskBean.update))
  const projectData = recordArray(payload.projectData)
  for (const project of projectData) {
    const projectId = stringValue(project.id ?? project.projectId)
    for (const task of recordArray(project.tasks))
      direct.push(projectId ? withProjectId(task, projectId) : task)
  }
  return direct.filter((task) => stringValue(task.id) && stringValue(task.projectId))
}

function checkpointValue(payload: WireRecord): string | undefined {
  const value = payload.checkPoint ?? payload.checkpoint ?? payload.syncTaskBean
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return checkpointValue(value as WireRecord)
  }
  return undefined
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return [item]
    const record = objectValue(item)
    const id = stringValue(record.id ?? record.taskId ?? record.projectId)
    return id ? [id] : []
  })
}

function recordArray(value: unknown): WireRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is WireRecord =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : []
}

function requiredRecordArray(value: unknown, label: string): WireRecord[] {
  if (!Array.isArray(value)) throw new ProtocolError(`${label} must be an array`)
  return recordArray(value)
}

function requiredRecord(value: unknown, label: string): WireRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError(`${label} must be an object`)
  }
  return value as WireRecord
}

function objectValue(value: unknown): WireRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as WireRecord
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function requiredId(record: WireRecord): string {
  const id = stringValue(record.id)
  if (!id) throw new TypeError("Sync entity is missing id")
  return id
}

function withProjectId(task: WireRecord, projectId: string): WireRecord {
  return stringValue(task.projectId) ? task : { ...task, projectId }
}
