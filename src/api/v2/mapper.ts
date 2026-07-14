import { normalizeDateTime } from "../../core/dates"
import type { ChecklistItemInput, TaskCreateInput, TaskPatchInput } from "../../domain/inputs"
import type {
  DomainCheckin,
  DomainChecklistItem,
  DomainColumn,
  DomainEvent,
  DomainFilter,
  DomainGroup,
  DomainHabit,
  DomainProject,
  DomainTag,
  DomainTask,
  ProjectKind,
  ProjectPermission,
  ProjectViewMode,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from "../../domain/models"
import { ProtocolError } from "../errors"
import type {
  V2CalendarEvent,
  V2CalendarEventBundle,
  V2Checkin,
  V2ChecklistItem,
  V2Column,
  V2Filter,
  V2Group,
  V2Habit,
  V2Project,
  V2Tag,
  V2Task,
} from "./schemas"

export interface V2MapperOptions {
  fetchedAt?: string
  defaultTimeZone?: string
}

export interface V2TaskCreatePlan {
  task: Readonly<Record<string, unknown>> & { id: string; projectId: string; title: string }
  parentId?: string
}

export function mapV2Task(task: V2Task, options: V2MapperOptions = {}): DomainTask {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const timeZone = task.timeZone ?? options.defaultTimeZone ?? "UTC"
  const isAllDay = task.isAllDay ?? false
  const isFloating = task.isFloating ?? false
  const startDate = normalizeOptional(
    task.startDate,
    timeZone,
    isAllDay,
    isFloating,
    task.id,
    "startDate",
  )
  const dueDate = normalizeOptional(
    task.dueDate,
    timeZone,
    isAllDay,
    isFloating,
    task.id,
    "dueDate",
  )
  const completedTime = normalizeOptional(
    task.completedTime,
    timeZone,
    false,
    false,
    task.id,
    "completedTime",
  )
  const pinnedTime =
    task.pinnedTime && task.pinnedTime !== "-1"
      ? normalizeRequired(task.pinnedTime, timeZone, false, false, task.id, "pinnedTime")
      : undefined

  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    kind: taskKind(task.kind, task.items),
    status: taskStatus(task.status),
    priority: taskPriority(task.priority),
    tags: task.tags ?? [],
    reminders: (task.reminders ?? []).map(reminderToString),
    checklist: (task.items ?? []).map((item, index) =>
      mapV2ChecklistItem(item, task.id, index, timeZone),
    ),
    isAllDay,
    isFloating,
    source: "v2",
    fetchedAt,
    raw: task,
    ...(task.etag === undefined ? {} : { etag: task.etag }),
    ...(task.content === undefined ? {} : { content: task.content }),
    ...(task.desc === undefined ? {} : { description: task.desc }),
    ...(task.timeZone === undefined ? {} : { timeZone: task.timeZone }),
    ...(startDate === undefined ? {} : { startDate, rawStartDate: task.startDate ?? undefined }),
    ...(dueDate === undefined ? {} : { dueDate, rawDueDate: task.dueDate ?? undefined }),
    ...(completedTime === undefined
      ? {}
      : { completedTime, rawCompletedTime: task.completedTime ?? undefined }),
    ...(task.repeatFlag === undefined ? {} : { repeatRule: task.repeatFlag }),
    ...(task.sortOrder === undefined ? {} : { sortOrder: task.sortOrder }),
    ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
    ...(task.childIds === undefined ? {} : { childIds: task.childIds }),
    ...(task.columnId === undefined ? {} : { columnId: task.columnId }),
    ...(pinnedTime === undefined ? {} : { pinnedTime }),
    ...(task.deleted === undefined ? {} : { deleted: task.deleted === 1 }),
  }
}

export function mapV2Project(project: V2Project, options: V2MapperOptions = {}): DomainProject {
  // The wire sends `null` for absent color/viewMode/permission; treat it as absent.
  const color = project.color ?? undefined
  const viewMode = project.viewMode ?? undefined
  const permission = project.permission ?? undefined
  return {
    id: project.id,
    name: project.name,
    closed: project.closed === true,
    kind: projectKind(project.kind),
    source: "v2",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: project,
    ...(project.etag === undefined ? {} : { etag: project.etag }),
    ...(color === undefined ? {} : { color }),
    ...(project.groupId === undefined ? {} : { groupId: project.groupId }),
    ...(viewMode === undefined ? {} : { viewMode: projectViewMode(viewMode) }),
    ...(permission === undefined ? {} : { permission: projectPermission(permission) }),
    ...(project.sortOrder === undefined ? {} : { sortOrder: project.sortOrder }),
  }
}

export function mapV2Group(group: V2Group, options: V2MapperOptions = {}): DomainGroup {
  return {
    id: group.id,
    name: group.name,
    source: "v2",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: group,
    ...(group.etag === undefined ? {} : { etag: group.etag }),
    ...(group.sortOrder === undefined ? {} : { sortOrder: group.sortOrder }),
  }
}

export function mapV2Column(column: V2Column, options: V2MapperOptions = {}): DomainColumn {
  return {
    id: column.id,
    projectId: column.projectId,
    name: column.name,
    source: "v2",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: column,
    ...(column.etag === undefined ? {} : { etag: column.etag }),
    ...(column.sortOrder === undefined ? {} : { sortOrder: column.sortOrder }),
  }
}

export function mapV2Tag(tag: V2Tag, options: V2MapperOptions = {}): DomainTag {
  return {
    name: tag.name,
    source: "v2",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: tag,
    ...(tag.id === undefined ? {} : { id: tag.id }),
    ...(tag.etag === undefined ? {} : { etag: tag.etag }),
    ...(tag.label === undefined ? {} : { label: tag.label }),
    ...(tag.color === undefined ? {} : { color: tag.color }),
    ...(tag.sortOrder === undefined ? {} : { sortOrder: tag.sortOrder }),
  }
}

export function mapV2Filter(filter: V2Filter, options: V2MapperOptions = {}): DomainFilter {
  return {
    id: filter.id,
    name: filter.name,
    rule: parseFilterRule(filter.rule),
    source: "v2",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: filter,
    ...(filter.etag === undefined ? {} : { etag: filter.etag }),
    ...(filter.sortOrder === undefined ? {} : { sortOrder: filter.sortOrder }),
  }
}

export function mapV2Habit(habit: V2Habit, options: V2MapperOptions = {}): DomainHabit {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const timeZone = options.defaultTimeZone ?? "UTC"
  return {
    id: habit.id,
    name: habit.name,
    status: habit.archivedTime ? "archived" : habit.status === 0 ? "active" : "unknown",
    reminders: habit.reminders ?? [],
    excludedDates: habit.exDates ?? [],
    source: "v2",
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
    ...(habit.createdTime === undefined
      ? {}
      : {
          createdTime: normalizeRequired(
            habit.createdTime,
            timeZone,
            false,
            false,
            habit.id,
            "createdTime",
          ),
        }),
    ...(habit.modifiedTime === undefined
      ? {}
      : {
          modifiedTime: normalizeRequired(
            habit.modifiedTime,
            timeZone,
            false,
            false,
            habit.id,
            "modifiedTime",
          ),
        }),
    ...(habit.archivedTime === undefined
      ? {}
      : {
          archivedTime: normalizeRequired(
            habit.archivedTime,
            timeZone,
            false,
            false,
            habit.id,
            "archivedTime",
          ),
        }),
  }
}

export function mapV2Checkin(checkin: V2Checkin, options: V2MapperOptions = {}): DomainCheckin {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString()
  const timeZone = options.defaultTimeZone ?? "UTC"
  return {
    id: checkin.id ?? `${checkin.habitId}:${checkin.checkinStamp}`,
    habitId: checkin.habitId,
    date: stampToDate(checkin.checkinStamp),
    status: checkin.status === 2 ? "completed" : checkin.status === 0 ? "in_progress" : "unknown",
    value: checkin.value ?? 1,
    source: "v2",
    fetchedAt,
    raw: checkin,
    ...(checkin.etag === undefined ? {} : { etag: checkin.etag }),
    ...(checkin.goal === undefined ? {} : { goal: checkin.goal }),
    ...(checkin.checkinTime === undefined
      ? {}
      : {
          checkinTime: normalizeRequired(
            checkin.checkinTime,
            timeZone,
            false,
            false,
            checkin.habitId,
            "checkinTime",
          ),
        }),
    ...(checkin.opTime === undefined
      ? {}
      : {
          operationTime: normalizeRequired(
            checkin.opTime,
            timeZone,
            false,
            false,
            checkin.habitId,
            "opTime",
          ),
        }),
    ...(checkin.createdTime === undefined
      ? {}
      : {
          createdTime: normalizeRequired(
            checkin.createdTime,
            timeZone,
            false,
            false,
            checkin.habitId,
            "createdTime",
          ),
        }),
    ...(checkin.modifiedTime === undefined
      ? {}
      : {
          modifiedTime: normalizeRequired(
            checkin.modifiedTime,
            timeZone,
            false,
            false,
            checkin.habitId,
            "modifiedTime",
          ),
        }),
  }
}

export function mapV2CalendarEvent(
  event: V2CalendarEvent,
  options: V2MapperOptions & { accountId?: string } = {},
): DomainEvent {
  const id = event.id ?? event.eventId
  const title = event.title ?? event.summary
  const startWire = event.startDate ?? event.startTime
  if (!id || title === undefined || !startWire) {
    throw new ProtocolError("Calendar event is missing id, title, or start date", {
      accountId: options.accountId,
    })
  }
  const timeZone = event.timeZone ?? options.defaultTimeZone ?? "UTC"
  const isAllDay = event.isAllDay ?? false
  const isFloating = event.isFloating ?? false
  const endWire = event.endDate ?? event.endTime
  return {
    id,
    title,
    startDate: normalizeRequired(startWire, timeZone, isAllDay, isFloating, id, "startDate"),
    isAllDay,
    isFloating,
    source: "v2",
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    raw: event,
    ...(event.etag === undefined ? {} : { etag: event.etag }),
    ...((event.accountId ?? options.accountId)
      ? { accountId: event.accountId ?? options.accountId }
      : {}),
    ...(event.calendarId === undefined ? {} : { calendarId: event.calendarId }),
    ...(event.description === undefined ? {} : { description: event.description }),
    ...(event.location === undefined ? {} : { location: event.location }),
    ...(endWire === undefined
      ? {}
      : {
          endDate: normalizeRequired(endWire, timeZone, isAllDay, isFloating, id, "endDate"),
          rawEndDate: endWire,
        }),
    rawStartDate: startWire,
    ...(event.timeZone === undefined ? {} : { timeZone: event.timeZone }),
    ...(event.repeatFlag === undefined ? {} : { recurrenceRule: event.repeatFlag }),
    ...(event.status === undefined ? {} : { status: event.status }),
    ...(event.url === undefined ? {} : { url: event.url }),
  }
}

export function flattenV2CalendarEvents(
  bundles: readonly V2CalendarEventBundle[],
  options: V2MapperOptions = {},
): readonly DomainEvent[] {
  return bundles.flatMap((bundle) =>
    bundle.events.map((event) =>
      mapV2CalendarEvent(event, { ...options, accountId: bundle.accountId }),
    ),
  )
}

export function toV2TaskCreate(input: TaskCreateInput, id: string): V2TaskCreatePlan {
  const task = compact({
    id,
    projectId: input.projectId,
    title: input.title,
    content: input.content,
    desc: input.description,
    kind: input.kind?.toUpperCase(),
    isAllDay: input.isAllDay,
    isFloating: input.isFloating,
    startDate: input.startDate,
    dueDate: input.dueDate,
    timeZone: input.timeZone,
    reminders: input.reminders,
    tags: input.tags,
    repeatFlag: input.repeatRule,
    priority: input.priority,
    sortOrder: input.sortOrder,
    items: input.checklist?.map(toV2ChecklistInput),
    columnId: input.columnId,
  }) as V2TaskCreatePlan["task"]
  return {
    task,
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
  }
}

/** Merge a patch into a freshly fetched raw task so unknown fields and etag survive. */
export function mergeV2TaskPatch(
  current: V2Task,
  patch: TaskPatchInput,
): Record<string, unknown> & { id: string; projectId: string } {
  const mapped = compact({
    title: patch.title,
    projectId: patch.projectId,
    content: patch.content,
    desc: patch.description,
    kind: patch.kind?.toUpperCase(),
    isAllDay: patch.isAllDay,
    isFloating: patch.isFloating,
    startDate: patch.startDate,
    dueDate: patch.dueDate,
    timeZone: patch.timeZone,
    reminders: patch.reminders,
    tags: patch.tags,
    repeatFlag: patch.repeatRule,
    priority: patch.priority,
    sortOrder: patch.sortOrder,
    items: patch.checklist?.map(toV2ChecklistInput),
    columnId: patch.columnId === null ? "" : patch.columnId,
  })
  // parentId is intentionally excluded: v2 requires /batch/taskParent.
  return { ...current, ...mapped, id: current.id, projectId: patch.projectId ?? current.projectId }
}

function mapV2ChecklistItem(
  item: V2ChecklistItem,
  taskId: string,
  index: number,
  defaultTimeZone: string,
): DomainChecklistItem {
  if (!item.id) throw new ProtocolError("Checklist item is missing its id", { taskId, index })
  const timeZone = item.timeZone ?? defaultTimeZone
  const isAllDay = item.isAllDay ?? false
  // The wire sends `null` for an absent startDate/completedTime; treat it as absent.
  const startDate = item.startDate ?? undefined
  const completedTime = item.completedTime ?? undefined
  return {
    id: item.id,
    title: item.title,
    status: item.status === 1 ? "completed" : "open",
    ...(item.sortOrder === undefined ? {} : { sortOrder: item.sortOrder }),
    ...(startDate === undefined
      ? {}
      : {
          startDate: normalizeRequired(
            startDate,
            timeZone,
            isAllDay,
            false,
            taskId,
            "items.startDate",
          ),
          rawStartDate: startDate,
        }),
    ...(completedTime === undefined
      ? {}
      : {
          completedTime: normalizeRequired(
            completedTime,
            timeZone,
            false,
            false,
            taskId,
            "items.completedTime",
          ),
        }),
    ...(item.isAllDay === undefined ? {} : { isAllDay }),
    ...(item.timeZone === undefined ? {} : { timeZone: item.timeZone }),
  }
}

function toV2ChecklistInput(item: ChecklistItemInput): Record<string, unknown> {
  return compact({
    id: item.id,
    title: item.title,
    status: item.completed === undefined ? undefined : item.completed ? 1 : 0,
    sortOrder: item.sortOrder,
    startDate: item.startDate,
    isAllDay: item.isAllDay,
    timeZone: item.timeZone,
  })
}

function normalizeOptional(
  value: string | null | undefined,
  timeZone: string,
  isAllDay: boolean,
  isFloating: boolean,
  entityId: string,
  field: string,
): string | undefined {
  // The wire sends `null` for an absent date; treat it as absent.
  return value === undefined || value === null
    ? undefined
    : normalizeRequired(value, timeZone, isAllDay, isFloating, entityId, field)
}

function normalizeRequired(
  value: string,
  timeZone: string,
  isAllDay: boolean,
  isFloating: boolean,
  entityId: string,
  field: string,
): string {
  try {
    const normalized = normalizeDateTime(value, { timeZone, isAllDay, isFloating })
    return normalized.instant ?? normalized.localDate
  } catch (cause) {
    throw new ProtocolError("The API returned an invalid date", { entityId, field }, cause)
  }
}

function reminderToString(value: string | Record<string, unknown>): string {
  if (typeof value === "string") return value
  const trigger = value.trigger
  return typeof trigger === "string" ? trigger : JSON.stringify(value)
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
  items: readonly V2ChecklistItem[] | undefined,
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

function parseFilterRule(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function stampToDate(stamp: number): string {
  const value = String(stamp)
  if (!/^\d{8}$/.test(value)) throw new ProtocolError("Invalid YYYYMMDD date stamp", { stamp })
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>
}
