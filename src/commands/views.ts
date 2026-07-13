import { Temporal } from "@js-temporal/polyfill"
import type { Command } from "commander"
import { AppError, reconcileAfterWrite } from "../api/errors"
import { mapV1Task } from "../api/v1/mapper"
import { flattenV2CalendarEvents } from "../api/v2/mapper"
import type { AppContext } from "../app/context"
import {
  cachedTaskToDomain,
  ensureCoreState,
  resolveInboxProject,
  resolveProject,
} from "../app/state"
import {
  dateInProfileTimeZone,
  isOverdue,
  normalizeDateTime,
  profileDate,
  resolveDateExpression,
} from "../core/dates"
import { evaluateFilter, parseFilter } from "../core/filters"
import { serializeTasksToIcs } from "../core/ics"
import { parseQuickAdd } from "../core/quickadd"
import { assertRecurrenceHasStart, parseRecurrenceExpression } from "../core/recur"
import { calculateUrgency, compareUrgency } from "../core/urgency"
import type { TaskCreateInput } from "../domain/inputs"
import type { DomainEvent, DomainTask } from "../domain/models"
import { dryRunResult, parsePriority, splitCommaValues } from "./common"
import { updateCalendarEventCache } from "./extensions"
import { addWriteOptions, executeCommand } from "./runtime"

type ViewName = "today" | "tomorrow" | "week" | "inbox" | "overdue" | "upcoming" | "all"

export function registerViewCommands(program: Command): void {
  for (const name of [
    "today",
    "tomorrow",
    "week",
    "inbox",
    "overdue",
    "upcoming",
    "all",
  ] as const) {
    program.command(name).action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => listView(context, name))
    })
  }

  program.command("next").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      const state = await ensureCoreState(context)
      const tasks = context.repositories
        .listTasks({ statuses: [0] })
        .map(cachedTaskToDomain)
        .sort((left, right) => compareUrgency(left, right, { timeZone: context.profile.timeZone }))
      const next = tasks[0]
      if (!next) throw new AppError("not_found", "No active task is available")
      return {
        data: {
          task: publicTask(next),
          urgency: calculateUrgency(next, { timeZone: context.profile.timeZone }),
        },
        meta: context.metadata(state.source, {
          fetchedAt: state.fetchedAt,
          stale: state.stale,
        }),
      }
    })
  })

  program
    .command("agenda")
    .argument("[date]", "calendar date", "today")
    .action(async (dateExpression: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const state = await ensureCoreState(context)
        const date = resolveDateExpression(dateExpression, context.profile.timeZone).toString()
        const tasks = context.repositories
          .listTasks({ statuses: [0] })
          .map(cachedTaskToDomain)
          .filter((task) => taskCalendarDate(task, context.profile.timeZone) === date)
        let calendar: unknown[] | { available: false; reason: string }
        const calendarFreshness = context.repositories.getFreshness("calendar.events")
        const calendarStale = calendarFreshness
          ? isFreshnessStale(calendarFreshness.fetchedAt, context.profile.cacheTtlSeconds)
          : true
        const useCalendarCache = Boolean(
          calendarFreshness &&
            !context.options.fresh &&
            (context.options.offline || !calendarStale || context.options.staleOk),
        )
        if (useCalendarCache && calendarFreshness) {
          if (
            context.cacheIdentity &&
            calendarFreshness.accountFingerprint &&
            context.cacheIdentity !== calendarFreshness.accountFingerprint
          ) {
            throw new AppError(
              "credential_account_mismatch",
              "Cached calendar data belongs to another account",
            )
          }
          calendar = context.repositories
            .listRawResource("events")
            .filter((event) => eventCalendarDate(event, context.profile.timeZone) === date)
            .map((event) => publicCachedEvent(event, calendarFreshness.fetchedAt))
        } else {
          calendar = {
            available: false,
            reason: calendarUnavailableReason(context),
          }
        }
        const calendarCapability = context.supports("calendar.events")
        if (
          !useCalendarCache &&
          calendarCapability?.api === "v2" &&
          context.v2 &&
          !context.options.offline
        ) {
          const bundles = await context.v2.getCalendarEvents()
          const calendarFetchedAt = new Date().toISOString()
          const events = flattenV2CalendarEvents(bundles, {
            fetchedAt: calendarFetchedAt,
            defaultTimeZone: context.profile.timeZone,
          })
          updateCalendarEventCache(
            context,
            events,
            calendarFetchedAt,
            bundles.every((bundle) => (bundle.errorIds?.length ?? 0) === 0),
          )
          calendar = events
            .filter((event) => eventCalendarDate(event, context.profile.timeZone) === date)
            .map(publicEvent)
        }
        return {
          data: { date, tasks: tasks.map(publicTask), calendar },
          meta: context.metadata(state.source, {
            fetchedAt: state.fetchedAt,
            stale: state.stale,
          }),
        }
      })
    })

  registerQuickAdd(program)
  registerIcsExport(program)
}

function calendarUnavailableReason(context: AppContext): string {
  if (context.options.offline) return "offline"
  try {
    context.capability("calendar.events")
    return "capability_missing"
  } catch (error) {
    return error instanceof AppError ? error.code : "capability_missing"
  }
}

async function listView(context: AppContext, name: ViewName) {
  const state = await ensureCoreState(context)
  const today = profileDate(context.profile.timeZone)
  const tomorrow = today.add({ days: 1 })
  const weekEnd = today.add({ days: 7 })
  const inbox = name === "inbox" ? await resolveInboxProject(context) : undefined
  const tasks = context.repositories
    .listTasks({ statuses: [0] })
    .map(cachedTaskToDomain)
    .filter((task) => {
      const dateValue =
        name === "overdue"
          ? taskValueCalendarDate(task, task.dueDate, context.profile.timeZone)
          : taskCalendarDate(task, context.profile.timeZone)
      const date = dateValue ? Temporal.PlainDate.from(dateValue) : undefined
      switch (name) {
        case "today":
          return date !== undefined && Temporal.PlainDate.compare(date, today) === 0
        case "tomorrow":
          return date !== undefined && Temporal.PlainDate.compare(date, tomorrow) === 0
        case "week":
          return (
            date !== undefined &&
            Temporal.PlainDate.compare(date, today) >= 0 &&
            Temporal.PlainDate.compare(date, weekEnd) < 0
          )
        case "inbox":
          return task.projectId === inbox?.id
        case "overdue":
          return isTaskOverdueForView(task, context.profile.timeZone)
        case "upcoming":
          return date !== undefined && Temporal.PlainDate.compare(date, tomorrow) >= 0
        case "all":
          return true
      }
    })
  return {
    data: tasks.map(publicTask),
    meta: context.metadata(state.source, {
      fetchedAt: state.fetchedAt,
      stale: state.stale,
      view: name,
      timeZone: context.profile.timeZone,
    }),
  }
}

function registerQuickAdd(program: Command): void {
  addWriteOptions(
    program
      .command("add")
      .description("Human-friendly English quick-add; agents should prefer task add")
      .argument("<text...>")
      .option("--project <id-or-name>")
      .option("--due <date>")
      .option("--start <date>")
      .option("--priority <level>")
      .option("--tags <names>")
      .option("--repeat <expression>")
      .option("--keep-text")
      .option("--literal-title"),
  ).action(async (parts: string[], _options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("task.add")
      const options = command.opts()
      const parsed = parseQuickAdd(parts.join(" "), {
        keepText: options.keepText,
        literalTitle: options.literalTitle,
      })
      const projectQuery = options.project ?? parsed.project
      const project = projectQuery
        ? await resolveProject(context, projectQuery)
        : await resolveInboxProject(context)
      const startDate = options.start
        ? normalizeQuickDate(options.start, context.profile.timeZone)
        : undefined
      const dueExpression = options.due ?? parsed.dateExpression
      const dueDate = dueExpression
        ? normalizeQuickDate(dueExpression, context.profile.timeZone)
        : undefined
      const repeatRule = options.repeat
        ? parseRecurrenceExpression(options.repeat).rule
        : parsed.recurrenceRule
      assertRecurrenceHasStart(repeatRule, startDate)
      const input: TaskCreateInput = {
        title: parsed.title,
        projectId: project.id,
        ...(startDate ? { startDate, isAllDay: isDateOnly(startDate) } : {}),
        ...(dueDate ? { dueDate, isAllDay: isDateOnly(dueDate) } : {}),
        ...(options.priority !== undefined
          ? { priority: parsePriority(options.priority) }
          : parsed.priority !== undefined
            ? { priority: parsed.priority }
            : {}),
        tags: options.tags ? splitCommaValues(options.tags) : parsed.tags,
        ...(repeatRule ? { repeatRule } : {}),
      }
      if (options.dryRun)
        return { data: dryRunResult("task.add", input), meta: context.metadata("local") }
      context.assertOnline()
      if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
      const before = new Set(
        context.repositories
          .listTasks({ projectId: project.id, includeDeleted: true })
          .map(({ id }) => id),
      )
      const response = await context.v1.createTask(input)
      if (!response) {
        const v1 = context.v1
        const projectData = await reconcileAfterWrite("task.add", { projectId: project.id }, () =>
          v1.getProjectData(project.id),
        )
        context.repositories.upsertTasks(
          projectData.tasks.map((task) => ({ ...task, projectId: task.projectId ?? project.id })),
          "v1",
        )
        const candidates = projectData.tasks.filter(
          (task) => !before.has(task.id) && task.title === input.title,
        )
        if (candidates.length !== 1) {
          throw new AppError(
            "write_outcome_unknown",
            "Task creation succeeded but readback was ambiguous",
            { details: { candidateIds: candidates.map(({ id }) => id) } },
          )
        }
        const task = mapV1Task(candidates[0] as (typeof projectData.tasks)[number], {
          defaultTimeZone: context.profile.timeZone,
        })
        return {
          data: publicTask(task),
          meta: context.metadata("v1", { fetchedAt: task.fetchedAt }),
        }
      }
      context.repositories.upsertTasks([{ ...response }], "v1")
      return {
        data: publicTask(mapV1Task(response, { defaultTimeZone: context.profile.timeZone })),
        meta: context.metadata("v1", { fetchedAt: new Date().toISOString() }),
      }
    })
  })
}

function registerIcsExport(program: Command): void {
  program
    .command("export")
    .command("ics")
    .argument("[filter...]")
    .option("--calendar-name <name>", "calendar display name", "TickTick Tasks")
    .action(async (filters: string[], _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const state = await ensureCoreState(context)
        const ast = parseFilter(filters)
        const projectNames = new Map(
          context.repositories.listProjects().map(({ id, name }) => [id, name]),
        )
        const tasks = context.repositories
          .listTasks({ statuses: [0] })
          .map(cachedTaskToDomain)
          .filter((task) =>
            evaluateFilter(ast, task, {
              timeZone: context.profile.timeZone,
              projectNames,
            }),
          )
        const ics = serializeTasksToIcs(tasks, { calendarName: command.opts().calendarName })
        return {
          data: { format: "text/calendar", count: tasks.length, content: ics },
          raw: ics,
          meta: context.metadata(state.source, {
            fetchedAt: state.fetchedAt,
            stale: state.stale,
          }),
        }
      })
    })
}

function taskCalendarDate(task: DomainTask, profileTimeZone: string): string | undefined {
  const value = task.dueDate ?? task.startDate
  return taskValueCalendarDate(task, value, profileTimeZone)
}

function taskValueCalendarDate(
  task: DomainTask,
  value: string | undefined,
  profileTimeZone: string,
): string | undefined {
  if (!value) return undefined
  try {
    return dateInProfileTimeZone(
      normalizeDateTime(value, {
        timeZone: task.timeZone ?? profileTimeZone,
        isAllDay: task.isAllDay,
        isFloating: task.isFloating,
      }),
      profileTimeZone,
    )
  } catch {
    return undefined
  }
}

export function isTaskOverdueForView(
  task: DomainTask,
  profileTimeZone: string,
  now?: string,
): boolean {
  if (!task.dueDate) return false
  try {
    return isOverdue(
      normalizeDateTime(task.dueDate, {
        timeZone: task.timeZone ?? profileTimeZone,
        isAllDay: task.isAllDay,
        isFloating: task.isFloating,
      }),
      profileTimeZone,
      now,
    )
  } catch {
    return false
  }
}

function eventCalendarDate(event: unknown, profileTimeZone: string): string | undefined {
  if (!event || typeof event !== "object" || Array.isArray(event)) return undefined
  const record = event as Record<string, unknown>
  const value = record.startDate ?? record.start
  if (typeof value !== "string") return undefined
  try {
    return dateInProfileTimeZone(
      normalizeDateTime(value, {
        timeZone: typeof record.timeZone === "string" ? record.timeZone : profileTimeZone,
        isAllDay: record.isAllDay === true || record.allDay === true,
      }),
      profileTimeZone,
    )
  } catch {
    return undefined
  }
}

function normalizeQuickDate(value: string, timeZone: string): string {
  if (/^(today|tomorrow|eom)$/i.test(value) || isDateOnly(value)) {
    return resolveDateExpression(value, timeZone).toString()
  }
  if (!Number.isFinite(Date.parse(value)))
    throw new AppError("invalid_input", `Invalid date: ${value}`)
  return value
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function publicTask(task: DomainTask): Record<string, unknown> {
  const { raw: _raw, ...safe } = task
  return safe
}

function publicEvent(event: DomainEvent): Record<string, unknown> {
  const { raw: _raw, ...safe } = event
  return safe
}

function publicCachedEvent(
  event: Record<string, unknown>,
  fetchedAt: string,
): Record<string, unknown> {
  return {
    id: event.id,
    title: typeof event.title === "string" ? event.title : "",
    startDate: event.startDate,
    isAllDay: event.isAllDay === true,
    source: "v2",
    fetchedAt,
    ...(typeof event.endDate === "string" ? { endDate: event.endDate } : {}),
    ...(typeof event.timeZone === "string" ? { timeZone: event.timeZone } : {}),
    ...(typeof event.accountId === "string" ? { accountId: event.accountId } : {}),
    ...(typeof event.calendarId === "string" ? { calendarId: event.calendarId } : {}),
    ...(typeof event.etag === "string" ? { etag: event.etag } : {}),
  }
}

function isFreshnessStale(fetchedAt: string, ttlSeconds: number): boolean {
  const timestamp = Date.parse(fetchedAt)
  return !Number.isFinite(timestamp) || Date.now() - timestamp > ttlSeconds * 1000
}
