import { type Command, Option } from "commander"
import { AppError, PartialFailureError, reconcileAfterWrite } from "../api/errors"
import { mapV1Task } from "../api/v1/mapper"
import type { V1Task } from "../api/v1/schemas"
import { mapV2Task } from "../api/v2/mapper"
import type { AppContext } from "../app/context"
import {
  cachedTaskToDomain,
  ensureCoreState,
  resolveInboxProject,
  resolveProject,
  resolveTask,
} from "../app/state"
import { resolveDateExpression } from "../core/dates"
import { type FilterAst, evaluateFilter, parseFilter } from "../core/filters"
import { assertRecurrenceHasStart, parseRecurrenceExpression } from "../core/recur"
import type { ChecklistItemInput, TaskCreateInput, TaskPatchInput } from "../domain/inputs"
import type { DomainTask } from "../domain/models"
import {
  dryRunResult,
  parseJsonObject,
  parsePriority,
  requireConfirmation,
  splitCommaValues,
} from "./common"
import { addDateRangeOptions, addWriteOptions, executeCommand } from "./runtime"

export function registerTaskCommands(program: Command): void {
  const task = program.command("task").description("Create, inspect, and mutate tasks")
  registerTaskAdd(task)
  registerTaskList(task)
  registerTaskShow(task)
  registerTaskEdit(task)
  registerTaskComplete(task)
  registerTaskDelete(task)
  registerTaskMove(task)
  registerTaskReopen(task)
  registerTaskCompleted(task)
  registerTaskPin(task, false)
  registerTaskPin(task, true)
  registerChecklist(task)
}

function registerTaskAdd(parent: Command): void {
  addWriteOptions(
    parent
      .command("add")
      .description("Create a task through documented v1")
      .requiredOption("--title <text>", "task title")
      .option("--project <id-or-name>", "target project; defaults to verified inbox")
      .option("--due <date>", "due date or ISO date-time")
      .option("--start <date>", "start date or ISO date-time")
      .addOption(new Option("--priority <level>", "none, low, medium, or high"))
      .option("--tags <names>", "comma-separated tags")
      .option("--content <text>", "task content")
      .option("--description <text>", "task description")
      .option("--checklist <json>", "JSON array of checklist items")
      .option("--repeat <rrule>", "RRULE or supported recurrence expression")
      .option("--parent <id-or-name>", "parent task")
      .option("--column <id>", "kanban column id")
      .option("--all-day", "treat dates as calendar dates"),
  ).action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      const options = command.opts()
      const useV2 = options.column !== undefined
      context.capability(useV2 ? "task.add.column" : "task.add")
      if (context.options.offline) throw new AppError("invalid_input", "Mutations are online-only")
      const project = options.project
        ? await resolveProject(context, options.project)
        : await resolveInboxProject(context)
      const parent = options.parent ? await resolveTask(context, options.parent) : undefined
      if (parent && parent.projectId !== project.id) {
        throw new AppError("invalid_input", "A parent task must be in the target project")
      }
      const startDate = normalizeInputDate(options.start, context.profile.timeZone)
      const dueDate = normalizeInputDate(options.due, context.profile.timeZone)
      const repeatRule = options.repeat ? parseRecurrenceExpression(options.repeat).rule : undefined
      assertRecurrenceHasStart(repeatRule, startDate)
      const input: TaskCreateInput = {
        title: options.title,
        projectId: project.id,
        ...(options.content ? { content: options.content } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(startDate ? { startDate } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(options.start || options.due
          ? { isAllDay: resolveIsAllDay(options.allDay, startDate ?? dueDate) }
          : {}),
        ...(options.priority !== undefined ? { priority: parsePriority(options.priority) } : {}),
        ...(options.tags ? { tags: splitCommaValues(options.tags) } : {}),
        ...(options.checklist ? { checklist: parseChecklist(options.checklist) } : {}),
        ...(repeatRule ? { repeatRule } : {}),
        ...(parent ? { parentId: parent.id } : {}),
        ...(options.column ? { columnId: options.column } : {}),
      }
      if (options.dryRun) {
        return { data: dryRunResult("task.add", input), meta: context.metadata("local") }
      }
      if (useV2) {
        if (!context.v2) {
          throw new AppError("authentication_missing", "A v2 session is required for --column")
        }
        const response = await context.v2.createTask(input)
        context.repositories.upsertTasks([{ ...response }], "v2")
        const result = mapV2Task(response, { defaultTimeZone: context.profile.timeZone })
        return {
          data: publicTask(result),
          meta: context.metadata("v2", { fetchedAt: result.fetchedAt, stale: false }),
        }
      }
      if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
      const before = new Set(
        context.repositories
          .listTasks({ projectId: project.id, includeDeleted: true })
          .map(({ id }) => id),
      )
      const response = await context.v1.createTask(input)
      const resolved = await reconcileCreatedTask(context, input, response, before)
      return {
        data: publicTask(resolved),
        meta: context.metadata("v1", { fetchedAt: resolved.fetchedAt, stale: false }),
      }
    })
  })
}

function registerTaskList(parent: Command): void {
  parent
    .command("list")
    .description("List cached active tasks with deterministic local filtering")
    .argument("[filter...]", "filter predicates")
    .option("--limit <count>", "maximum results", positiveInteger, 100)
    .action(async (filters: string[], _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const state = await ensureCoreState(context)
        const ast = parseFilter(filters)
        const projects = new Map(
          context.repositories.listProjects().map(({ id, name }) => [id, name]),
        )
        const tasks = filterTasksForList(
          context.repositories.listTasks({ statuses: [0] }).map(cachedTaskToDomain),
          ast,
          context.profile.timeZone,
          projects,
          command.opts().limit,
        )
        return {
          data: tasks.map(publicTask),
          meta: context.metadata(state.source, {
            fetchedAt: state.fetchedAt,
            stale: state.stale,
          }),
        }
      })
    })
}

function registerTaskShow(parent: Command): void {
  parent
    .command("show")
    .argument("<id-or-name>")
    .action(async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const task = await resolveTask(context, query)
        const state = context.repositories.getFreshness("core")
        return {
          data: publicTask(cachedTaskToDomain(task)),
          meta: context.metadata("cache", {
            fetchedAt: state?.fetchedAt,
            stale: state
              ? Date.now() - Date.parse(state.fetchedAt) > context.profile.cacheTtlSeconds * 1000
              : true,
          }),
        }
      })
    })
}

function registerTaskEdit(parent: Command): void {
  addWriteOptions(
    parent
      .command("edit")
      .argument("<id-or-name>")
      .option("--title <text>")
      .option("--content <text>")
      .option("--description <text>")
      .option("--due <date>")
      .option("--start <date>")
      .option("--clear-due")
      .option("--clear-start")
      .option("--priority <level>")
      .option("--tags <names>")
      .option("--repeat <rrule>")
      .option("--clear-repeat")
      .option("--parent <id-or-name>")
      .option("--clear-parent")
      .option("--column <id>")
      .option("--clear-column")
      .option("--all-day"),
  ).action(async (query: string, _options, command: Command) => {
    await executeCommand(command, async (context) => {
      const task = await resolveTask(context, query)
      const options = command.opts()
      const useV2 = options.column !== undefined || options.clearColumn === true
      context.capability(useV2 ? "task.edit.column" : "task.edit")
      const parent = options.parent ? await resolveTask(context, options.parent) : undefined
      const dueDate =
        options.due !== undefined
          ? normalizeInputDate(options.due, context.profile.timeZone)
          : options.clearDue
            ? null
            : undefined
      const startDate =
        options.start !== undefined
          ? normalizeInputDate(options.start, context.profile.timeZone)
          : options.clearStart
            ? null
            : undefined
      const patch: TaskPatchInput = {
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.content !== undefined ? { content: options.content } : {}),
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(dueDate !== undefined ? { dueDate } : {}),
        ...(startDate !== undefined ? { startDate } : {}),
        ...(options.due !== undefined || options.start !== undefined
          ? { isAllDay: resolveIsAllDay(options.allDay, startDate ?? dueDate ?? undefined) }
          : options.allDay
            ? { isAllDay: true }
            : {}),
        ...(options.priority !== undefined ? { priority: parsePriority(options.priority) } : {}),
        ...(options.tags !== undefined ? { tags: splitCommaValues(options.tags) } : {}),
        ...(options.repeat !== undefined
          ? { repeatRule: parseRecurrenceExpression(options.repeat).rule }
          : options.clearRepeat
            ? { repeatRule: null }
            : {}),
        ...(parent ? { parentId: parent.id } : options.clearParent ? { parentId: null } : {}),
        ...(options.column !== undefined
          ? { columnId: options.column }
          : options.clearColumn
            ? { columnId: null }
            : {}),
      }
      if (Object.keys(patch).length === 0) {
        throw new AppError("invalid_input", "At least one edit option is required")
      }
      assertRecurrenceHasStart(
        typeof patch.repeatRule === "string" ? patch.repeatRule : undefined,
        typeof patch.startDate === "string" ? patch.startDate : task.startDate,
      )
      if (options.dryRun) {
        return {
          data: dryRunResult("task.edit", { id: task.id, projectId: task.projectId, patch }),
          meta: context.metadata("local"),
        }
      }
      if (context.options.offline) throw new AppError("invalid_input", "Mutations are online-only")
      if (useV2) {
        if (!context.v2) {
          throw new AppError("authentication_missing", "A v2 session is required for --column")
        }
        const response = await context.v2.updateTask(task.id, task.projectId, patch)
        context.repositories.upsertTasks([{ ...response }], "v2")
        const result = mapV2Task(response, { defaultTimeZone: context.profile.timeZone })
        return {
          data: publicTask(result),
          meta: context.metadata("v2", { fetchedAt: result.fetchedAt }),
        }
      }
      if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
      const response = await context.v1.updateTask(task.id, task.projectId, patch)
      const reconciled = await reconcileTask(
        context,
        task.projectId,
        task.id,
        response,
        "task.edit",
      )
      return {
        data: publicTask(reconciled),
        meta: context.metadata("v1", { fetchedAt: reconciled.fetchedAt }),
      }
    })
  })
}

function registerTaskComplete(parent: Command): void {
  addWriteOptions(parent.command("complete").argument("<id-or-name...>")).action(
    async (queries: string[], _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("task.complete")
        const tasks = await resolveManyTasks(context, queries)
        if (command.opts().dryRun) {
          return {
            data: dryRunResult(
              "task.complete",
              tasks.map(({ id, projectId }) => ({ id, projectId })),
            ),
            meta: context.metadata("local"),
          }
        }
        if (context.options.offline)
          throw new AppError("invalid_input", "Mutations are online-only")
        if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
        const successes: string[] = []
        const failures: Array<{ id: string; code: string; message: string }> = []
        for (const task of tasks) {
          try {
            await context.v1.completeTask(task.projectId, task.id)
            successes.push(task.id)
          } catch (error) {
            failures.push(failureFor(task.id, error))
          }
        }
        if (successes.length > 0) {
          // Completed tasks disappear from active project snapshots. Removing them locally and
          // invalidating freshness is safe for both one-shot and recurring completions; the next
          // read refreshes an advanced recurring instance with the same id when applicable.
          applyCompletedTaskCache(context, successes)
        }
        if (failures.length)
          throw new PartialFailureError("Some tasks could not be completed", failures, successes)
        return { data: { completed: successes }, meta: context.metadata("v1") }
      })
    },
  )
}

function registerTaskDelete(parent: Command): void {
  addWriteOptions(parent.command("delete").argument("<id-or-name...>")).action(
    async (queries: string[], _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("task.delete")
        const tasks = await resolveManyTasks(context, queries)
        if (command.opts().dryRun) {
          return {
            data: dryRunResult(
              "task.delete",
              tasks.map(({ id, projectId }) => ({ id, projectId })),
            ),
            meta: context.metadata("local"),
          }
        }
        requireConfirmation(command.opts(), "delete tasks")
        if (context.options.offline)
          throw new AppError("invalid_input", "Mutations are online-only")
        if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
        const successes: string[] = []
        const failures: Array<{ id: string; code: string; message: string }> = []
        for (const task of tasks) {
          try {
            await context.v1.deleteTask(task.projectId, task.id)
            context.repositories.deleteTasks([task.id])
            successes.push(task.id)
          } catch (error) {
            failures.push(failureFor(task.id, error))
          }
        }
        context.repositories.invalidate("core")
        if (failures.length)
          throw new PartialFailureError("Some tasks could not be deleted", failures, successes)
        return { data: { deleted: successes }, meta: context.metadata("v1") }
      })
    },
  )
}

function registerTaskMove(parent: Command): void {
  addWriteOptions(parent.command("move").argument("<id-or-name>").argument("<project>")).action(
    async (query: string, projectQuery: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("task.move")
        const task = await resolveTask(context, query)
        const destination = await resolveProject(context, projectQuery, { sync: false })
        const request = {
          taskId: task.id,
          fromProjectId: task.projectId,
          toProjectId: destination.id,
        }
        if (command.opts().dryRun)
          return { data: dryRunResult("task.move", request), meta: context.metadata("local") }
        if (context.options.offline)
          throw new AppError("invalid_input", "Mutations are online-only")
        if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
        await context.v1.moveTask(task.id, task.projectId, destination.id)
        context.store.transaction(() => {
          context.repositories.upsertTasks(
            [{ ...task.raw, id: task.id, projectId: destination.id }],
            "v1",
          )
          context.repositories.invalidate("core")
        })
        return { data: request, meta: context.metadata("v1") }
      })
    },
  )
}

function registerTaskReopen(parent: Command): void {
  addWriteOptions(parent.command("reopen").argument("<id-or-name>")).action(
    async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("task.reopen")
        const task = await resolveTask(context, query)
        const request = { taskId: task.id, projectId: task.projectId, status: 0 }
        if (command.opts().dryRun)
          return { data: dryRunResult("task.reopen", request), meta: context.metadata("local") }
        if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
        const response = await context.v1.reopenTask(task.id, task.projectId)
        const reconciled = await reconcileTask(
          context,
          task.projectId,
          task.id,
          response,
          "task.reopen",
        )
        return { data: publicTask(reconciled), meta: context.metadata("v1") }
      })
    },
  )
}

function registerTaskCompleted(parent: Command): void {
  addDateRangeOptions(parent.command("completed").option("--project <id-or-name>")).action(
    async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        if (context.options.offline) {
          const state = await ensureCoreState(context)
          const tasks = context.repositories.listTasks({ statuses: [2] }).map(cachedTaskToDomain)
          return { data: tasks.map(publicTask), meta: context.metadata("cache", { ...state }) }
        }
        context.capability("task.completed")
        if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
        const project = command.opts().project
          ? await resolveProject(context, command.opts().project)
          : undefined
        const response =
          (await context.v1.completedTasks({
            ...(command.opts().from ? { startDate: command.opts().from } : {}),
            ...(command.opts().to ? { endDate: command.opts().to } : {}),
            ...(project ? { projectIds: [project.id] } : {}),
          })) ?? []
        const tasks = response.map((wire) =>
          mapV1Task(wire, { defaultTimeZone: context.profile.timeZone }),
        )
        return {
          data: tasks.map(publicTask),
          meta: context.metadata("v1", { fetchedAt: new Date().toISOString() }),
        }
      })
    },
  )
}

function registerTaskPin(parent: Command, unpin: boolean): void {
  addWriteOptions(parent.command(unpin ? "unpin" : "pin").argument("<id-or-name>")).action(
    async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability(unpin ? "task.unpin" : "task.pin")
        const task = await resolveTask(context, query)
        const request = {
          id: task.id,
          projectId: task.projectId,
          pinnedTime: unpin ? "-1" : new Date().toISOString(),
        }
        if (command.opts().dryRun)
          return {
            data: dryRunResult(unpin ? "task.unpin" : "task.pin", request),
            meta: context.metadata("local"),
          }
        if (!context.v2) throw new AppError("authentication_missing", "A v2 session is required")
        const result = unpin
          ? await context.v2.unpinTask(task.id, task.projectId)
          : await context.v2.pinTask(task.id, task.projectId, request.pinnedTime)
        context.repositories.invalidate("core")
        return { data: result, meta: context.metadata("v2") }
      })
    },
  )
}

function registerChecklist(parent: Command): void {
  const checklist = parent.command("checklist")
  addWriteOptions(checklist.command("add").argument("<task>").argument("<title>")).action(
    async (taskQuery: string, title: string, _options, command: Command) => {
      await mutateChecklist(command, taskQuery, (items) => [
        ...items,
        { id: crypto.randomUUID(), title, completed: false },
      ])
    },
  )
  addWriteOptions(
    checklist.command("complete").argument("<task>").argument("<title-or-id>"),
  ).action(async (taskQuery: string, itemQuery: string, _options, command: Command) => {
    await mutateChecklist(command, taskQuery, (items) =>
      items.map((item) => (matchesItem(item, itemQuery) ? { ...item, completed: true } : item)),
    )
  })
  addWriteOptions(checklist.command("delete").argument("<task>").argument("<title-or-id>")).action(
    async (taskQuery: string, itemQuery: string, _options, command: Command) => {
      await mutateChecklist(command, taskQuery, (items) =>
        items.filter((item) => !matchesItem(item, itemQuery)),
      )
    },
  )
}

async function mutateChecklist(
  command: Command,
  taskQuery: string,
  mutation: (items: ChecklistItemInput[]) => ChecklistItemInput[],
): Promise<void> {
  await executeCommand(command, async (context) => {
    context.capability("task.checklist.edit")
    const task = await resolveTask(context, taskQuery)
    const current = cachedTaskToDomain(task).checklist.map((item) => ({
      id: item.id,
      title: item.title,
      completed: item.status === "completed",
      ...(item.sortOrder !== undefined ? { sortOrder: item.sortOrder } : {}),
    }))
    const checklist = mutation(current)
    if (
      checklist.length === current.length &&
      checklist.every((item, index) => item === current[index])
    ) {
      throw new AppError("not_found", "Checklist item not found")
    }
    const request = { taskId: task.id, projectId: task.projectId, checklist }
    if (command.opts().dryRun)
      return { data: dryRunResult("task.checklist.edit", request), meta: context.metadata("local") }
    if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
    const response = await context.v1.updateTask(task.id, task.projectId, { checklist })
    const reconciled = await reconcileTask(
      context,
      task.projectId,
      task.id,
      response,
      "task.checklist.edit",
    )
    return { data: publicTask(reconciled), meta: context.metadata("v1") }
  })
}

export function applyCompletedTaskCache(
  context: Pick<AppContext, "store" | "repositories">,
  taskIds: readonly string[],
): void {
  context.store.transaction(() => {
    context.repositories.deleteTasks(taskIds)
    context.repositories.invalidate("core")
  })
}

export function filterTasksForList(
  tasks: readonly DomainTask[],
  ast: FilterAst,
  timeZone: string,
  projectNames: ReadonlyMap<string, string>,
  limit: number,
): DomainTask[] {
  return tasks
    .filter((candidate) => evaluateFilter(ast, candidate, { timeZone, projectNames }))
    .slice(0, limit)
}

/**
 * A create response is trusted verbatim rather than confirmed via readback below;
 * that trust is only warranted when it actually reports the date fields the caller
 * asked to set, since the v1 create endpoint can return a partial body that silently
 * omits them.
 */
export function responseHasRequestedDates(input: TaskCreateInput, response: V1Task): boolean {
  if (input.dueDate !== undefined && !response.dueDate) return false
  if (input.startDate !== undefined && !response.startDate) return false
  return true
}

async function reconcileCreatedTask(
  context: AppContext,
  input: TaskCreateInput,
  response: V1Task | undefined,
  before: ReadonlySet<string>,
): Promise<DomainTask> {
  const v1 = context.v1
  if (!v1) throw new AppError("authentication_missing", "A v1 token is required")
  if (response && !input.parentId && responseHasRequestedDates(input, response)) {
    context.repositories.upsertTasks([{ ...response }], "v1")
    return mapV1Task(response, { defaultTimeZone: context.profile.timeZone })
  }
  const data = await reconcileAfterWrite(
    "task.add",
    { projectId: input.projectId, ...(response?.id ? { taskId: response.id } : {}) },
    () => v1.getProjectData(input.projectId),
  )
  context.repositories.upsertProjects([{ ...data.project }], "v1")
  context.repositories.upsertTasks(
    data.tasks.map((task) => ({ ...task, projectId: task.projectId ?? input.projectId })),
    "v1",
  )
  const id = response?.id
  const candidates = data.tasks.filter(
    (task) =>
      (id ? task.id === id : !before.has(task.id) && task.title === input.title) &&
      (!input.parentId || task.parentId === input.parentId),
  )
  if (candidates.length !== 1) {
    throw new AppError(
      "write_outcome_unknown",
      "Task creation succeeded but readback was ambiguous",
      {
        details: { projectId: input.projectId, candidateIds: candidates.map(({ id }) => id) },
      },
    )
  }
  return mapV1Task(candidates[0] as V1Task, { defaultTimeZone: context.profile.timeZone })
}

async function reconcileTask(
  context: AppContext,
  projectId: string,
  taskId: string,
  response?: V1Task,
  operation = "task.edit",
): Promise<DomainTask> {
  const v1 = context.v1
  if (!v1) throw new AppError("authentication_missing", "A v1 token is required")
  const wire =
    response ??
    (await reconcileAfterWrite(operation, { projectId, taskId }, () =>
      v1.getTask(projectId, taskId),
    ))
  context.repositories.upsertTasks([{ ...wire }], "v1")
  return mapV1Task(wire, { defaultTimeZone: context.profile.timeZone })
}

async function resolveManyTasks(context: AppContext, queries: readonly string[]) {
  await ensureCoreState(context)
  const tasks = []
  for (const query of queries) tasks.push(await resolveTask(context, query, { sync: false }))
  return tasks
}

function normalizeInputDate(value: string | undefined, timeZone: string): string | undefined {
  if (!value) return undefined
  if (isDateOnly(value) || /^(today|tomorrow|eom)$/i.test(value)) {
    return resolveDateExpression(value, timeZone).toString()
  }
  const time = Date.parse(value)
  if (!Number.isFinite(time))
    throw new AppError("invalid_input", `Invalid date or date-time: ${value}`)
  return value
}

function isDateOnly(value: string | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

/** A bare calendar date implies an all-day task unless the caller says otherwise. */
export function resolveIsAllDay(
  explicit: boolean | undefined,
  sample: string | undefined,
): boolean {
  return Boolean(explicit) || isDateOnly(sample)
}

function parseChecklist(value: string): ChecklistItemInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch (cause) {
    throw new AppError("invalid_input", "--checklist must be valid JSON", { cause })
  }
  if (!Array.isArray(parsed))
    throw new AppError("invalid_input", "--checklist must be a JSON array")
  return parsed.map((item, index) => {
    if (typeof item === "string") return { title: item }
    const record = parseJsonObject(JSON.stringify(item), `checklist item ${index + 1}`)
    if (typeof record.title !== "string" || record.title.length === 0) {
      throw new AppError("invalid_input", `Checklist item ${index + 1} requires a title`)
    }
    return {
      title: record.title,
      ...(typeof record.id === "string" ? { id: record.id } : {}),
      ...(typeof record.completed === "boolean" ? { completed: record.completed } : {}),
    }
  })
}

function matchesItem(item: ChecklistItemInput, query: string): boolean {
  return (
    item.id === query ||
    item.title.normalize("NFKC").toLowerCase() === query.normalize("NFKC").toLowerCase()
  )
}

function publicTask(task: DomainTask): Record<string, unknown> {
  const { raw: _raw, ...safe } = task
  return safe
}

function positiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("must be a positive integer")
  return parsed
}

function failureFor(id: string, error: unknown): { id: string; code: string; message: string } {
  if (error instanceof AppError) return { id, code: error.code, message: error.message }
  return {
    id,
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  }
}
