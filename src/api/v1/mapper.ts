import { dateOnlyToWireInstant, normalizeDateTime } from "../../core/dates"
import type {
  ChecklistItemInput,
  FocusInput,
  HabitInput,
  ProjectInput,
  TaskCreateInput,
  TaskPatchInput,
} from "../../domain/inputs"
import type {
  DomainCheckin,
  DomainChecklistItem,
  DomainColumn,
  DomainFocus,
  DomainGroup,
  DomainHabit,
  DomainProject,
  DomainTag,
  DomainTask,
  FocusType,
  ProjectKind,
  ProjectPermission,
  ProjectViewMode,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from "../../domain/models"
import { CapabilityError, ProtocolError } from "../errors"
import type {
  V1ChecklistItem,
  V1Column,
  V1Focus,
  V1Group,
  V1Habit,
  V1HabitCheckinAggregate,
  V1Project,
  V1ProjectData,
  V1Tag,
  V1Task,
} from "./schemas"

export interface MapperOptions {
  fetchedAt?: string
  defaultTimeZone?: string
}

export interface DomainProjectData {
  project: DomainProject
  tasks: readonly DomainTask[]
  columns: readonly DomainColumn[]
}

export interface V1TaskCreatePayload {
  title: string
  projectId: string
  parentId?: string
  content?: string
  desc?: string
  isAllDay?: boolean
  startDate?: string
  dueDate?: string
  timeZone?: string
  reminders?: readonly string[]
  tags?: readonly string[]
  repeatFlag?: string
  priority?: TaskPriority
  sortOrder?: number
  items?: readonly V1ChecklistItemPayload[]
}

export interface V1ChecklistItemPayload {
  id?: string
  title: string
  status?: number
  sortOrder?: number
  startDate?: string
  isAllDay?: boolean
  timeZone?: string
}

export interface V1TaskPatchPayload {
  id: string
  projectId: string
  title?: string
  parentId?: string | null
  content?: string | null
  desc?: string | null
  isAllDay?: boolean
  startDate?: string | null
  dueDate?: string | null
  timeZone?: string | null
  reminders?: readonly string[]
  tags?: readonly string[]
  repeatFlag?: string | null
  priority?: TaskPriority
  sortOrder?: number
  items?: readonly V1ChecklistItemPayload[]
}

export interface V1ProjectPayload {
  name: string
  color?: string
  groupId?: string | null
  viewMode?: ProjectViewMode
  kind?: "TASK" | "NOTE"
  sortOrder?: number
}

export interface V1HabitPayload {
  name: string
  iconRes?: string
  color?: string
  encouragement?: string
  type?: string
  goal?: number
  step?: number
  unit?: string
  repeatRule?: string
  reminders?: readonly string[]
  exDates?: readonly string[]
  sortOrder?: number
  sectionId?: string
  targetDays?: number
  targetStartDate?: number
  recordEnable?: boolean
}

export interface V1FocusPayload {
  type: 0 | 1
  taskId?: string
  note?: string
  startTime: string
  endTime?: string
  duration: number
  pauseDuration?: number
}

export function mapV1Task(task: V1Task, options: MapperOptions = {}): DomainTask {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const timeZone = task.timeZone ?? options.defaultTimeZone ?? "UTC"
  const isAllDay = task.isAllDay ?? false
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    kind: taskKind(task.kind, task.items),
    status: taskStatus(task.status),
    priority: taskPriority(task.priority),
    tags: task.tags ?? [],
    reminders: task.reminders ?? [],
    checklist: (task.items ?? []).map((item, index) =>
      mapChecklistItem(item, task.id, index, timeZone, fetchedAt),
    ),
    isAllDay,
    source: "v1",
    fetchedAt,
    raw: task,
    ...(task.etag === undefined ? {} : { etag: task.etag }),
    ...(task.content === undefined ? {} : { content: task.content }),
    ...(task.desc === undefined ? {} : { description: task.desc }),
    ...(task.timeZone === undefined ? {} : { timeZone: task.timeZone }),
    ...(normalizedOptional(task.startDate, timeZone, isAllDay, false, "startDate", task.id) ===
    undefined
      ? {}
      : {
          startDate: normalizedOptional(
            task.startDate,
            timeZone,
            isAllDay,
            false,
            "startDate",
            task.id,
          ),
          rawStartDate: task.startDate,
        }),
    ...(normalizedOptional(task.dueDate, timeZone, isAllDay, false, "dueDate", task.id) ===
    undefined
      ? {}
      : {
          dueDate: normalizedOptional(task.dueDate, timeZone, isAllDay, false, "dueDate", task.id),
          rawDueDate: task.dueDate,
        }),
    ...(normalizedOptional(task.completedTime, timeZone, false, false, "completedTime", task.id) ===
    undefined
      ? {}
      : {
          completedTime: normalizedOptional(
            task.completedTime,
            timeZone,
            false,
            false,
            "completedTime",
            task.id,
          ),
          rawCompletedTime: task.completedTime,
        }),
    ...(task.repeatFlag === undefined ? {} : { repeatRule: task.repeatFlag }),
    ...(task.sortOrder === undefined ? {} : { sortOrder: task.sortOrder }),
    ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
    ...(task.childIds === undefined ? {} : { childIds: task.childIds }),
    ...(task.columnId === undefined ? {} : { columnId: task.columnId }),
  }
}

export function mapV1Project(project: V1Project, options: MapperOptions = {}): DomainProject {
  return {
    id: project.id,
    name: project.name,
    closed: project.closed === true,
    kind: projectKind(project.kind),
    source: "v1",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: project,
    ...(project.color === undefined ? {} : { color: project.color }),
    ...(project.groupId === undefined ? {} : { groupId: project.groupId }),
    ...(project.viewMode === undefined ? {} : { viewMode: projectViewMode(project.viewMode) }),
    ...(project.permission === undefined
      ? {}
      : { permission: projectPermission(project.permission) }),
    ...(project.sortOrder === undefined ? {} : { sortOrder: project.sortOrder }),
    ...(project.id === "inbox" ? { isInbox: true } : {}),
  }
}

export function mapV1Column(column: V1Column, options: MapperOptions = {}): DomainColumn {
  return {
    id: column.id,
    projectId: column.projectId,
    name: column.name,
    source: "v1",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: column,
    ...(column.sortOrder === undefined ? {} : { sortOrder: column.sortOrder }),
  }
}

export function mapV1ProjectData(
  data: V1ProjectData,
  options: MapperOptions = {},
): DomainProjectData {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const shared = { ...options, fetchedAt }
  return {
    project: mapV1Project(data.project, shared),
    tasks: data.tasks.map((task) => mapV1Task(task, shared)),
    columns: data.columns.map((column) => mapV1Column(column, shared)),
  }
}

export function mapV1Group(group: V1Group, options: MapperOptions = {}): DomainGroup {
  return {
    id: group.id,
    name: group.name,
    source: "v1",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: group,
    ...(group.sortOrder === undefined ? {} : { sortOrder: group.sortOrder }),
  }
}

export function mapV1Tag(tag: V1Tag, options: MapperOptions = {}): DomainTag {
  return {
    name: tag.name,
    source: "v1",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: tag,
    ...(tag.label === undefined ? {} : { label: tag.label }),
    ...(tag.color === undefined ? {} : { color: tag.color }),
    ...(tag.sortOrder === undefined ? {} : { sortOrder: tag.sortOrder }),
  }
}

export function mapV1Habit(habit: V1Habit, options: MapperOptions = {}): DomainHabit {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const timeZone = options.defaultTimeZone ?? "UTC"
  return {
    id: habit.id,
    name: habit.name,
    status: habit.archivedTime ? "archived" : habit.status === 0 ? "active" : "unknown",
    reminders: habit.reminders ?? [],
    excludedDates: habit.exDates ?? [],
    source: "v1",
    fetchedAt,
    raw: habit,
    ...(habit.etag === undefined ? {} : { etag: habit.etag }),
    ...(habit.iconRes === undefined ? {} : { icon: habit.iconRes }),
    ...(habit.color === undefined ? {} : { color: habit.color }),
    ...(habit.encouragement === undefined ? {} : { encouragement: habit.encouragement }),
    ...(habit.type === undefined ? {} : { type: habit.type }),
    ...(habit.goal === undefined ? {} : { goal: habit.goal }),
    ...(habit.step === undefined ? {} : { step: habit.step }),
    ...(habit.unit === undefined ? {} : { unit: habit.unit }),
    ...(habit.repeatRule === undefined ? {} : { repeatRule: habit.repeatRule }),
    ...(habit.sortOrder === undefined ? {} : { sortOrder: habit.sortOrder }),
    ...(habit.sectionId === undefined ? {} : { sectionId: habit.sectionId }),
    ...(habit.targetDays === undefined ? {} : { targetDays: habit.targetDays }),
    ...(habit.targetStartDate === undefined
      ? {}
      : { targetStartDate: stampToDate(habit.targetStartDate) }),
    ...(habit.totalCheckIns === undefined ? {} : { totalCheckIns: habit.totalCheckIns }),
    ...(habit.completedCycles === undefined ? {} : { completedCycles: habit.completedCycles }),
    ...(habit.currentStreak === undefined ? {} : { currentStreak: habit.currentStreak }),
    ...(habit.recordEnable === undefined ? {} : { recordEnabled: habit.recordEnable }),
    ...(normalizedOptional(habit.createdTime, timeZone, false, false, "createdTime", habit.id) ===
    undefined
      ? {}
      : {
          createdTime: normalizedOptional(
            habit.createdTime,
            timeZone,
            false,
            false,
            "createdTime",
            habit.id,
          ),
        }),
    ...(normalizedOptional(habit.modifiedTime, timeZone, false, false, "modifiedTime", habit.id) ===
    undefined
      ? {}
      : {
          modifiedTime: normalizedOptional(
            habit.modifiedTime,
            timeZone,
            false,
            false,
            "modifiedTime",
            habit.id,
          ),
        }),
    ...(normalizedOptional(habit.archivedTime, timeZone, false, false, "archivedTime", habit.id) ===
    undefined
      ? {}
      : {
          archivedTime: normalizedOptional(
            habit.archivedTime,
            timeZone,
            false,
            false,
            "archivedTime",
            habit.id,
          ),
        }),
  }
}

export function mapV1HabitCheckins(
  aggregate: V1HabitCheckinAggregate,
  options: MapperOptions = {},
): readonly DomainCheckin[] {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const timeZone = options.defaultTimeZone ?? "UTC"
  return aggregate.checkins.map((checkin) => ({
    id: checkin.id ?? `${aggregate.id ?? aggregate.habitId}:${checkin.stamp}`,
    habitId: aggregate.habitId,
    date: stampToDate(checkin.stamp),
    status: checkin.status === 2 ? "completed" : checkin.status === 0 ? "in_progress" : "unknown",
    value: checkin.value ?? 1,
    source: "v1",
    fetchedAt,
    raw: checkin,
    ...(aggregate.etag === undefined ? {} : { etag: aggregate.etag }),
    ...(checkin.goal === undefined ? {} : { goal: checkin.goal }),
    ...(normalizedOptional(checkin.time, timeZone, false, false, "time", aggregate.habitId) ===
    undefined
      ? {}
      : {
          checkinTime: normalizedOptional(
            checkin.time,
            timeZone,
            false,
            false,
            "time",
            aggregate.habitId,
          ),
        }),
    ...(normalizedOptional(checkin.opTime, timeZone, false, false, "opTime", aggregate.habitId) ===
    undefined
      ? {}
      : {
          operationTime: normalizedOptional(
            checkin.opTime,
            timeZone,
            false,
            false,
            "opTime",
            aggregate.habitId,
          ),
        }),
  }))
}

export function mapV1Focus(focus: V1Focus, options: MapperOptions = {}): DomainFocus {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const timeZone = options.defaultTimeZone ?? "UTC"
  if (focus.startTime === undefined || focus.duration === undefined) {
    throw new ProtocolError("Focus response is missing startTime or duration", {
      entityId: focus.id,
    })
  }
  return {
    id: focus.id,
    type: focusType(focus.type),
    startTime: requiredNormalized(focus.startTime, timeZone, "startTime", focus.id),
    durationSeconds: focus.duration,
    relatedTasks: (focus.tasks ?? []).map((task) => ({
      ...(task.taskId === undefined ? {} : { taskId: task.taskId }),
      ...(task.habitId === undefined ? {} : { habitId: task.habitId }),
      ...(task.title === undefined ? {} : { title: task.title }),
      ...(task.timerId === undefined ? {} : { timerId: task.timerId }),
      ...(task.timerName === undefined ? {} : { timerName: task.timerName }),
      ...(task.startTime === undefined
        ? {}
        : { startTime: requiredNormalized(task.startTime, timeZone, "tasks.startTime", focus.id) }),
      ...(task.endTime === undefined
        ? {}
        : { endTime: requiredNormalized(task.endTime, timeZone, "tasks.endTime", focus.id) }),
    })),
    source: "v1",
    fetchedAt,
    raw: focus,
    ...(focus.etag === undefined ? {} : { etag: focus.etag }),
    ...(focus.taskId === undefined ? {} : { taskId: focus.taskId }),
    ...(focus.note === undefined ? {} : { note: focus.note }),
    ...(focus.status === undefined ? {} : { status: focus.status }),
    ...(focus.endTime === undefined
      ? {}
      : { endTime: requiredNormalized(focus.endTime, timeZone, "endTime", focus.id) }),
    ...(focus.pauseDuration === undefined ? {} : { pauseDurationSeconds: focus.pauseDuration }),
    ...(focus.adjustTime === undefined ? {} : { adjustedSeconds: focus.adjustTime }),
    ...(focus.added === undefined ? {} : { added: focus.added }),
    ...(focus.createdTime === undefined
      ? {}
      : { createdTime: requiredNormalized(focus.createdTime, timeZone, "createdTime", focus.id) }),
    ...(focus.modifiedTime === undefined
      ? {}
      : {
          modifiedTime: requiredNormalized(focus.modifiedTime, timeZone, "modifiedTime", focus.id),
        }),
  }
}

export function toV1TaskCreate(input: TaskCreateInput): V1TaskCreatePayload {
  assertV1TaskFields(input)
  return compact({
    title: input.title,
    projectId: input.projectId,
    parentId: input.parentId,
    content: input.content,
    desc: input.description,
    isAllDay: input.isAllDay,
    startDate: toV1WireDate(input.startDate),
    dueDate: toV1WireDate(input.dueDate),
    timeZone: input.timeZone,
    reminders: input.reminders,
    tags: input.tags,
    repeatFlag: input.repeatRule,
    priority: input.priority,
    sortOrder: input.sortOrder,
    items: input.checklist?.map(toV1ChecklistInput),
  }) as V1TaskCreatePayload
}

export function toV1TaskPatch(
  taskId: string,
  projectId: string,
  patch: TaskPatchInput,
): V1TaskPatchPayload {
  assertV1TaskFields(patch)
  return compact({
    id: taskId,
    projectId,
    title: patch.title,
    parentId: patch.parentId,
    content: patch.content,
    desc: patch.description,
    isAllDay: patch.isAllDay,
    startDate: toV1WireDate(patch.startDate),
    dueDate: toV1WireDate(patch.dueDate),
    timeZone: patch.timeZone,
    reminders: patch.reminders,
    tags: patch.tags,
    repeatFlag: patch.repeatRule,
    priority: patch.priority,
    sortOrder: patch.sortOrder,
    items: patch.checklist?.map(toV1ChecklistInput),
  }) as V1TaskPatchPayload
}

export function toV1ProjectInput(input: Partial<ProjectInput>): Partial<V1ProjectPayload> {
  return compact({
    ...input,
    kind: input.kind === undefined ? undefined : input.kind.toUpperCase(),
  }) as Partial<V1ProjectPayload>
}

export function toV1HabitInput(input: Partial<HabitInput>): Partial<V1HabitPayload> {
  return compact({
    name: input.name,
    iconRes: input.icon,
    color: input.color,
    encouragement: input.encouragement,
    type: input.type,
    goal: input.goal,
    step: input.step,
    unit: input.unit,
    repeatRule: input.repeatRule,
    reminders: input.reminders,
    exDates: input.excludedDates,
    sortOrder: input.sortOrder,
    sectionId: input.sectionId,
    targetDays: input.targetDays,
    targetStartDate:
      input.targetStartDate === undefined ? undefined : dateToStamp(input.targetStartDate),
    recordEnable: input.recordEnabled,
  }) as Partial<V1HabitPayload>
}

export function toV1FocusInput(input: FocusInput): V1FocusPayload {
  return compact({
    type: input.type === "pomodoro" ? 0 : 1,
    taskId: input.taskId,
    note: input.note,
    startTime: input.startTime,
    endTime: input.endTime,
    duration: input.durationSeconds,
  }) as V1FocusPayload
}

function mapChecklistItem(
  item: V1ChecklistItem,
  taskId: string,
  index: number,
  defaultTimeZone: string,
  _fetchedAt: string,
): DomainChecklistItem {
  if (!item.id) {
    throw new ProtocolError("Checklist item is missing its id", { taskId, index })
  }
  const timeZone = item.timeZone ?? defaultTimeZone
  const isAllDay = item.isAllDay ?? false
  return {
    id: item.id,
    title: item.title,
    status: item.status === 1 ? "completed" : "open",
    ...(item.sortOrder === undefined ? {} : { sortOrder: item.sortOrder }),
    ...(item.startDate === undefined
      ? {}
      : {
          startDate: requiredNormalized(item.startDate, timeZone, "items.startDate", taskId),
          rawStartDate: item.startDate,
        }),
    ...(item.completedTime === undefined
      ? {}
      : {
          completedTime: requiredNormalized(
            item.completedTime,
            timeZone,
            "items.completedTime",
            taskId,
          ),
        }),
    ...(item.isAllDay === undefined ? {} : { isAllDay }),
    ...(item.timeZone === undefined ? {} : { timeZone: item.timeZone }),
  }
}

function toV1ChecklistInput(item: ChecklistItemInput): V1ChecklistItemPayload {
  return compact({
    id: item.id,
    title: item.title,
    status: item.completed === undefined ? undefined : item.completed ? 1 : 0,
    sortOrder: item.sortOrder,
    startDate: item.startDate,
    isAllDay: item.isAllDay,
    timeZone: item.timeZone,
  }) as V1ChecklistItemPayload
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** The v1 write endpoints require a full instant; bare calendar dates are silently dropped. */
function toV1WireDate(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) return value
  return dateOnlyToWireInstant(value)
}

function assertV1TaskFields(input: TaskCreateInput | TaskPatchInput): void {
  if (input.columnId !== undefined) {
    throw new CapabilityError(
      "capability_missing",
      "Column assignment is not verified for the v1 task write endpoint",
      { field: "columnId" },
    )
  }
  if (input.isFloating !== undefined) {
    throw new CapabilityError(
      "capability_missing",
      "Floating task writes require a verified v2 capability",
      { field: "isFloating" },
    )
  }
}

function normalizedOptional(
  value: string | undefined,
  timeZone: string,
  isAllDay: boolean,
  isFloating: boolean,
  field: string,
  entityId: string,
): string | undefined {
  if (value === undefined) return undefined
  return requiredNormalized(value, timeZone, field, entityId, isAllDay, isFloating)
}

function requiredNormalized(
  value: string,
  timeZone: string,
  field: string,
  entityId: string,
  isAllDay = false,
  isFloating = false,
): string {
  try {
    const normalized = normalizeDateTime(value, { timeZone, isAllDay, isFloating })
    return normalized.instant ?? normalized.localDate
  } catch (cause) {
    throw new ProtocolError("The API returned an invalid date", { entityId, field }, cause)
  }
}

function taskStatus(value: number | undefined): TaskStatus {
  if (value === 2) return "completed"
  if (value === -1) return "wont_do"
  return "open"
}

function taskPriority(value: number | undefined): TaskPriority {
  return value === 1 || value === 3 || value === 5 ? value : 0
}

function taskKind(
  value: string | undefined,
  items: readonly V1ChecklistItem[] | undefined,
): TaskKind {
  const normalized = value?.toUpperCase()
  if (normalized === "NOTE") return "note"
  if (normalized === "CHECKLIST" || (items?.length ?? 0) > 0) return "checklist"
  return "text"
}

function projectKind(value: string | undefined): ProjectKind {
  return value?.toUpperCase() === "NOTE" ? "note" : "task"
}

function projectViewMode(value: string): ProjectViewMode {
  return value === "kanban" || value === "timeline" ? value : "list"
}

function projectPermission(value: string): ProjectPermission {
  return value === "read" || value === "comment" ? value : "write"
}

function focusType(value: number): FocusType {
  if (value === 0) return "pomodoro"
  if (value === 1) return "timing"
  throw new ProtocolError("Focus response has an unknown type", { type: value })
}

function stampToDate(stamp: number): string {
  const value = String(stamp)
  if (!/^\d{8}$/.test(value)) throw new ProtocolError("Invalid YYYYMMDD date stamp", { stamp })
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function dateToStamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ProtocolError("Expected a YYYY-MM-DD date", { value })
  }
  return Number(value.replaceAll("-", ""))
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>
}
