import type {
  FocusInput,
  HabitInput,
  ProjectInput,
  TaskCreateInput,
  TaskPatchInput,
} from "../../domain/inputs"
import type { ApiHost } from "../capabilities"
import { AppError, ProtocolError } from "../errors"
import {
  ApiHttpClient,
  type FetchLike,
  type HttpDiagnostic,
  type HttpRequestOptions,
} from "../http"
import {
  toV1FocusInput,
  toV1HabitInput,
  toV1ProjectInput,
  toV1TaskCreate,
  toV1TaskPatch,
} from "./mapper"
import {
  type V1Column,
  V1ColumnListSchema,
  V1ColumnSchema,
  type V1Comment,
  V1CommentListSchema,
  V1CommentSchema,
  type V1CompletedTaskFilter,
  V1CompletedTaskFilterSchema,
  type V1Countdown,
  V1CountdownListSchema,
  type V1Focus,
  V1FocusCreateSchema,
  V1FocusListSchema,
  V1FocusSchema,
  type V1Group,
  V1GroupListSchema,
  V1GroupSchema,
  type V1Habit,
  type V1HabitCheckinAggregate,
  V1HabitCheckinAggregateListSchema,
  V1HabitCheckinAggregateSchema,
  type V1HabitCheckinInput,
  V1HabitCheckinInputSchema,
  V1HabitListSchema,
  V1HabitSchema,
  type V1MoveTaskResult,
  V1MoveTaskResultListSchema,
  type V1Project,
  type V1ProjectData,
  V1ProjectDataSchema,
  V1ProjectListSchema,
  V1ProjectSchema,
  type V1Tag,
  V1TagListSchema,
  V1TagSchema,
  type V1Task,
  type V1TaskFilter,
  V1TaskFilterSchema,
  V1TaskListSchema,
  V1TaskSchema,
} from "./schemas"

export interface V1ClientOptions {
  accessToken: string
  host?: ApiHost
  baseUrl?: string
  http?: ApiHttpClient
  timeoutMs?: number
  maxReadRetries?: number
  readsPerSecond?: number
  fetch?: FetchLike
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
  now?: () => number
  onDiagnostic?: (diagnostic: HttpDiagnostic) => void
}

export interface V1MoveTaskInput {
  taskId: string
  fromProjectId: string
  toProjectId: string
  sortOrder?: number
}

export class V1Client {
  readonly host: ApiHost
  readonly http: ApiHttpClient

  constructor(options: V1ClientOptions) {
    const token = options.accessToken.trim()
    if (token.length === 0)
      throw new AppError("authentication_missing", "A v1 access token is required")
    if (/[\r\n]/.test(token)) throw new AppError("invalid_input", "The access token is malformed")

    this.host = options.host ?? "ticktick.com"
    this.http =
      options.http ??
      new ApiHttpClient({
        baseUrl: options.baseUrl ?? `https://api.${this.host}/open/v1`,
        headers: { authorization: `Bearer ${token}` },
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

  listProjects(): Promise<V1Project[]> {
    return this.required("/project", { schema: V1ProjectListSchema, operation: "project.list" })
  }

  getProject(projectId: string): Promise<V1Project> {
    return this.required(`/project/${segment(projectId)}`, {
      schema: V1ProjectSchema,
      operation: "project.show",
    })
  }

  getProjectData(projectId: string): Promise<V1ProjectData> {
    return this.required(`/project/${segment(projectId)}/data`, {
      schema: V1ProjectDataSchema,
      operation: "project.data",
    })
  }

  getInboxData(): Promise<V1ProjectData> {
    return this.required("/project/inbox/data", {
      schema: V1ProjectDataSchema,
      operation: "inbox.data",
    })
  }

  createProject(input: ProjectInput): Promise<V1Project | undefined> {
    return this.request("/project", {
      method: "POST",
      json: toV1ProjectInput(input),
      schema: V1ProjectSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "project.add",
    })
  }

  updateProject(projectId: string, patch: Partial<ProjectInput>): Promise<V1Project | undefined> {
    return this.request(`/project/${segment(projectId)}`, {
      method: "POST",
      json: toV1ProjectInput(patch),
      schema: V1ProjectSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "project.edit",
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request(`/project/${segment(projectId)}`, {
      method: "DELETE",
      responseMode: "NO_CONTENT",
      retry: "never",
      operation: "project.delete",
    })
  }

  getTask(projectId: string, taskId: string): Promise<V1Task> {
    return this.required(`/project/${segment(projectId)}/task/${segment(taskId)}`, {
      schema: V1TaskSchema,
      operation: "task.show",
    })
  }

  createTask(input: TaskCreateInput): Promise<V1Task | undefined> {
    return this.request("/task", {
      method: "POST",
      json: toV1TaskCreate(input),
      schema: V1TaskSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "task.add",
    })
  }

  updateTask(
    taskId: string,
    projectId: string,
    patch: TaskPatchInput,
  ): Promise<V1Task | undefined> {
    return this.request(`/task/${segment(taskId)}`, {
      method: "POST",
      json: toV1TaskPatch(taskId, projectId, patch),
      schema: V1TaskSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "task.edit",
    })
  }

  reopenTask(taskId: string, projectId: string): Promise<V1Task | undefined> {
    return this.request(`/task/${segment(taskId)}`, {
      method: "POST",
      json: { id: taskId, projectId, status: 0 },
      schema: V1TaskSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "task.reopen",
    })
  }

  async completeTask(projectId: string, taskId: string): Promise<void> {
    await this.request(`/project/${segment(projectId)}/task/${segment(taskId)}/complete`, {
      method: "POST",
      responseMode: "NO_CONTENT",
      retry: "never",
      operation: "task.complete",
    })
  }

  async deleteTask(projectId: string, taskId: string): Promise<void> {
    await this.request(`/project/${segment(projectId)}/task/${segment(taskId)}`, {
      method: "DELETE",
      responseMode: "NO_CONTENT",
      retry: "never",
      operation: "task.delete",
    })
  }

  async moveTask(
    taskId: string,
    fromProjectId: string,
    toProjectId: string,
  ): Promise<V1MoveTaskResult | undefined> {
    const results = await this.moveTasks([{ taskId, fromProjectId, toProjectId }])
    return results?.[0]
  }

  moveTasks(moves: readonly V1MoveTaskInput[]): Promise<V1MoveTaskResult[] | undefined> {
    return this.request("/task/move", {
      method: "POST",
      json: moves,
      schema: V1MoveTaskResultListSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "task.move",
    })
  }

  completedTasks(filter: V1CompletedTaskFilter = {}): Promise<V1Task[] | undefined> {
    return this.request("/task/completed", {
      method: "POST",
      json: V1CompletedTaskFilterSchema.parse(filter),
      schema: V1TaskListSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "read",
      operation: "task.completed",
    })
  }

  filterTasks(filter: V1TaskFilter): Promise<V1Task[] | undefined> {
    return this.request("/task/filter", {
      method: "POST",
      json: V1TaskFilterSchema.parse(filter),
      schema: V1TaskListSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "read",
      operation: "task.filter",
    })
  }

  listComments(projectId: string, taskId: string): Promise<V1Comment[]> {
    return this.required(`/project/${segment(projectId)}/task/${segment(taskId)}/comments`, {
      schema: V1CommentListSchema,
      operation: "comment.list",
    })
  }

  addComment(projectId: string, taskId: string, title: string): Promise<V1Comment> {
    return this.required(`/project/${segment(projectId)}/task/${segment(taskId)}/comment`, {
      method: "POST",
      json: { title },
      schema: V1CommentSchema,
      retry: "never",
      operation: "comment.add",
    })
  }

  async deleteComment(projectId: string, taskId: string, commentId: string): Promise<void> {
    await this.request(
      `/project/${segment(projectId)}/task/${segment(taskId)}/comment/${segment(commentId)}`,
      {
        method: "DELETE",
        responseMode: "NO_CONTENT",
        retry: "never",
        operation: "comment.delete",
      },
    )
  }

  listGroups(): Promise<V1Group[]> {
    return this.required("/project/group", { schema: V1GroupListSchema, operation: "group.list" })
  }

  createGroup(name: string): Promise<V1Group> {
    return this.required("/project/group", {
      method: "POST",
      json: { name },
      schema: V1GroupSchema,
      retry: "never",
      operation: "group.add",
    })
  }

  updateGroup(groupId: string, name: string): Promise<V1Group> {
    return this.required(`/project/group/${segment(groupId)}`, {
      method: "POST",
      json: { name },
      schema: V1GroupSchema,
      retry: "never",
      operation: "group.edit",
    })
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.request(`/project/group/${segment(groupId)}`, {
      method: "DELETE",
      responseMode: "NO_CONTENT",
      retry: "never",
      operation: "group.delete",
    })
  }

  listColumns(projectId: string): Promise<V1Column[]> {
    return this.required(`/project/${segment(projectId)}/column`, {
      schema: V1ColumnListSchema,
      operation: "column.list",
    })
  }

  createColumn(projectId: string, name: string): Promise<V1Column> {
    return this.required(`/project/${segment(projectId)}/column`, {
      method: "POST",
      json: { name },
      schema: V1ColumnSchema,
      retry: "never",
      operation: "column.add",
    })
  }

  updateColumn(projectId: string, columnId: string, name: string): Promise<V1Column> {
    return this.required(`/project/${segment(projectId)}/column/${segment(columnId)}`, {
      method: "POST",
      json: { name },
      schema: V1ColumnSchema,
      retry: "never",
      operation: "column.edit",
    })
  }

  listTags(): Promise<V1Tag[]> {
    return this.required("/tag", { schema: V1TagListSchema, operation: "tag.list" })
  }

  createTag(name: string, label = name): Promise<V1Tag> {
    return this.required("/tag", {
      method: "POST",
      json: { name, label },
      schema: V1TagSchema,
      retry: "never",
      operation: "tag.add",
    })
  }

  getFocus(focusId: string, type: 0 | 1): Promise<V1Focus> {
    return this.required(`/focus/${segment(focusId)}`, {
      query: { type },
      schema: V1FocusSchema,
      operation: "focus.show",
    })
  }

  listFocus(from: string, to: string, type: 0 | 1): Promise<V1Focus[]> {
    return this.required("/focus", {
      query: { from, to, type },
      schema: V1FocusListSchema,
      operation: "focus.list",
    })
  }

  createFocus(input: FocusInput): Promise<V1Focus> {
    const payload = V1FocusCreateSchema.parse(toV1FocusInput(input))
    return this.required("/focus", {
      method: "POST",
      json: payload,
      schema: V1FocusSchema,
      retry: "never",
      operation: "focus.log",
    })
  }

  deleteFocus(focusId: string, type: 0 | 1): Promise<V1Focus> {
    return this.required(`/focus/${segment(focusId)}`, {
      method: "DELETE",
      query: { type },
      schema: V1FocusSchema,
      retry: "never",
      operation: "focus.delete",
    })
  }

  listHabits(): Promise<V1Habit[]> {
    return this.required("/habit", { schema: V1HabitListSchema, operation: "habit.list" })
  }

  getHabit(habitId: string): Promise<V1Habit> {
    return this.required(`/habit/${segment(habitId)}`, {
      schema: V1HabitSchema,
      operation: "habit.show",
    })
  }

  createHabit(input: HabitInput): Promise<V1Habit | undefined> {
    return this.request("/habit", {
      method: "POST",
      json: toV1HabitInput(input),
      schema: V1HabitSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "habit.add",
    })
  }

  updateHabit(habitId: string, patch: Partial<HabitInput>): Promise<V1Habit | undefined> {
    return this.request(`/habit/${segment(habitId)}`, {
      method: "POST",
      json: toV1HabitInput(patch),
      schema: V1HabitSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "habit.edit",
    })
  }

  checkinHabit(
    habitId: string,
    input: V1HabitCheckinInput,
  ): Promise<V1HabitCheckinAggregate | undefined> {
    return this.request(`/habit/${segment(habitId)}/checkin`, {
      method: "POST",
      json: V1HabitCheckinInputSchema.parse(input),
      schema: V1HabitCheckinAggregateSchema,
      responseMode: "JSON_OPTIONAL",
      retry: "never",
      operation: "habit.checkin",
    })
  }

  habitCheckins(
    habitIds: readonly string[],
    from: number,
    to: number,
  ): Promise<V1HabitCheckinAggregate[]> {
    if (habitIds.length === 0)
      throw new AppError("invalid_input", "At least one habit id is required")
    return this.required("/habit/checkins", {
      query: { habitIds: habitIds.join(","), from, to },
      schema: V1HabitCheckinAggregateListSchema,
      operation: "habit.log",
    })
  }

  listCountdowns(): Promise<V1Countdown[]> {
    return this.required("/countdown", {
      schema: V1CountdownListSchema,
      operation: "countdown.list",
    })
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

function segment(value: string): string {
  if (value.length === 0) throw new AppError("invalid_input", "Resource id cannot be empty")
  return encodeURIComponent(value)
}
