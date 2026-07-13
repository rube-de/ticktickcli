import type { Command } from "commander"
import { getCapability } from "../api/capabilities"
import { AppError, ProtocolError } from "../api/errors"
import type { V2Client } from "../api/v2/client"
import { flattenV2CalendarEvents, mapV2Task } from "../api/v2/mapper"
import type {
  V2CalendarAccount,
  V2CalendarEventBundle,
  V2GeneralStatistics,
  V2Task,
  V2TrashRestoreItem,
} from "../api/v2/schemas"
import type { AppContext } from "../app/context"
import { cachedTaskToDomain, ensureCoreState, resolveProject } from "../app/state"
import { ResolutionError, requireResolved } from "../core/resolve"
import type { DomainEvent, DomainTask } from "../domain/models"
import type { Repositories, WireRecord } from "../store/repositories"
import { dryRunResult } from "./common"
import { addWriteOptions, executeCommand } from "./runtime"

const DEFAULT_SEARCH_LIMIT = 50
const DEFAULT_TRASH_LIMIT = 100
const MAX_LIST_LIMIT = 500

export const LOCAL_SEARCH_FALLBACK = {
  mode: "local_cache",
  remoteOperation: "search.remote",
  reason: "remote_search_not_live_verified",
} as const

export function registerExtensionCommands(program: Command): void {
  registerCalendarCommands(program)
  registerStatsCommand(program)
  registerTrashCommands(program)
  registerSearchCommand(program)
}

function registerCalendarCommands(program: Command): void {
  const calendar = program.command("calendar").description("Read connected calendar data")

  calendar
    .command("accounts")
    .description("List calendar accounts")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        assertOnlineCapability(context, "calendar.accounts")
        const fetchedAt = new Date().toISOString()
        const accounts = await requireV2(context).getCalendarAccounts()
        return {
          data: normalizeCalendarAccounts(accounts),
          meta: context.metadata("v2", { fetchedAt }),
        }
      })
    })

  calendar
    .command("subscriptions")
    .description("List calendar subscriptions")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        assertOnlineCapability(context, "calendar.subscriptions")
        const fetchedAt = new Date().toISOString()
        const subscriptions = await requireV2(context).getCalendarSubscriptions()
        return {
          data: normalizeCalendarSubscriptions(subscriptions),
          meta: context.metadata("v2", { fetchedAt }),
        }
      })
    })

  calendar
    .command("events")
    .description("List calendar events")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        const freshness = context.repositories.getFreshness("calendar.events")
        const stale = freshness
          ? isStale(freshness.fetchedAt, context.profile.cacheTtlSeconds)
          : true
        const canUseCache = Boolean(
          freshness && !context.options.fresh && (!stale || context.options.staleOk),
        )
        if (context.options.offline || canUseCache) {
          if (!freshness) {
            throw new AppError("local_state", "Calendar events are not available offline", {
              details: { resource: "calendar.events" },
            })
          }
          if (
            context.cacheIdentity &&
            freshness.accountFingerprint &&
            context.cacheIdentity !== freshness.accountFingerprint
          ) {
            throw new AppError(
              "credential_account_mismatch",
              "Cached calendar data belongs to another account",
            )
          }
          return {
            data: context.repositories
              .listRawResource("events")
              .map((event) => cachedCalendarEvent(event, freshness.fetchedAt)),
            meta: context.metadata("cache", {
              fetchedAt: freshness.fetchedAt,
              stale,
              cacheResource: "calendar.events",
            }),
          }
        }
        assertOnlineCapability(context, "calendar.events")
        const fetchedAt = new Date().toISOString()
        const bundles = await requireV2(context).getCalendarEvents()
        const events = flattenV2CalendarEvents(bundles, {
          fetchedAt,
          defaultTimeZone: context.profile.timeZone,
        })
        const accountErrors = normalizeCalendarErrors(bundles)
        updateCalendarEventCache(context, events, fetchedAt, accountErrors.length === 0)
        return {
          data: events.map(publicEvent),
          meta: context.metadata("v2", {
            fetchedAt,
            cacheResource: "calendar.events",
            cacheUpdate:
              accountErrors.length === 0 ? "authoritative_replace" : "partial_upsert_invalidated",
            ...(accountErrors.length > 0
              ? {
                  warnings: ["Some calendar event identifiers could not be loaded"],
                  accountErrors,
                }
              : {}),
          }),
        }
      })
    })
}

function registerStatsCommand(program: Command): void {
  program
    .command("stats")
    .description("Show account statistics")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        assertOnlineCapability(context, "stats.general")
        const fetchedAt = new Date().toISOString()
        const statistics = await requireV2(context).getGeneralStatistics()
        return {
          data: normalizeGeneralStatistics(statistics),
          meta: context.metadata("v2", { fetchedAt }),
        }
      })
    })
}

function registerTrashCommands(program: Command): void {
  const trash = program.command("trash").description("Inspect or restore trashed tasks")

  trash
    .command("list")
    .description("List trashed tasks")
    .option("--start <number>", "zero-based result offset")
    .option("--limit <number>", `maximum results (1-${MAX_LIST_LIMIT})`)
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        assertOnlineCapability(context, "trash.list")
        const start = integerOption(command.opts().start, "--start", 0, Number.MAX_SAFE_INTEGER, 0)
        const limit = integerOption(
          command.opts().limit,
          "--limit",
          1,
          MAX_LIST_LIMIT,
          DEFAULT_TRASH_LIMIT,
        )
        const fetchedAt = new Date().toISOString()
        const result = await requireV2(context).listTrash({ start, limit })
        return {
          data: normalizeTrashTasks(result.tasks, fetchedAt, context.profile.timeZone),
          meta: context.metadata("v2", {
            fetchedAt,
            pagination: {
              start,
              limit,
              ...(paginationToken(result.next) === undefined
                ? {}
                : { next: paginationToken(result.next) }),
            },
          }),
        }
      })
    })

  addWriteOptions(
    trash
      .command("restore")
      .description("Restore one trashed task")
      .argument("<task>", "exact id, exact title, or unique prefix")
      .option("--to-project <project>", "restore into another project"),
  ).action(async (query: string, _options, command: Command) => {
    await executeCommand(command, async (context) => {
      assertOnlineCapability(context, "trash.restore")
      // Resolving a title or prefix performs a verified trash read before any write.
      context.capability("trash.list")
      const v2 = requireV2(context)
      const tasks = await collectTrashTasks(v2)
      const task = resolveTrashTask(query, tasks)
      const destination = command.opts().toProject
        ? await resolveProject(context, String(command.opts().toProject))
        : undefined
      const request: V2TrashRestoreItem = {
        fromProjectId: task.projectId,
        taskId: task.id,
        toProjectId: destination?.id ?? task.projectId,
      }

      if (command.opts().dryRun) {
        return {
          data: dryRunResult("trash.restore", request),
          meta: context.metadata("local", {
            reconciliation: "readback_required",
          }),
        }
      }

      await v2.restoreTrash([request])
      // The client already confirmed the restore by readback. Conservatively write through the
      // fields whose postcondition is known instead of adding another fallible network request.
      const readback: V2Task = {
        ...task,
        projectId: request.toProjectId,
        deleted: 0,
      }
      const fetchedAt = new Date().toISOString()
      reconcileRestoredTaskCache(context, readback, fetchedAt)
      return {
        data: {
          restored: publicTask(
            mapV2Task(readback, {
              fetchedAt,
              defaultTimeZone: context.profile.timeZone,
            }),
          ),
          fromProjectId: request.fromProjectId,
          toProjectId: request.toProjectId,
        },
        meta: context.metadata("v2", {
          fetchedAt,
          reconciliation: "readback_confirmed",
          cache: "core_invalidated",
        }),
      }
    })
  })
}

function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search locally cached tasks")
    .argument("<text>")
    .option("--limit <number>", `maximum results (1-${MAX_LIST_LIMIT})`)
    .action(async (text: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const query = requiredSearchText(text)
        const limit = integerOption(
          command.opts().limit,
          "--limit",
          1,
          MAX_LIST_LIMIT,
          DEFAULT_SEARCH_LIMIT,
        )
        const state = await ensureCoreState(context)
        const tasks = searchCachedTasks(context.repositories, query, limit)
        const remote = getCapability("v2.search.all")
        return {
          data: {
            query,
            mode: LOCAL_SEARCH_FALLBACK.mode,
            tasks,
          },
          meta: context.metadata("cache", {
            fetchedAt: state.fetchedAt,
            stale: state.stale,
            refreshedFrom: state.source,
            fallback: {
              ...LOCAL_SEARCH_FALLBACK,
              capabilityId: remote?.id,
              verification: remote?.verification ?? "UNVERIFIED",
              stable: remote?.stable ?? false,
            },
          }),
        }
      })
    })
}

export function normalizeCalendarAccounts(
  accounts: readonly V2CalendarAccount[],
): Record<string, unknown>[] {
  return accounts.map((account, index) => {
    const id = nonEmptyString(account.id) ?? nonEmptyString(account.accountId)
    const name = nonEmptyString(account.name)
    if (!id && !name) {
      throw new ProtocolError("Calendar account is missing an id and name", { index })
    }
    return compactRecord({
      id,
      name: name ?? id,
    })
  })
}

/**
 * Subscription responses currently have no verified field schema. Expose only
 * harmless identity/display scalars and never leak private feed URLs or unknown
 * additive fields.
 */
export function normalizeCalendarSubscriptions(
  subscriptions: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return subscriptions.map((subscription, index) => {
    const id = firstString(subscription, ["id", "subscriptionId", "calendarId"])
    const name = firstString(subscription, ["name", "title", "summary"])
    return compactRecord({
      index,
      id,
      accountId: nonEmptyString(subscription.accountId),
      calendarId: nonEmptyString(subscription.calendarId),
      name: name ?? id,
      color: nonEmptyString(subscription.color),
      type: nonEmptyString(subscription.type),
      status: scalar(subscription.status),
      enabled: booleanValue(subscription.enabled),
      readOnly: booleanValue(subscription.readOnly),
    })
  })
}

export function normalizeGeneralStatistics(
  statistics: V2GeneralStatistics,
): Record<string, unknown> {
  const fields = [
    "level",
    "score",
    "todayCompleted",
    "totalCompleted",
    "todayPomoCount",
    "todayPomoDuration",
    "pomoByDay",
    "pomoByWeek",
    "pomoByMonth",
    "taskByDay",
    "taskByWeek",
    "taskByMonth",
  ] as const
  const normalized: Record<string, unknown> = {}
  for (const field of fields) {
    const value = safeJsonValue(statistics[field])
    if (value !== undefined) normalized[field] = value
  }
  return normalized
}

export function normalizeTrashTasks(
  tasks: readonly V2Task[],
  fetchedAt: string,
  defaultTimeZone = "UTC",
): Record<string, unknown>[] {
  return tasks.map((task) => ({
    ...publicTask(mapV2Task(task, { fetchedAt, defaultTimeZone })),
    deleted: true,
  }))
}

export function searchCachedTasks(
  repositories: Pick<Repositories, "searchTasks">,
  text: string,
  limit = DEFAULT_SEARCH_LIMIT,
): Record<string, unknown>[] {
  const query = requiredSearchText(text)
  const boundedLimit = integerOption(limit, "limit", 1, MAX_LIST_LIMIT, DEFAULT_SEARCH_LIMIT)
  return repositories.searchTasks(query, boundedLimit).map(cachedTaskToDomain).map(publicTask)
}

export function resolveTrashTask(query: string, tasks: readonly V2Task[]): V2Task {
  const candidates = tasks.map((task) => ({ id: task.id, name: task.title, task }))
  try {
    return requireResolved(query, candidates).value.task
  } catch (error) {
    if (!(error instanceof ResolutionError)) {
      throw new AppError("internal_error", "Trash task resolution failed unexpectedly", {
        cause: error,
      })
    }
    throw new AppError(error.code === "ambiguous" ? "ambiguous" : "not_found", error.message, {
      details: {
        query: error.query,
        resolutionCode: error.code,
        minimumPrefixLength: error.code === "prefix_too_short" ? 4 : undefined,
        candidates: error.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        })),
      },
    })
  }
}

export async function collectTrashTasks(
  client: Pick<V2Client, "listTrash" | "listTrashPage">,
  maximumPages = 20,
): Promise<V2Task[]> {
  const first = await client.listTrash({ start: 0, limit: MAX_LIST_LIMIT })
  const tasks = new Map(first.tasks.map((task) => [task.id, task]))
  let cursor = paginationToken(first.next)
  const seenCursors = new Set<string>()
  let pages = 1

  while (cursor !== undefined && pages < maximumPages) {
    const key = String(cursor)
    if (seenCursors.has(key)) {
      throw new ProtocolError("Trash pagination repeated a cursor", { cursor: key })
    }
    seenCursors.add(key)
    const page = await client.listTrashPage(key)
    for (const task of page.tasks) tasks.set(task.id, task)
    cursor = paginationToken(page.next)
    pages += 1
  }
  if (cursor !== undefined) {
    throw new AppError("local_state", "Trash listing exceeded the pagination safety limit", {
      details: { maximumPages },
    })
  }
  return [...tasks.values()]
}

export function calendarEventCacheRecords(events: readonly DomainEvent[]): WireRecord[] {
  return events.map((event) => ({
    ...event.raw,
    id: event.id,
    title: event.title,
    startDate: event.startDate,
    isAllDay: event.isAllDay,
    ...(event.accountId ? { accountId: event.accountId } : {}),
    ...(event.calendarId ? { calendarId: event.calendarId } : {}),
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.timeZone ? { timeZone: event.timeZone } : {}),
    ...(event.etag ? { etag: event.etag } : {}),
  }))
}

export function updateCalendarEventCache(
  context: Pick<AppContext, "store" | "repositories"> & {
    cacheIdentity?: string
    profile: Pick<AppContext["profile"], "accountIdentity">
  },
  events: readonly DomainEvent[],
  fetchedAt: string,
  complete: boolean,
): void {
  const records = calendarEventCacheRecords(events)
  context.store.transaction(() => {
    // A response without bundle errors is authoritative for this resource. On a
    // partial response, preserve older rows and explicitly remove freshness.
    if (complete) context.store.db.exec("DELETE FROM events")
    context.repositories.upsertRawResource("events", records, "v2", fetchedAt)
    if (complete) {
      const cacheIdentity = context.cacheIdentity ?? context.profile.accountIdentity
      context.repositories.setFreshness({
        resource: "calendar.events",
        fetchedAt,
        source: "v2",
        ...(cacheIdentity ? { accountFingerprint: cacheIdentity } : {}),
      })
    } else {
      context.repositories.invalidate("calendar.events")
    }
  })
}

export function reconcileRestoredTaskCache(
  context: Pick<AppContext, "store" | "repositories">,
  readback: V2Task,
  fetchedAt: string,
): void {
  context.store.transaction(() => {
    context.repositories.upsertTasks([readback], "v2", fetchedAt)
    // The account-wide snapshot no longer matches the authoritative server state.
    context.repositories.invalidate("core")
  })
}

function normalizeCalendarErrors(
  bundles: readonly V2CalendarEventBundle[],
): Array<{ accountId?: string; eventIds: string[] }> {
  return bundles.flatMap((bundle) => {
    const eventIds = bundle.errorIds ?? []
    if (eventIds.length === 0) return []
    return [
      {
        ...(bundle.accountId ? { accountId: bundle.accountId } : {}),
        eventIds,
      },
    ]
  })
}

function publicTask(task: DomainTask): Record<string, unknown> {
  const { raw: _raw, ...safe } = task
  return safe
}

function publicEvent(event: DomainEvent): Record<string, unknown> {
  const { raw: _raw, ...safe } = event
  return safe
}

function cachedCalendarEvent(
  event: Record<string, unknown>,
  fetchedAt: string,
): Record<string, unknown> {
  if (typeof event.id !== "string" || typeof event.startDate !== "string") {
    throw new ProtocolError("Cached calendar event is missing required fields")
  }
  return compactRecord({
    id: event.id,
    title: typeof event.title === "string" ? event.title : "",
    startDate: event.startDate,
    endDate: typeof event.endDate === "string" ? event.endDate : undefined,
    timeZone: typeof event.timeZone === "string" ? event.timeZone : undefined,
    isAllDay: event.isAllDay === true,
    accountId: typeof event.accountId === "string" ? event.accountId : undefined,
    calendarId: typeof event.calendarId === "string" ? event.calendarId : undefined,
    etag: typeof event.etag === "string" ? event.etag : undefined,
    source: "v2",
    fetchedAt,
  })
}

function assertOnlineCapability(context: AppContext, operation: string): void {
  context.capability(operation)
  if (context.options.offline) {
    throw new AppError("invalid_input", `${operation} cannot run with --offline`)
  }
}

function requireV2(context: AppContext): V2Client {
  if (!context.v2) {
    throw new AppError("authentication_missing", "A v2 session is required")
  }
  return context.v2
}

function integerOption(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined) return fallback
  const parsed = typeof value === "number" ? value : Number(String(value))
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AppError("invalid_input", `${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

function requiredSearchText(value: string): string {
  const normalized = value.normalize("NFKC").trim()
  if (normalized.length === 0) throw new AppError("invalid_input", "Search text is required")
  return normalized
}

function isStale(fetchedAt: string, ttlSeconds: number): boolean {
  const timestamp = Date.parse(fetchedAt)
  return !Number.isFinite(timestamp) || Date.now() - timestamp > ttlSeconds * 1000
}

function paginationToken(value: unknown): string | number | undefined {
  if (typeof value === "string") return value.trim().length > 0 ? value : undefined
  if (typeof value === "number" && Number.isSafeInteger(value)) return value
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of ["cursor", "from", "next", "start"]) {
    const nested = record[key]
    if (typeof nested === "string" && nested.trim().length > 0) return nested
    if (typeof nested === "number" && Number.isSafeInteger(nested)) return nested
  }
  return undefined
}

function safeJsonValue(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value
  }
  if (depth >= 8) return undefined
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const safe = safeJsonValue(item, depth + 1)
      return safe === undefined ? [] : [safe]
    })
  }
  if (!value || typeof value !== "object") return undefined
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/token|cookie|secret|password|authorization|csrf/i.test(key)) continue
    const safe = safeJsonValue(nested, depth + 1)
    if (safe !== undefined) result[key] = safe
  }
  return result
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

function firstString(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const value = nonEmptyString(record[field])
    if (value) return value
  }
  return undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function scalar(value: unknown): string | number | boolean | undefined {
  return typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
    ? value
    : undefined
}
