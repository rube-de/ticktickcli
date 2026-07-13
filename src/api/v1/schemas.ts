import { z } from "zod"

export const V1WireDateSchema = z.string().min(1)
export const V1IdSchema = z.string().min(1)
export const V1PrioritySchema = z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5)])

export const V1ChecklistItemSchema = z
  .object({
    id: V1IdSchema.optional(),
    title: z.string(),
    status: z.number().int().optional(),
    completedTime: V1WireDateSchema.optional(),
    isAllDay: z.boolean().optional(),
    sortOrder: z.number().optional(),
    startDate: V1WireDateSchema.optional(),
    timeZone: z.string().optional(),
  })
  .passthrough()

export const V1FocusSummarySchema = z
  .object({
    pomoCount: z.number().optional(),
    estimatedPomo: z.number().optional(),
    estimatedDuration: z.number().optional(),
    pomoDuration: z.number().optional(),
    stopwatchDuration: z.number().optional(),
  })
  .passthrough()

export const V1TaskSchema = z
  .object({
    id: V1IdSchema,
    projectId: V1IdSchema,
    title: z.string(),
    parentId: V1IdSchema.optional(),
    childIds: z.array(V1IdSchema).optional(),
    focusSummaries: z.array(V1FocusSummarySchema).optional(),
    content: z.string().optional(),
    desc: z.string().optional(),
    isAllDay: z.boolean().optional(),
    startDate: V1WireDateSchema.optional(),
    dueDate: V1WireDateSchema.optional(),
    timeZone: z.string().optional(),
    reminders: z.array(z.string()).optional(),
    repeatFlag: z.string().optional(),
    priority: V1PrioritySchema.optional(),
    status: z.number().int().optional(),
    completedTime: V1WireDateSchema.optional(),
    sortOrder: z.number().optional(),
    items: z.array(V1ChecklistItemSchema).optional(),
    tags: z.array(z.string()).optional(),
    etag: z.string().optional(),
    kind: z.string().optional(),
    columnId: z.string().optional(),
  })
  .passthrough()

export const V1ProjectSchema = z
  .object({
    id: V1IdSchema,
    name: z.string(),
    color: z.string().optional(),
    sortOrder: z.number().optional(),
    closed: z.boolean().nullable().optional(),
    groupId: z.string().optional(),
    viewMode: z.string().optional(),
    permission: z.string().optional(),
    kind: z.string().optional(),
  })
  .passthrough()

export const V1ColumnSchema = z
  .object({
    id: V1IdSchema,
    projectId: V1IdSchema,
    name: z.string(),
    sortOrder: z.number().optional(),
  })
  .passthrough()

export const V1ProjectDataSchema = z
  .object({
    project: V1ProjectSchema,
    tasks: z.array(V1TaskSchema),
    columns: z.array(V1ColumnSchema),
  })
  .passthrough()

export const V1MoveTaskResultSchema = z
  .object({
    id: V1IdSchema,
    etag: z.string(),
  })
  .passthrough()

export const V1CommentSchema = z
  .object({
    id: V1IdSchema,
    title: z.string(),
    userId: z.number().optional(),
    createdTime: V1WireDateSchema.optional(),
    modifiedTime: V1WireDateSchema.optional(),
    replyCommentId: z.string().optional(),
    replyUserId: z.number().optional(),
  })
  .passthrough()

export const V1GroupSchema = z
  .object({
    id: V1IdSchema,
    name: z.string(),
    sortOrder: z.number().optional(),
    showAll: z.boolean().optional(),
    viewMode: z.string().optional(),
  })
  .passthrough()

export const V1TagSchema = z
  .object({
    name: z.string().min(1),
    label: z.string().optional(),
    sortOrder: z.number().optional(),
    color: z.string().optional(),
    parent: z.string().optional(),
    type: z.number().optional(),
  })
  .passthrough()

export const V1FocusTaskBriefSchema = z
  .object({
    taskId: z.string().optional(),
    title: z.string().optional(),
    habitId: z.string().optional(),
    timerId: z.string().optional(),
    timerName: z.string().optional(),
    startTime: V1WireDateSchema.optional(),
    endTime: V1WireDateSchema.optional(),
  })
  .passthrough()

export const V1FocusSchema = z
  .object({
    id: V1IdSchema,
    userId: z.number().optional(),
    type: z.number().int(),
    taskId: z.string().optional(),
    note: z.string().optional(),
    tasks: z.array(V1FocusTaskBriefSchema).optional(),
    status: z.number().int().optional(),
    startTime: V1WireDateSchema.optional(),
    endTime: V1WireDateSchema.optional(),
    pauseDuration: z.number().optional(),
    adjustTime: z.number().optional(),
    added: z.boolean().optional(),
    createdTime: V1WireDateSchema.optional(),
    modifiedTime: V1WireDateSchema.optional(),
    etimestamp: z.number().optional(),
    etag: z.string().optional(),
    duration: z.number().optional(),
    relationType: z.array(z.number()).optional(),
  })
  .passthrough()

export const V1HabitSchema = z
  .object({
    id: V1IdSchema,
    name: z.string(),
    iconRes: z.string().optional(),
    color: z.string().optional(),
    sortOrder: z.number().optional(),
    status: z.number().int().optional(),
    encouragement: z.string().optional(),
    totalCheckIns: z.number().optional(),
    currentStreak: z.number().optional(),
    createdTime: V1WireDateSchema.optional(),
    modifiedTime: V1WireDateSchema.optional(),
    archivedTime: V1WireDateSchema.optional(),
    type: z.string().optional(),
    goal: z.number().optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
    etag: z.string().optional(),
    repeatRule: z.string().optional(),
    reminders: z.array(z.string()).optional(),
    recordEnable: z.boolean().optional(),
    sectionId: z.string().optional(),
    targetDays: z.number().int().optional(),
    targetStartDate: z.number().int().optional(),
    completedCycles: z.number().int().optional(),
    exDates: z.array(z.string()).optional(),
    style: z.number().int().optional(),
  })
  .passthrough()

export const V1HabitCheckinItemSchema = z
  .object({
    id: z.string().optional(),
    stamp: z.number().int(),
    time: V1WireDateSchema.optional(),
    opTime: V1WireDateSchema.optional(),
    value: z.number().optional(),
    goal: z.number().optional(),
    status: z.number().int().optional(),
  })
  .passthrough()

export const V1HabitCheckinAggregateSchema = z
  .object({
    id: z.string().optional(),
    habitId: V1IdSchema,
    createdTime: V1WireDateSchema.optional(),
    modifiedTime: V1WireDateSchema.optional(),
    etag: z.string().optional(),
    year: z.number().int().optional(),
    checkins: z.array(V1HabitCheckinItemSchema),
  })
  .passthrough()

export const V1CountdownSchema = z
  .object({
    id: V1IdSchema,
    type: z.number().optional(),
    iconRes: z.string().optional(),
    color: z.string().optional(),
    name: z.string().optional(),
    date: z.number().optional(),
    ignoreYear: z.boolean().optional(),
    showCalendarType: z.number().optional(),
    reminders: z.array(z.string()).optional(),
    annoyingAlert: z.number().optional(),
    repeatFlag: z.string().optional(),
    remark: z.string().optional(),
    status: z.number().optional(),
    sortOrder: z.number().optional(),
    style: z.string().optional(),
    styleColor: z.array(z.string()).optional(),
    dateDisplayFormat: z.string().optional(),
    timerMode: z.number().optional(),
    showAge: z.boolean().optional(),
    daysOption: z.number().optional(),
    showRemark: z.boolean().optional(),
    createdTime: V1WireDateSchema.optional(),
    modifiedTime: V1WireDateSchema.optional(),
  })
  .passthrough()

export const V1TaskListSchema = z.array(V1TaskSchema)
export const V1ProjectListSchema = z.array(V1ProjectSchema)
export const V1ColumnListSchema = z.array(V1ColumnSchema)
export const V1CommentListSchema = z.array(V1CommentSchema)
export const V1GroupListSchema = z.array(V1GroupSchema)
export const V1TagListSchema = z.array(V1TagSchema)
export const V1FocusListSchema = z.array(V1FocusSchema)
export const V1HabitListSchema = z.array(V1HabitSchema)
export const V1HabitCheckinAggregateListSchema = z.array(V1HabitCheckinAggregateSchema)
export const V1CountdownListSchema = z.array(V1CountdownSchema)
export const V1MoveTaskResultListSchema = z.array(V1MoveTaskResultSchema)

export const V1CompletedTaskFilterSchema = z.object({
  projectIds: z.array(V1IdSchema).optional(),
  startDate: V1WireDateSchema.optional(),
  endDate: V1WireDateSchema.optional(),
})

export const V1TaskFilterSchema = z.object({
  projectIds: z.array(V1IdSchema).optional(),
  startDate: V1WireDateSchema.optional(),
  endDate: V1WireDateSchema.optional(),
  priority: z.array(V1PrioritySchema).optional(),
  tag: z.array(z.string()).optional(),
  status: z.array(z.number().int()).optional(),
})

export const V1HabitCheckinInputSchema = z.object({
  stamp: z.number().int(),
  time: V1WireDateSchema.optional(),
  opTime: V1WireDateSchema.optional(),
  value: z.number().optional(),
  goal: z.number().optional(),
  status: z.number().int().optional(),
})

export const V1FocusCreateSchema = z.object({
  type: z.union([z.literal(0), z.literal(1)]),
  taskId: z.string().optional(),
  note: z.string().max(5000).optional(),
  startTime: V1WireDateSchema,
  endTime: V1WireDateSchema.optional(),
  pauseDuration: z.number().nonnegative().optional(),
  duration: z.number().nonnegative(),
  relationType: z.array(z.number().int()).optional(),
})

export type V1ChecklistItem = z.infer<typeof V1ChecklistItemSchema>
export type V1Task = z.infer<typeof V1TaskSchema>
export type V1Project = z.infer<typeof V1ProjectSchema>
export type V1Column = z.infer<typeof V1ColumnSchema>
export type V1ProjectData = z.infer<typeof V1ProjectDataSchema>
export type V1MoveTaskResult = z.infer<typeof V1MoveTaskResultSchema>
export type V1Comment = z.infer<typeof V1CommentSchema>
export type V1Group = z.infer<typeof V1GroupSchema>
export type V1Tag = z.infer<typeof V1TagSchema>
export type V1Focus = z.infer<typeof V1FocusSchema>
export type V1Habit = z.infer<typeof V1HabitSchema>
export type V1HabitCheckinItem = z.infer<typeof V1HabitCheckinItemSchema>
export type V1HabitCheckinAggregate = z.infer<typeof V1HabitCheckinAggregateSchema>
export type V1Countdown = z.infer<typeof V1CountdownSchema>
export type V1CompletedTaskFilter = z.infer<typeof V1CompletedTaskFilterSchema>
export type V1TaskFilter = z.infer<typeof V1TaskFilterSchema>
export type V1HabitCheckinInput = z.infer<typeof V1HabitCheckinInputSchema>
export type V1FocusCreate = z.infer<typeof V1FocusCreateSchema>
