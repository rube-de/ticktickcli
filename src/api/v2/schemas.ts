import { z } from "zod"

export const V2ObjectIdSchema = z.string().regex(/^[0-9a-f]{24}$/i)
export const V2IdSchema = z.string().min(1)
export const V2WireDateSchema = z.string().min(1)
export const V2PrioritySchema = z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(5)])

export const V2ChecklistItemSchema = z
  .object({
    id: z.string().optional(),
    title: z.string(),
    status: z.number().int().optional(),
    completedTime: V2WireDateSchema.nullable().optional(),
    isAllDay: z.boolean().optional(),
    sortOrder: z.number().optional(),
    startDate: V2WireDateSchema.nullable().optional(),
    timeZone: z.string().optional(),
  })
  .passthrough()

export const V2TaskSchema = z
  .object({
    id: V2IdSchema,
    projectId: V2IdSchema,
    title: z.string(),
    etag: z.string().optional(),
    content: z.string().optional(),
    desc: z.string().optional(),
    kind: z.string().optional(),
    status: z.number().int().optional(),
    priority: V2PrioritySchema.optional(),
    progress: z.number().optional(),
    deleted: z.number().int().optional(),
    startDate: V2WireDateSchema.nullable().optional(),
    dueDate: V2WireDateSchema.nullable().optional(),
    createdTime: V2WireDateSchema.nullable().optional(),
    modifiedTime: V2WireDateSchema.nullable().optional(),
    completedTime: V2WireDateSchema.nullable().optional(),
    pinnedTime: z.string().nullable().optional(),
    timeZone: z.string().optional(),
    isAllDay: z.boolean().optional(),
    isFloating: z.boolean().optional(),
    repeatFlag: z.string().optional(),
    repeatFrom: z.union([z.number().int(), z.string()]).optional(),
    reminders: z.array(z.union([z.string(), z.record(z.unknown())])).optional(),
    parentId: z.string().optional(),
    childIds: z.array(z.string()).optional(),
    items: z.array(V2ChecklistItemSchema).optional(),
    tags: z.array(z.string()).optional(),
    columnId: z.string().optional(),
    sortOrder: z.number().optional(),
  })
  .passthrough()

export const V2ProjectSchema = z
  .object({
    id: V2IdSchema,
    name: z.string(),
    etag: z.string().optional(),
    color: z.string().nullable().optional(),
    sortOrder: z.number().optional(),
    closed: z.boolean().nullable().optional(),
    groupId: z.string().optional(),
    viewMode: z.string().nullable().optional(),
    permission: z.string().nullable().optional(),
    kind: z.string().optional(),
  })
  .passthrough()

export const V2GroupSchema = z
  .object({
    id: V2IdSchema,
    name: z.string(),
    etag: z.string().optional(),
    sortOrder: z.number().optional(),
  })
  .passthrough()

export const V2ColumnSchema = z
  .object({
    id: V2IdSchema,
    projectId: V2IdSchema,
    name: z.string(),
    etag: z.string().optional(),
    sortOrder: z.number().optional(),
    createdTime: V2WireDateSchema.optional(),
    modifiedTime: V2WireDateSchema.optional(),
  })
  .passthrough()

export const V2TagSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    label: z.string().optional(),
    etag: z.string().optional(),
    color: z.string().optional(),
    sortOrder: z.number().optional(),
    parent: z.string().optional(),
  })
  .passthrough()

export const V2FilterSchema = z
  .object({
    id: V2IdSchema,
    name: z.string(),
    rule: z.unknown(),
    etag: z.string().optional(),
    sortOrder: z.number().optional(),
  })
  .passthrough()

export const V2HabitSchema = z
  .object({
    id: V2IdSchema,
    name: z.string(),
    etag: z.string().optional(),
    iconRes: z.string().optional(),
    color: z.string().optional(),
    sortOrder: z.number().optional(),
    status: z.number().int().optional(),
    encouragement: z.string().optional(),
    totalCheckIns: z.number().optional(),
    currentStreak: z.number().optional(),
    createdTime: V2WireDateSchema.optional(),
    modifiedTime: V2WireDateSchema.optional(),
    archivedTime: V2WireDateSchema.optional(),
    type: z.string().optional(),
    goal: z.number().optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
    repeatRule: z.string().optional(),
    reminders: z.array(z.string()).optional(),
    recordEnable: z.boolean().optional(),
    sectionId: z.string().optional(),
    targetDays: z.number().int().optional(),
    targetStartDate: z.number().int().optional(),
    completedCycles: z.number().int().optional(),
    exDates: z.array(z.string()).optional(),
  })
  .passthrough()

export const V2CheckinSchema = z
  .object({
    id: z.string().optional(),
    habitId: V2IdSchema,
    checkinStamp: z.number().int(),
    checkinTime: V2WireDateSchema.optional(),
    opTime: V2WireDateSchema.optional(),
    value: z.number().optional(),
    goal: z.number().optional(),
    status: z.number().int().optional(),
    etag: z.string().optional(),
    createdTime: V2WireDateSchema.optional(),
    modifiedTime: V2WireDateSchema.optional(),
  })
  .passthrough()

export const V2CalendarEventSchema = z
  .object({
    id: z.string().optional(),
    eventId: z.string().optional(),
    accountId: z.string().optional(),
    calendarId: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    startDate: z.string().optional(),
    startTime: z.string().optional(),
    endDate: z.string().optional(),
    endTime: z.string().optional(),
    timeZone: z.string().optional(),
    isAllDay: z.boolean().optional(),
    isFloating: z.boolean().optional(),
    repeatFlag: z.string().optional(),
    status: z.string().optional(),
    url: z.string().optional(),
    etag: z.string().optional(),
  })
  .passthrough()

export const V2SyncTaskBeanSchema = z
  .object({
    add: z.array(V2TaskSchema).nullable().optional(),
    update: z.array(V2TaskSchema).nullable().optional(),
    delete: z.array(z.unknown()).nullable().optional(),
    empty: z.boolean().optional(),
  })
  .passthrough()

export const V2SyncStateSchema = z
  .object({
    inboxId: z.string().optional(),
    projectProfiles: z.array(V2ProjectSchema).nullable().optional(),
    projectGroups: z.array(V2GroupSchema).nullable().optional(),
    syncTaskBean: V2SyncTaskBeanSchema.nullable().optional(),
    tags: z.array(V2TagSchema).nullable().optional(),
    filters: z.array(V2FilterSchema).nullable().optional(),
    checkPoint: z.union([z.string(), z.number()]),
    checks: z.unknown().optional(),
    syncOrderBean: z.unknown().nullable().optional(),
    syncTaskOrderBean: z.unknown().nullable().optional(),
  })
  .passthrough()

/** `/batch/check/0` is authoritative only when its required snapshot sets are present. */
export const V2FullSyncStateSchema = V2SyncStateSchema.extend({
  inboxId: z.string(),
  projectProfiles: z.array(V2ProjectSchema),
  projectGroups: z.array(V2GroupSchema),
  syncTaskBean: V2SyncTaskBeanSchema.extend({
    update: z.array(V2TaskSchema),
  }),
  tags: z.array(V2TagSchema),
})

export const V2BatchResponseSchema = z
  .object({
    id2etag: z.record(z.unknown()),
    id2error: z.record(z.unknown()),
  })
  .passthrough()

export const V2TaskAddSchema = z
  .object({
    id: V2ObjectIdSchema,
    projectId: V2IdSchema,
    title: z.string(),
  })
  .passthrough()

export const V2TaskUpdateSchema = z
  .object({
    id: V2IdSchema,
    projectId: V2IdSchema,
  })
  .passthrough()

export const V2TaskDeleteSchema = z.object({
  taskId: V2IdSchema,
  projectId: V2IdSchema,
})

export const V2BatchTaskRequestSchema = z
  .object({
    add: z.array(V2TaskAddSchema).default([]),
    update: z.array(V2TaskUpdateSchema).default([]),
    delete: z.array(V2TaskDeleteSchema).default([]),
    addAttachments: z.array(z.unknown()).default([]),
    updateAttachments: z.array(z.unknown()).default([]),
    deleteAttachments: z.array(z.unknown()).default([]),
  })
  .strict()

export const V2TaskMoveSchema = z.object({
  taskId: V2IdSchema,
  fromProjectId: V2IdSchema,
  toProjectId: V2IdSchema,
})

export const V2TaskParentSetSchema = z.object({
  taskId: V2IdSchema,
  projectId: V2IdSchema,
  parentId: V2IdSchema,
})

export const V2TaskParentUnsetSchema = z.object({
  taskId: V2IdSchema,
  projectId: V2IdSchema,
  oldParentId: V2IdSchema,
})

export const V2TrashResponseSchema = z
  .object({
    tasks: z.array(V2TaskSchema),
    next: z.unknown().optional(),
  })
  .passthrough()

export const V2TrashRestoreItemSchema = z.object({
  fromProjectId: V2IdSchema,
  taskId: V2IdSchema,
  toProjectId: V2IdSchema,
})

export const V2FilterWriteSchema = z
  .object({
    id: V2ObjectIdSchema,
    name: z.string(),
    rule: z.string(),
    sortOrder: z.number().int(),
  })
  .passthrough()

export const V2BatchFilterRequestSchema = z.object({
  add: z.array(V2FilterWriteSchema).default([]),
  update: z.array(V2FilterWriteSchema).default([]),
  delete: z.array(V2IdSchema).default([]),
})

export const V2ColumnWriteSchema = z
  .object({
    id: V2ObjectIdSchema,
    projectId: V2IdSchema,
    name: z.string(),
    sortOrder: z.number(),
  })
  .passthrough()

export const V2ColumnDeleteSchema = z.object({
  columnId: V2IdSchema,
  projectId: V2IdSchema,
})

export const V2BatchColumnRequestSchema = z.object({
  add: z.array(V2ColumnWriteSchema).default([]),
  update: z.array(V2ColumnWriteSchema).default([]),
  delete: z.array(V2ColumnDeleteSchema).default([]),
})

export const V2ProjectWriteSchema = z
  .object({
    id: V2IdSchema,
  })
  .passthrough()

export const V2ProjectAddSchema = z
  .object({
    id: V2ObjectIdSchema,
    name: z.string(),
  })
  .passthrough()

export const V2BatchProjectRequestSchema = z.object({
  add: z.array(V2ProjectAddSchema).default([]),
  update: z.array(V2ProjectWriteSchema).default([]),
  delete: z.array(V2IdSchema).default([]),
})

export const V2GeneralStatisticsSchema = z
  .object({
    level: z.number().optional(),
    score: z.number().optional(),
    todayCompleted: z.number().optional(),
    totalCompleted: z.number().optional(),
    todayPomoCount: z.number().optional(),
    todayPomoDuration: z.number().optional(),
    pomoByDay: z.unknown().optional(),
    pomoByWeek: z.unknown().optional(),
    pomoByMonth: z.unknown().optional(),
    taskByDay: z.unknown().optional(),
    taskByWeek: z.unknown().optional(),
    taskByMonth: z.unknown().optional(),
  })
  .passthrough()

export const V2FocusHeatmapSchema = z.array(z.unknown())
export const V2FocusDistributionSchema = z
  .object({
    tagDurations: z.record(z.number()).optional(),
  })
  .passthrough()

export const V2CalendarAccountSchema = z
  .object({
    id: z.string().optional(),
    accountId: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough()

export const V2CalendarEventBundleSchema = z
  .object({
    accountId: z.string().optional(),
    events: z.array(V2CalendarEventSchema),
    errorIds: z.array(z.string()).optional(),
    begin: z.unknown().optional(),
    end: z.unknown().optional(),
  })
  .passthrough()

export const V2CalendarAccountsSchema = z.array(V2CalendarAccountSchema)
export const V2CalendarSubscriptionsSchema = z.array(z.record(z.unknown()))
export const V2CalendarEventBundlesSchema = z.array(V2CalendarEventBundleSchema)
export const V2ArchivedEventsSchema = z.array(V2CalendarEventSchema)

export const V2UserStatusSchema = z
  .object({
    userId: z.union([z.string(), z.number()]).optional(),
    username: z.string().optional(),
    inboxId: z.string().optional(),
    pro: z.boolean().optional(),
    proStartDate: z.string().optional(),
    proEndDate: z.string().optional(),
    teamUser: z.boolean().optional(),
  })
  .passthrough()

export const V2UserProfileSchema = z.record(z.unknown())
export const V2UserPreferencesSchema = z.record(z.unknown())
export const V2TaskListSchema = z.array(V2TaskSchema)
export const V2ProjectListSchema = z.array(V2ProjectSchema)
export const V2GroupListSchema = z.array(V2GroupSchema)
export const V2ColumnListSchema = z.array(V2ColumnSchema)
export const V2TagListSchema = z.array(V2TagSchema)
export const V2HabitListSchema = z.array(V2HabitSchema)

export const V2HabitCheckinQueryResponseSchema = z
  .object({
    checkins: z.record(z.array(V2CheckinSchema)),
  })
  .passthrough()

export type V2ChecklistItem = z.infer<typeof V2ChecklistItemSchema>
export type V2Task = z.infer<typeof V2TaskSchema>
export type V2Project = z.infer<typeof V2ProjectSchema>
export type V2Group = z.infer<typeof V2GroupSchema>
export type V2Column = z.infer<typeof V2ColumnSchema>
export type V2Tag = z.infer<typeof V2TagSchema>
export type V2Filter = z.infer<typeof V2FilterSchema>
export type V2Habit = z.infer<typeof V2HabitSchema>
export type V2Checkin = z.infer<typeof V2CheckinSchema>
export type V2CalendarEvent = z.infer<typeof V2CalendarEventSchema>
export type V2CalendarEventBundle = z.infer<typeof V2CalendarEventBundleSchema>
export type V2SyncState = z.infer<typeof V2SyncStateSchema>
export type V2BatchResponse = z.infer<typeof V2BatchResponseSchema>
export type V2BatchTaskRequest = z.input<typeof V2BatchTaskRequestSchema>
export type V2TaskMove = z.infer<typeof V2TaskMoveSchema>
export type V2TaskParentSet = z.infer<typeof V2TaskParentSetSchema>
export type V2TaskParentUnset = z.infer<typeof V2TaskParentUnsetSchema>
export type V2TrashResponse = z.infer<typeof V2TrashResponseSchema>
export type V2TrashRestoreItem = z.infer<typeof V2TrashRestoreItemSchema>
export type V2FilterWrite = z.infer<typeof V2FilterWriteSchema>
export type V2BatchFilterRequest = z.input<typeof V2BatchFilterRequestSchema>
export type V2BatchColumnRequest = z.input<typeof V2BatchColumnRequestSchema>
export type V2BatchProjectRequest = z.input<typeof V2BatchProjectRequestSchema>
export type V2GeneralStatistics = z.infer<typeof V2GeneralStatisticsSchema>
export type V2FocusDistribution = z.infer<typeof V2FocusDistributionSchema>
export type V2CalendarAccount = z.infer<typeof V2CalendarAccountSchema>
export type V2UserStatus = z.infer<typeof V2UserStatusSchema>
export type V2HabitCheckinQueryResponse = z.infer<typeof V2HabitCheckinQueryResponseSchema>
