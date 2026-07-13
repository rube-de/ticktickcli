/** The API which supplied an entity. Cache is a delivery source, not an entity source. */
export type ApiSource = "v1" | "v2"

export type IsoDate = string
export type IsoDateTime = string

/**
 * Metadata retained on normalized entities so a store can reconcile and, where
 * required, safely round-trip a freshly fetched wire object.
 */
export interface DomainEntityMetadata {
  source: ApiSource
  fetchedAt: IsoDateTime
  etag?: string
  raw?: Readonly<Record<string, unknown>>
}

export type TaskPriority = 0 | 1 | 3 | 5
export type TaskStatus = "open" | "completed" | "wont_do"
export type TaskKind = "text" | "note" | "checklist"

export interface DomainChecklistItem {
  id: string
  title: string
  status: "open" | "completed"
  sortOrder?: number
  startDate?: IsoDateTime
  completedTime?: IsoDateTime
  isAllDay?: boolean
  timeZone?: string
  rawStartDate?: string
}

export interface DomainTask extends DomainEntityMetadata {
  id: string
  projectId: string
  title: string
  content?: string
  description?: string
  kind: TaskKind
  status: TaskStatus
  priority: TaskPriority
  tags: readonly string[]
  reminders: readonly string[]
  checklist: readonly DomainChecklistItem[]
  isAllDay: boolean
  isFloating?: boolean
  timeZone?: string
  startDate?: IsoDateTime
  dueDate?: IsoDateTime
  completedTime?: IsoDateTime
  /** Original API strings are retained because each endpoint has its own format. */
  rawStartDate?: string
  rawDueDate?: string
  rawCompletedTime?: string
  repeatRule?: string
  sortOrder?: number
  parentId?: string
  childIds?: readonly string[]
  columnId?: string
  pinnedTime?: IsoDateTime
  deleted?: boolean
}

export type ProjectViewMode = "list" | "kanban" | "timeline"
export type ProjectPermission = "read" | "write" | "comment"
export type ProjectKind = "task" | "note"

export interface DomainProject extends DomainEntityMetadata {
  id: string
  name: string
  color?: string
  closed: boolean
  groupId?: string
  viewMode?: ProjectViewMode
  permission?: ProjectPermission
  kind: ProjectKind
  sortOrder?: number
  isInbox?: boolean
}

export interface DomainGroup extends DomainEntityMetadata {
  id: string
  name: string
  sortOrder?: number
}

export interface DomainColumn extends DomainEntityMetadata {
  id: string
  projectId: string
  name: string
  sortOrder?: number
}

export interface DomainTag extends DomainEntityMetadata {
  /** v1 tags are name-addressed and may not expose an id. */
  id?: string
  name: string
  label?: string
  color?: string
  sortOrder?: number
}

export interface DomainFilter extends DomainEntityMetadata {
  id: string
  name: string
  /** The normalized parser owns interpretation; unsupported remote clauses stay raw. */
  rule: unknown
  sortOrder?: number
}

export type HabitStatus = "active" | "archived" | "unknown"

export interface DomainHabit extends DomainEntityMetadata {
  id: string
  name: string
  status: HabitStatus
  icon?: string
  color?: string
  encouragement?: string
  type?: string
  goal?: number
  step?: number
  unit?: string
  repeatRule?: string
  reminders: readonly string[]
  excludedDates: readonly string[]
  sortOrder?: number
  sectionId?: string
  targetDays?: number
  targetStartDate?: string
  totalCheckIns?: number
  completedCycles?: number
  currentStreak?: number
  recordEnabled?: boolean
  createdTime?: IsoDateTime
  modifiedTime?: IsoDateTime
  archivedTime?: IsoDateTime
}

export type CheckinStatus = "in_progress" | "completed" | "unknown"

export interface DomainCheckin extends DomainEntityMetadata {
  id: string
  habitId: string
  /** Calendar date in YYYY-MM-DD form in the habit/profile timezone. */
  date: IsoDate
  status: CheckinStatus
  value: number
  goal?: number
  checkinTime?: IsoDateTime
  operationTime?: IsoDateTime
  createdTime?: IsoDateTime
  modifiedTime?: IsoDateTime
}

export type FocusType = "pomodoro" | "timing"

export interface DomainFocusTaskBrief {
  taskId?: string
  habitId?: string
  title?: string
  timerId?: string
  timerName?: string
  startTime?: IsoDateTime
  endTime?: IsoDateTime
}

export interface DomainFocus extends DomainEntityMetadata {
  id: string
  type: FocusType
  taskId?: string
  note?: string
  status?: number
  startTime: IsoDateTime
  endTime?: IsoDateTime
  durationSeconds: number
  pauseDurationSeconds?: number
  adjustedSeconds?: number
  added?: boolean
  createdTime?: IsoDateTime
  modifiedTime?: IsoDateTime
  relatedTasks: readonly DomainFocusTaskBrief[]
}

export interface DomainEvent extends DomainEntityMetadata {
  id: string
  accountId?: string
  calendarId?: string
  title: string
  description?: string
  location?: string
  startDate: IsoDateTime
  endDate?: IsoDateTime
  rawStartDate?: string
  rawEndDate?: string
  timeZone?: string
  isAllDay: boolean
  isFloating?: boolean
  recurrenceRule?: string
  status?: string
  url?: string
}

export type DomainEntity =
  | DomainTask
  | DomainProject
  | DomainGroup
  | DomainColumn
  | DomainTag
  | DomainFilter
  | DomainHabit
  | DomainCheckin
  | DomainFocus
  | DomainEvent
