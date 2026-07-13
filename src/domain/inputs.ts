import type {
  FocusType,
  IsoDateTime,
  ProjectKind,
  ProjectViewMode,
  TaskKind,
  TaskPriority,
} from "./models"

export interface ChecklistItemInput {
  id?: string
  title: string
  completed?: boolean
  sortOrder?: number
  startDate?: IsoDateTime
  isAllDay?: boolean
  timeZone?: string
}

/** API-neutral task creation input. Wire clients serialize this per endpoint. */
export interface TaskCreateInput {
  title: string
  projectId: string
  content?: string
  description?: string
  kind?: TaskKind
  isAllDay?: boolean
  isFloating?: boolean
  startDate?: IsoDateTime
  dueDate?: IsoDateTime
  timeZone?: string
  reminders?: readonly string[]
  tags?: readonly string[]
  repeatRule?: string
  priority?: TaskPriority
  sortOrder?: number
  checklist?: readonly ChecklistItemInput[]
  parentId?: string
  columnId?: string
}

/**
 * `null` explicitly clears a nullable remote field; `undefined` means do not
 * change it. API clients must not turn an omitted property into a wire null.
 */
export interface TaskPatchInput {
  title?: string
  projectId?: string
  content?: string | null
  description?: string | null
  kind?: TaskKind
  isAllDay?: boolean
  isFloating?: boolean
  startDate?: IsoDateTime | null
  dueDate?: IsoDateTime | null
  timeZone?: string | null
  reminders?: readonly string[]
  tags?: readonly string[]
  repeatRule?: string | null
  priority?: TaskPriority
  sortOrder?: number
  checklist?: readonly ChecklistItemInput[]
  parentId?: string | null
  columnId?: string | null
}

export interface ProjectInput {
  name: string
  color?: string
  groupId?: string | null
  viewMode?: ProjectViewMode
  kind?: ProjectKind
  sortOrder?: number
}

export interface HabitInput {
  name: string
  icon?: string
  color?: string
  encouragement?: string
  type?: string
  goal?: number
  step?: number
  unit?: string
  repeatRule?: string
  reminders?: readonly string[]
  excludedDates?: readonly string[]
  sortOrder?: number
  sectionId?: string
  targetDays?: number
  targetStartDate?: string
  recordEnabled?: boolean
}

export interface FocusInput {
  type: FocusType
  startTime: IsoDateTime
  durationSeconds: number
  taskId?: string
  note?: string
  endTime?: IsoDateTime
}

/** Reject accidental no-op patches before selecting or calling an API. */
export function hasPatchValues(patch: TaskPatchInput): boolean {
  return Object.values(patch).some((value) => value !== undefined)
}
