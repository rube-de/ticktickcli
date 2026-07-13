import type { TaskCreateInput, TaskPatchInput } from "../../domain/inputs"
import type { ApiHost } from "../capabilities"
import {
  AppError,
  type ItemFailure,
  PartialFailureError,
  ProtocolError,
  reconcileAfterWrite,
} from "../errors"
import {
  ApiHttpClient,
  type FetchLike,
  type HttpDiagnostic,
  type HttpRequestOptions,
} from "../http"
import { mergeV2TaskPatch, toV2TaskCreate } from "./mapper"
import {
  V2ArchivedEventsSchema,
  type V2BatchColumnRequest,
  V2BatchColumnRequestSchema,
  type V2BatchFilterRequest,
  V2BatchFilterRequestSchema,
  type V2BatchProjectRequest,
  V2BatchProjectRequestSchema,
  type V2BatchResponse,
  V2BatchResponseSchema,
  type V2BatchTaskRequest,
  V2BatchTaskRequestSchema,
  type V2CalendarAccount,
  V2CalendarAccountsSchema,
  type V2CalendarEventBundle,
  V2CalendarEventBundlesSchema,
  V2CalendarSubscriptionsSchema,
  type V2Column,
  V2ColumnListSchema,
  type V2FilterWrite,
  type V2FocusDistribution,
  V2FocusDistributionSchema,
  V2FocusHeatmapSchema,
  V2FullSyncStateSchema,
  type V2GeneralStatistics,
  V2GeneralStatisticsSchema,
  type V2Project,
  type V2SyncState,
  V2SyncStateSchema,
  type V2Tag,
  V2TagListSchema,
  type V2Task,
  V2TaskListSchema,
  type V2TaskMove,
  V2TaskMoveSchema,
  type V2TaskParentSet,
  V2TaskParentSetSchema,
  type V2TaskParentUnset,
  V2TaskParentUnsetSchema,
  V2TaskSchema,
  type V2TrashResponse,
  V2TrashResponseSchema,
  type V2TrashRestoreItem,
  V2TrashRestoreItemSchema,
  V2UserPreferencesSchema,
  V2UserProfileSchema,
  type V2UserStatus,
  V2UserStatusSchema,
} from "./schemas"

export interface V2ClientOptions {
  sessionToken?: string
  sessionCookie?: string
  host?: ApiHost
  baseUrl?: string
  deviceId?: string
  deviceVersion?: number
  userAgent?: string
  http?: ApiHttpClient
  timeoutMs?: number
  maxReadRetries?: number
  readsPerSecond?: number
  fetch?: FetchLike
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
  now?: () => number
  onDiagnostic?: (diagnostic: HttpDiagnostic) => void
  /** Test/probe-only; stable capability routing never enables this while gated. */
  allowUnverifiedIncremental?: boolean
}

export interface TrashListOptions {
  start?: number
  limit?: number
}

export interface ClosedTaskQuery {
  from: string
  to: string
  limit?: number
}

export class V2Client {
  readonly host: ApiHost
  readonly http: ApiHttpClient
  private readonly allowUnverifiedIncremental: boolean

  constructor(options: V2ClientOptions) {
    this.host = options.host ?? "ticktick.com"
    this.allowUnverifiedIncremental = options.allowUnverifiedIncremental ?? false
    const cookie = sessionCookie(options)
    const deviceId = options.deviceId ?? generateObjectId()
    if (!/^[0-9a-f]{24}$/i.test(deviceId)) {
      throw new AppError("invalid_input", "The v2 device id must be a 24-character hex id")
    }

    this.http =
      options.http ??
      new ApiHttpClient({
        baseUrl: options.baseUrl ?? `https://api.${this.host}/api/v2`,
        headers: {
          cookie,
          "x-device": JSON.stringify({
            platform: "web",
            version: options.deviceVersion ?? 6430,
            id: deviceId,
          }),
          "user-agent": options.userAgent ?? "Mozilla/5.0 (compatible; TickTickCLI/0.0.1)",
        },
        timeoutMs: options.timeoutMs,
        maxReadRetries: options.maxReadRetries,
        readsPerSecond: options.readsPerSecond,
        fetch: options.fetch,
        sleep: options.sleep,
        random: options.random,
        now: options.now,
        onDiagnostic: options.onDiagnostic,
      })
  }

  request<T>(path: string, options: HttpRequestOptions<T> = {}): Promise<T | undefined> {
    return this.http.request(path, options)
  }

  batchCheck(checkpoint: string | number = "0"): Promise<V2SyncState> {
    const value = String(checkpoint)
    if (value !== "0" && !this.allowUnverifiedIncremental) {
      throw new AppError("capability_missing", "Incremental v2 sync is not live-verified", {
        details: { checkpoint: value },
      })
    }
    return this.required(`/batch/check/${segment(value)}`, {
      schema: value === "0" ? V2FullSyncStateSchema : V2SyncStateSchema,
      operation: value === "0" ? "sync.full" : "sync.incremental",
    })
  }

  getUserStatus(): Promise<V2UserStatus> {
    return this.required("/user/status", { schema: V2UserStatusSchema, operation: "auth.status" })
  }

  getUserProfile(): Promise<Record<string, unknown>> {
    return this.required("/user/profile", {
      schema: V2UserProfileSchema,
      operation: "auth.profile",
    })
  }

  getUserPreferences(includeWeb = true): Promise<Record<string, unknown>> {
    return this.required("/user/preferences/settings", {
      query: { includeWeb },
      schema: V2UserPreferencesSchema,
      operation: "account.preferences",
    })
  }

  getTask(taskId: string, projectId?: string): Promise<V2Task> {
    return this.required(`/task/${segment(taskId)}`, {
      query: { projectId },
      schema: V2TaskSchema,
      operation: "task.show.v2",
    })
  }

  async batchTasks(input: V2BatchTaskRequest): Promise<V2BatchResponse> {
    const payload = V2BatchTaskRequestSchema.parse(input)
    const response = await this.required("/batch/task", {
      method: "POST",
      json: payload,
      schema: V2BatchResponseSchema,
      retry: "reconcilable",
      operation: "task.batch",
    })
    assertBatchResponse(response, "task batch")
    return response
  }

  async createTask(input: TaskCreateInput): Promise<V2Task> {
    const id = generateObjectId()
    const plan = toV2TaskCreate(input, id)
    await this.batchTasks({ add: [plan.task] })
    let task = await reconcileAfterWrite("task.add", { taskId: id }, () =>
      this.getTask(id, input.projectId),
    )
    if (plan.parentId) {
      task = await reconcileAfterWrite("task.parent.assign", { taskId: id }, async () => {
        await this.setTaskParents([
          { taskId: id, projectId: input.projectId, parentId: plan.parentId as string },
        ])
        const readback = await this.getTask(id, input.projectId)
        if (readback.parentId !== plan.parentId) {
          throw new ProtocolError("Task parent write was not visible on readback", { taskId: id })
        }
        return readback
      })
    }
    return task
  }

  async updateTask(taskId: string, projectId: string, patch: TaskPatchInput): Promise<V2Task> {
    const current = await this.getTask(taskId, projectId)
    await this.batchTasks({ update: [mergeV2TaskPatch(current, patch)] })
    return reconcileAfterWrite("task.edit", { taskId }, async () => {
      if (patch.parentId !== undefined && patch.parentId !== current.parentId) {
        if (patch.parentId === null) {
          if (current.parentId) {
            await this.unsetTaskParents([
              { taskId, projectId: patch.projectId ?? projectId, oldParentId: current.parentId },
            ])
          }
        } else {
          await this.setTaskParents([
            { taskId, projectId: patch.projectId ?? projectId, parentId: patch.parentId },
          ])
        }
      }
      return this.getTask(taskId, patch.projectId ?? projectId)
    })
  }

  async pinTask(taskId: string, projectId: string, pinnedTime = v2Timestamp()): Promise<V2Task> {
    const current = await this.getTask(taskId, projectId)
    await this.batchTasks({ update: [{ ...current, id: taskId, projectId, pinnedTime }] })
    return reconcileAfterWrite("task.pin", { taskId }, async () => {
      const readback = await this.getTask(taskId, projectId)
      if (!readback.pinnedTime || readback.pinnedTime === "-1") {
        throw new ProtocolError("Pin write was not visible on readback", { taskId })
      }
      return readback
    })
  }

  async unpinTask(taskId: string, projectId: string): Promise<V2Task> {
    const current = await this.getTask(taskId, projectId)
    await this.batchTasks({
      update: [{ ...current, id: taskId, projectId, pinnedTime: "-1" }],
    })
    return reconcileAfterWrite("task.unpin", { taskId }, async () => {
      const readback = await this.getTask(taskId, projectId)
      if (readback.pinnedTime && readback.pinnedTime !== "-1") {
        throw new ProtocolError("Unpin write was not visible on readback", { taskId })
      }
      return readback
    })
  }

  async moveTasks(moves: readonly V2TaskMove[]): Promise<V2BatchResponse> {
    const payload = moves.map((move) => V2TaskMoveSchema.parse(move))
    const response = await this.required("/batch/taskProject", {
      method: "POST",
      json: payload,
      schema: V2BatchResponseSchema,
      retry: "reconcilable",
      operation: "task.move.v2",
    })
    assertBatchResponse(response, "task move")
    return response
  }

  async setTaskParents(items: readonly V2TaskParentSet[]): Promise<V2BatchResponse> {
    return this.taskParentRequest(items.map((item) => V2TaskParentSetSchema.parse(item)))
  }

  async unsetTaskParents(items: readonly V2TaskParentUnset[]): Promise<V2BatchResponse> {
    return this.taskParentRequest(items.map((item) => V2TaskParentUnsetSchema.parse(item)))
  }

  completedTasks(query: ClosedTaskQuery): Promise<V2Task[]> {
    return this.closedTasks("Completed", query)
  }

  /** Source-backed only; stable capability routing keeps this hidden until probed. */
  abandonedTasks(query: ClosedTaskQuery): Promise<V2Task[]> {
    return this.closedTasks("Abandoned", query)
  }

  listTrash(options: TrashListOptions = {}): Promise<V2TrashResponse> {
    return this.required("/project/all/trash/pagination", {
      query: { start: options.start ?? 0, limit: options.limit ?? 500 },
      schema: V2TrashResponseSchema,
      operation: "trash.list",
    })
  }

  listTrashPage(cursor?: string): Promise<V2TrashResponse> {
    return this.required("/project/all/trash/page", {
      query: { from: cursor },
      schema: V2TrashResponseSchema,
      operation: "trash.list",
    })
  }

  async restoreTrash(items: readonly V2TrashRestoreItem[]): Promise<V2BatchResponse> {
    const payload = items.map((item) => V2TrashRestoreItemSchema.parse(item))
    const response = await this.required("/trash/restore", {
      method: "POST",
      json: payload,
      schema: V2BatchResponseSchema,
      retry: "reconcilable",
      operation: "trash.restore",
    })
    assertBatchResponse(response, "trash restore")
    await reconcileAfterWrite(
      "trash.restore",
      { taskIds: payload.map(({ taskId }) => taskId) },
      async () => {
        for (const item of payload) {
          const task = await this.getTask(item.taskId, item.toProjectId)
          if (task.deleted === 1) {
            throw new ProtocolError("Trash restore returned success but the task remains deleted", {
              taskId: item.taskId,
            })
          }
        }
      },
    )
    return response
  }

  async renameTag(name: string, newName: string): Promise<void> {
    await this.request("/tag/rename", {
      method: "PUT",
      json: { name, newName },
      responseMode: "JSON_OPTIONAL",
      retry: "reconcilable",
      operation: "tag.rename",
    })
    await reconcileAfterWrite("tag.rename", { name, newName }, async () => {
      const tags = await this.syncedTags()
      if (tags.some((tag) => tag.name === name) || !tags.some((tag) => tag.name === newName)) {
        throw new ProtocolError("Tag rename was not visible on readback", { name, newName })
      }
    })
  }

  async mergeTags(name: string, newName: string): Promise<void> {
    await this.request("/tag/merge", {
      method: "PUT",
      json: { name, newName },
      responseMode: "JSON_OPTIONAL",
      retry: "reconcilable",
      operation: "tag.merge",
    })
    await reconcileAfterWrite("tag.merge", { name, newName }, async () => {
      const tags = await this.syncedTags()
      if (tags.some((tag) => tag.name === name) || !tags.some((tag) => tag.name === newName)) {
        throw new ProtocolError("Tag merge was not visible on readback", { name, newName })
      }
    })
  }

  async deleteTag(name: string): Promise<void> {
    await this.request("/tag", {
      method: "DELETE",
      query: { name },
      responseMode: "NO_CONTENT",
      retry: "reconcilable",
      operation: "tag.delete",
    })
    await reconcileAfterWrite("tag.delete", { name }, async () => {
      if ((await this.syncedTags()).some((tag) => tag.name === name)) {
        throw new ProtocolError("Tag delete was not visible on readback", { name })
      }
    })
  }

  async batchFilters(input: V2BatchFilterRequest): Promise<V2BatchResponse> {
    const payload = V2BatchFilterRequestSchema.parse(input)
    const response = await this.required("/batch/filter", {
      method: "POST",
      json: payload,
      schema: V2BatchResponseSchema,
      retry: "reconcilable",
      operation: "filter.batch",
    })
    assertBatchResponse(response, "filter batch")
    await reconcileAfterWrite(
      "filter.batch",
      {
        filterIds: [...payload.add, ...payload.update].map(({ id }) => id),
        deleted: payload.delete,
      },
      async () => {
        const filters = (await this.batchCheck("0")).filters ?? []
        for (const filter of [...payload.add, ...payload.update]) {
          if (!filters.some((candidate) => candidate.id === filter.id)) {
            throw new ProtocolError("Filter write was not visible on readback", {
              filterId: filter.id,
            })
          }
        }
        for (const id of payload.delete) {
          if (filters.some((candidate) => candidate.id === id)) {
            throw new ProtocolError("Filter delete was not visible on readback", { filterId: id })
          }
        }
      },
    )
    return response
  }

  createFilter(name: string, rule: unknown, sortOrder: number): Promise<V2BatchResponse> {
    const filter: V2FilterWrite = {
      id: generateObjectId(),
      name,
      rule: typeof rule === "string" ? rule : JSON.stringify(rule),
      sortOrder,
    }
    return this.batchFilters({ add: [filter] })
  }

  async batchProjects(input: V2BatchProjectRequest): Promise<V2BatchResponse> {
    const payload = V2BatchProjectRequestSchema.parse(input)
    const response = await this.required("/batch/project", {
      method: "POST",
      json: payload,
      schema: V2BatchResponseSchema,
      retry: "reconcilable",
      operation: "project.batch",
    })
    assertBatchResponse(response, "project batch")
    return response
  }

  async setProjectArchived(projectId: string, closed: boolean): Promise<V2Project> {
    const sync = await this.batchCheck("0")
    const current = (sync.projectProfiles ?? []).find((project) => project.id === projectId)
    if (!current) throw new AppError("not_found", "Project not found", { details: { projectId } })
    await this.batchProjects({ update: [{ ...current, id: projectId, closed }] })
    return reconcileAfterWrite("project.archive", { projectId, closed }, async () => {
      const readback = (await this.batchCheck("0")).projectProfiles?.find(
        (project) => project.id === projectId,
      )
      if (!readback || (readback.closed === true) !== closed) {
        throw new ProtocolError("Project archive write was not visible on readback", { projectId })
      }
      return readback
    })
  }

  listColumns(projectId: string): Promise<V2Column[]> {
    return this.required(`/column/project/${segment(projectId)}`, {
      schema: V2ColumnListSchema,
      operation: "column.list.v2",
    })
  }

  async batchColumns(input: V2BatchColumnRequest): Promise<V2BatchResponse> {
    const payload = V2BatchColumnRequestSchema.parse(input)
    const response = await this.required("/column", {
      method: "POST",
      json: payload,
      schema: V2BatchResponseSchema,
      retry: "reconcilable",
      operation: "column.batch",
    })
    assertBatchResponse(response, "column batch")
    return response
  }

  async deleteColumn(projectId: string, columnId: string): Promise<void> {
    await this.batchColumns({ delete: [{ columnId, projectId }] })
    await reconcileAfterWrite("column.delete", { projectId, columnId }, async () => {
      if ((await this.listColumns(projectId)).some((column) => column.id === columnId)) {
        throw new ProtocolError("Column delete was not visible on readback", {
          projectId,
          columnId,
        })
      }
    })
  }

  getGeneralStatistics(): Promise<V2GeneralStatistics> {
    return this.required("/statistics/general", {
      schema: V2GeneralStatisticsSchema,
      operation: "stats.general",
    })
  }

  getFocusHeatmap(from: string, to: string): Promise<unknown[]> {
    return this.required(`/pomodoros/statistics/heatmap/${dateStamp(from)}/${dateStamp(to)}`, {
      schema: V2FocusHeatmapSchema,
      operation: "focus.heatmap",
    })
  }

  getFocusDistribution(from: string, to: string): Promise<V2FocusDistribution> {
    return this.required(`/pomodoros/statistics/dist/${dateStamp(from)}/${dateStamp(to)}`, {
      schema: V2FocusDistributionSchema,
      operation: "focus.stats",
    })
  }

  getCalendarAccounts(): Promise<V2CalendarAccount[]> {
    return this.required("/calendar/third/accounts", {
      schema: V2CalendarAccountsSchema,
      operation: "calendar.accounts",
    })
  }

  getCalendarSubscriptions(): Promise<Record<string, unknown>[]> {
    return this.required("/calendar/subscription", {
      schema: V2CalendarSubscriptionsSchema,
      operation: "calendar.subscriptions",
    })
  }

  getCalendarEvents(): Promise<V2CalendarEventBundle[]> {
    return this.required("/calendar/bind/events/all", {
      schema: V2CalendarEventBundlesSchema,
      operation: "calendar.events",
    })
  }

  getArchivedCalendarEvents(): Promise<unknown[]> {
    return this.required("/calendar/archivedEvent", {
      schema: V2ArchivedEventsSchema,
      operation: "calendar.archived",
    })
  }

  /** Source-backed read with a local-cache fallback; not selected by stable capability lookup. */
  async searchAll(keywords: string): Promise<unknown> {
    if (keywords.trim().length === 0) throw new AppError("invalid_input", "Search text is required")
    return this.request("/search/all", {
      query: { keywords },
      operation: "search.remote",
    })
  }

  private async taskParentRequest(
    payload: readonly (V2TaskParentSet | V2TaskParentUnset)[],
  ): Promise<V2BatchResponse> {
    const response = await this.required("/batch/taskParent", {
      method: "POST",
      json: payload,
      schema: V2BatchResponseSchema,
      retry: "reconcilable",
      operation: "task.parent",
    })
    assertBatchResponse(response, "task parent")
    return response
  }

  private closedTasks(
    status: "Completed" | "Abandoned",
    query: ClosedTaskQuery,
  ): Promise<V2Task[]> {
    return this.required("/project/all/closed", {
      query: {
        from: fullDateTime(query.from),
        to: fullDateTime(query.to),
        status,
        limit: query.limit ?? 100,
      },
      schema: V2TaskListSchema,
      operation: status === "Completed" ? "task.completed.v2" : "task.abandoned",
    })
  }

  private async syncedTags(): Promise<readonly V2Tag[]> {
    const sync = await this.batchCheck("0")
    return V2TagListSchema.parse(sync.tags ?? [])
  }

  private async required<T>(path: string, options: HttpRequestOptions<T>): Promise<T> {
    const value = await this.request(path, { ...options, responseMode: "JSON_REQUIRED" })
    if (value === undefined) {
      throw new ProtocolError("The API returned no JSON for a required response", {
        path,
        operation: options.operation,
      })
    }
    return value
  }
}

export function assertBatchResponse(response: V2BatchResponse, operation: string): void {
  const failures: ItemFailure[] = []
  for (const [id, raw] of Object.entries(response.id2error)) {
    const message = batchErrorMessage(raw)
    failures.push({ id, code: batchErrorCode(raw), message })
  }
  if (failures.length > 0) {
    throw new PartialFailureError(
      `${operation} partially failed`,
      failures,
      Object.keys(response.id2etag),
    )
  }
}

export function generateObjectId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")
}

function sessionCookie(options: V2ClientOptions): string {
  const full = options.sessionCookie?.trim()
  if (full) {
    if (/[\r\n]/.test(full)) throw new AppError("invalid_input", "The session cookie is malformed")
    return full
  }
  const token = options.sessionToken?.trim()
  if (!token)
    throw new AppError("authentication_missing", "A v2 session token or cookie is required")
  if (/[;\r\n]/.test(token)) throw new AppError("invalid_input", "The session token is malformed")
  return `t=${token}`
}

function batchErrorMessage(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const candidate of [record.message, record.errorMessage, record.code]) {
      if (typeof candidate === "string") return candidate
    }
  }
  return "Unknown batch error"
}

function batchErrorCode(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    for (const candidate of [record.code, record.errorCode]) {
      if (typeof candidate === "string") return candidate
    }
  }
  return "batch_error"
}

function fullDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) throw new AppError("invalid_input", "Invalid history date")
  return parsed.toISOString().replace("T", " ").slice(0, 19)
}

function dateStamp(value: string): string {
  if (/^\d{8}$/.test(value)) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "")
  throw new AppError("invalid_input", "Expected YYYY-MM-DD or YYYYMMDD")
}

function v2Timestamp(date = new Date()): string {
  return date.toISOString().replace(/Z$/, "+0000")
}

function segment(value: string): string {
  if (value.length === 0) throw new AppError("invalid_input", "Resource id cannot be empty")
  return encodeURIComponent(value)
}
