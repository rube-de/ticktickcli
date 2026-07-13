import { AppError, HttpError } from "../api/errors"
import { ResolutionError, requireResolved } from "../core/resolve"
import type { DomainProject, DomainTask, TaskPriority, TaskStatus } from "../domain/models"
import type { CachedProject, CachedTask } from "../store/repositories"
import { type SyncResult, SyncService } from "../store/sync"
import type { AppContext } from "./context"

export interface StateMetadata {
  source: "v1" | "v2" | "cache"
  fetchedAt?: string
  stale: boolean
}

export async function ensureCoreState(context: AppContext): Promise<StateMetadata> {
  const freshness = context.repositories.getFreshness("core")
  assertAccountAlignment(context, freshness?.accountFingerprint)
  const stale = !freshness || isStale(freshness.fetchedAt, context.profile.cacheTtlSeconds)

  if (context.options.offline) {
    if (!freshness) {
      throw new AppError("local_state", "Required account data is not available offline", {
        details: { resource: "core" },
      })
    }
    return { source: "cache", fetchedAt: freshness.fetchedAt, stale }
  }
  if (freshness && !context.options.fresh && (!stale || context.options.staleOk)) {
    return { source: "cache", fetchedAt: freshness.fetchedAt, stale }
  }

  const result = await synchronize(context)
  return { source: result.source, fetchedAt: result.fetchedAt, stale: false }
}

export async function forceCoreSync(context: AppContext): Promise<SyncResult> {
  if (context.options.offline) throw new AppError("invalid_input", "Network access is disabled")
  return synchronize(context)
}

export interface CoreSyncPlan {
  source: "v1" | "v2"
  strategy: "v1_project_enumeration" | "v2_full_checkpoint"
  includeInbox: boolean
  service: SyncService
}

/** Selects a host-verified sync route without performing network I/O. */
export function planCoreSync(context: AppContext): CoreSyncPlan {
  const v2Capability = context.supports("sync.full")
  if (v2Capability?.api === "v2" && context.v2) {
    return {
      source: "v2",
      strategy: "v2_full_checkpoint",
      includeInbox: false,
      service: new SyncService(context.store, { v2: context.v2 }),
    }
  }

  const v1Plan = planVerifiedV1Sync(context)
  if (v1Plan) return v1Plan

  if (!context.v1 && !context.v2) {
    throw new AppError("authentication_missing", "A v1 token or v2 session is required to sync")
  }
  // Re-run the most relevant assertion to preserve the stable host/credential error details.
  if (context.v2) context.capability("sync.full")
  context.capability("project.list")
  throw new AppError("capability_missing", "No verified sync route is available")
}

async function synchronize(context: AppContext): Promise<SyncResult> {
  const plan = planCoreSync(context)
  try {
    return await plan.service.sync({
      full: true,
      accountFingerprint: context.cacheIdentity,
      includeInbox: plan.includeInbox,
    })
  } catch (cause) {
    if (plan.source === "v2" && isKnownCapabilityUnavailable(cause)) {
      const fallback = planVerifiedV1Sync(context)
      if (fallback) {
        return fallback.service.sync({
          full: true,
          accountFingerprint: context.cacheIdentity,
          includeInbox: fallback.includeInbox,
        })
      }
    }
    if (!context.v1 && !context.v2) {
      throw new AppError("authentication_missing", "A v1 token or v2 session is required to sync", {
        cause,
      })
    }
    throw cause
  }
}

function planVerifiedV1Sync(context: AppContext): CoreSyncPlan | undefined {
  const projectList = context.supports("project.list")
  const projectData = context.supports("project.data")
  if (projectList?.api !== "v1" || projectData?.api !== "v1" || !context.v1) return undefined
  return {
    source: "v1",
    strategy: "v1_project_enumeration",
    includeInbox: context.supports("inbox.data")?.api === "v1",
    service: new SyncService(context.store, { v1: context.v1 }),
  }
}

function isKnownCapabilityUnavailable(error: unknown): boolean {
  return error instanceof HttpError && [404, 405, 501].includes(error.status)
}

export async function resolveProject(
  context: AppContext,
  query: string,
  options: { sync?: boolean } = {},
): Promise<CachedProject> {
  if (options.sync !== false) await ensureCoreState(context)
  try {
    return requireResolved(query, context.repositories.listProjects()).value
  } catch (error) {
    throw resolutionAppError(error)
  }
}

export async function resolveTask(
  context: AppContext,
  query: string,
  options: { sync?: boolean } = {},
): Promise<CachedTask> {
  if (options.sync !== false) await ensureCoreState(context)
  const candidates = context.repositories.listTasks({ includeDeleted: true }).map((task) => ({
    ...task,
    name: task.title,
  }))
  try {
    const resolved = requireResolved(query, candidates).value
    const { name: _name, ...task } = resolved
    return task
  } catch (error) {
    throw resolutionAppError(error)
  }
}

export async function resolveInboxProject(context: AppContext): Promise<CachedProject> {
  await ensureCoreState(context)
  const projects = context.repositories.listProjects()
  const matches = projects.filter((project) => {
    const rawKind = typeof project.raw.kind === "string" ? project.raw.kind.toLowerCase() : ""
    return (
      rawKind === "inbox" ||
      project.kind?.toLowerCase() === "inbox" ||
      project.name.toLowerCase() === "inbox"
    )
  })
  if (matches.length === 1) return matches[0] as CachedProject
  if (matches.length > 1) {
    throw new AppError("ambiguous", "Multiple inbox projects were discovered", {
      details: { candidates: matches.map(({ id, name }) => ({ id, name })) },
    })
  }
  throw new AppError("not_found", "The inbox project could not be discovered", {
    details: { guidance: "Specify --project explicitly." },
  })
}

export function cachedTaskToDomain(task: CachedTask): DomainTask {
  const raw = task.raw
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    kind: taskKind(raw.kind),
    status: taskStatus(task.status),
    priority: taskPriority(task.priority),
    tags: task.tags,
    reminders: stringArray(raw.reminders),
    checklist: checklistItems(raw.items ?? raw.checklist),
    isAllDay: task.isAllDay,
    source: task.source === "v2" ? "v2" : "v1",
    fetchedAt: task.fetchedAt,
    raw,
    ...(task.content ? { content: task.content } : {}),
    ...(task.description ? { description: task.description } : {}),
    ...(task.startDate ? { startDate: task.startDate, rawStartDate: task.startDate } : {}),
    ...(task.dueDate ? { dueDate: task.dueDate, rawDueDate: task.dueDate } : {}),
    ...(task.timeZone ? { timeZone: task.timeZone } : {}),
    ...(task.parentId ? { parentId: task.parentId } : {}),
    ...(task.columnId ? { columnId: task.columnId } : {}),
    ...(task.pinnedTime ? { pinnedTime: task.pinnedTime } : {}),
    ...(task.completedTime
      ? { completedTime: task.completedTime, rawCompletedTime: task.completedTime }
      : {}),
    ...(task.etag ? { etag: task.etag } : {}),
    ...(typeof raw.repeatFlag === "string"
      ? { repeatRule: raw.repeatFlag }
      : typeof raw.repeat === "string"
        ? { repeatRule: raw.repeat }
        : {}),
    deleted: task.deleted,
  }
}

export function cachedProjectToDomain(project: CachedProject): DomainProject {
  return {
    id: project.id,
    name: project.name,
    closed: project.closed,
    kind: project.raw.kind === "NOTE" ? "note" : "task",
    source: project.source === "v2" ? "v2" : "v1",
    fetchedAt: project.fetchedAt,
    raw: project.raw,
    ...(project.color ? { color: project.color } : {}),
    ...(project.groupId ? { groupId: project.groupId } : {}),
    ...(project.etag ? { etag: project.etag } : {}),
    ...(typeof project.raw.viewMode === "string" &&
    ["list", "kanban", "timeline"].includes(project.raw.viewMode.toLowerCase())
      ? { viewMode: project.raw.viewMode.toLowerCase() as "list" | "kanban" | "timeline" }
      : {}),
    isInbox:
      project.kind?.toLowerCase() === "inbox" ||
      (typeof project.raw.kind === "string" && project.raw.kind.toLowerCase() === "inbox"),
  }
}

function resolutionAppError(error: unknown): AppError {
  if (!(error instanceof ResolutionError)) {
    return new AppError("internal_error", "Entity resolution failed unexpectedly", { cause: error })
  }
  const code = error.code === "ambiguous" ? "ambiguous" : "not_found"
  return new AppError(code, error.message, {
    details: {
      query: error.query,
      resolutionCode: error.code,
      minimumPrefixLength: error.code === "prefix_too_short" ? 4 : undefined,
      candidates: error.candidates.map(({ id, name }) => ({ id, name })),
    },
  })
}

function assertAccountAlignment(context: AppContext, cacheIdentity: string | undefined): void {
  const expected = context.cacheIdentity
  if (expected && cacheIdentity && expected !== cacheIdentity) {
    throw new AppError("credential_account_mismatch", "Cached data belongs to another account", {
      details: { resource: "core" },
    })
  }
}

function isStale(fetchedAt: string, ttlSeconds: number): boolean {
  const time = Date.parse(fetchedAt)
  return !Number.isFinite(time) || Date.now() - time > ttlSeconds * 1000
}

function taskStatus(value: number): TaskStatus {
  if (value === 2) return "completed"
  if (value < 0 || value === 3) return "wont_do"
  return "open"
}

function taskPriority(value: number): TaskPriority {
  return value === 1 || value === 3 || value === 5 ? value : 0
}

function taskKind(value: unknown): "text" | "note" | "checklist" {
  if (typeof value === "string") {
    const normalized = value.toLowerCase()
    if (normalized === "note") return "note"
    if (normalized === "checklist") return "checklist"
  }
  return "text"
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function checklistItems(value: unknown): DomainTask["checklist"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    if (typeof record.id !== "string" || typeof (record.title ?? record.name) !== "string")
      return []
    return [
      {
        id: record.id,
        title: (record.title ?? record.name) as string,
        status:
          record.status === 1 || record.status === 2 ? ("completed" as const) : ("open" as const),
        ...(typeof record.sortOrder === "number" ? { sortOrder: record.sortOrder } : {}),
      },
    ]
  })
}
