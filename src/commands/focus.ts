import { Temporal } from "@js-temporal/polyfill"
import type { Command } from "commander"
import { AppError } from "../api/errors"
import type { V1Client } from "../api/v1/client"
import { mapV1Focus } from "../api/v1/mapper"
import { type V1Focus, V1FocusSchema } from "../api/v1/schemas"
import type { V2Client } from "../api/v2/client"
import type { AppContext } from "../app/context"
import { resolveTask } from "../app/state"
import {
  getDayBounds,
  normalizeDateTime,
  normalizeWireOffset,
  profileDate,
  resolveDateExpression,
} from "../core/dates"
import type { FocusInput } from "../domain/inputs"
import type { DomainFocus, FocusType } from "../domain/models"
import { dryRunResult, parseDuration, requireConfirmation } from "./common"
import { addDateRangeOptions, addWriteOptions, executeCommand } from "./runtime"

const MAX_FOCUS_RANGE_SECONDS = 30 * 24 * 60 * 60
const DEFAULT_FOCUS_RANGE_DAYS = 30

export interface FocusRangeChunk {
  from: string
  to: string
}

export interface FocusListRange {
  from: string
  to: string
  chunks: readonly FocusRangeChunk[]
}

export interface FocusDateRange {
  from: string
  to: string
  toInclusive: string
}

export function registerFocusCommands(program: Command): void {
  const focus = program.command("focus").description("Manage focus records")

  addDateRangeOptions(
    focus
      .command("list")
      .description("List focus records")
      .option("--type <type>", "pomodoro or timing"),
  ).action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      const options = command.opts()
      const selectedType = options.type === undefined ? undefined : parseFocusType(options.type)
      const range = resolveFocusListRange(options, context.profile.timeZone)
      const types: FocusType[] = selectedType ? [selectedType] : ["pomodoro", "timing"]
      const resource = focusResource(types, range)
      const freshness = context.repositories.getFreshness(resource)
      const stale = freshness ? isStale(freshness.fetchedAt, context.profile.cacheTtlSeconds) : true
      const canUseCache = Boolean(
        freshness && !context.options.fresh && (!stale || context.options.staleOk),
      )
      if (context.options.offline || canUseCache) {
        if (!freshness) {
          throw new AppError("local_state", "Focus records are not available offline", {
            details: { resource: "focus.records", range: { from: range.from, to: range.to } },
          })
        }
        assertFocusCacheAccount(context, freshness.accountFingerprint)
        const from = Temporal.Instant.from(range.from)
        const to = Temporal.Instant.from(range.to)
        const normalized = context.repositories
          .listRawResource("focus_records")
          .map((record) => V1FocusSchema.parse(record))
          .map((record) =>
            mapV1Focus(record, {
              defaultTimeZone: context.profile.timeZone,
              fetchedAt: freshness.fetchedAt,
            }),
          )
          .filter(
            (record) =>
              types.includes(record.type) &&
              Temporal.Instant.compare(Temporal.Instant.from(record.startTime), from) >= 0 &&
              Temporal.Instant.compare(Temporal.Instant.from(record.startTime), to) < 0,
          )
        return {
          data: sortFocus(deduplicateFocus(normalized)).map(publicFocus),
          meta: context.metadata("cache", {
            fetchedAt: freshness.fetchedAt,
            stale,
            range: { from: range.from, to: range.to },
            chunks: range.chunks.length,
          }),
        }
      }

      context.capability("focus.list")
      const v1 = requireV1Read(context)
      const records: V1Focus[] = []
      for (const chunk of range.chunks) {
        for (const type of types) {
          records.push(...(await v1.listFocus(chunk.from, chunk.to, focusTypeCode(type))))
        }
      }

      const fetchedAt = new Date().toISOString()
      const normalized = deduplicateFocus(
        records.map((record) =>
          mapV1Focus(record, {
            defaultTimeZone: context.profile.timeZone,
            fetchedAt,
          }),
        ),
      )
      cacheFocusRecords(context, records, fetchedAt, resource)
      return {
        data: sortFocus(normalized).map(publicFocus),
        meta: context.metadata("v1", {
          fetchedAt,
          range: { from: range.from, to: range.to },
          chunks: range.chunks.length,
        }),
      }
    })
  })

  addWriteOptions(
    focus
      .command("log")
      .description("Log focus time")
      .requiredOption("--duration <duration>", "duration such as 25m or 1h")
      .option("--task <id-or-name>", "related task")
      .option("--note <text>", "focus note")
      .option("--type <type>", "pomodoro or timing", "pomodoro")
      .option("--start <date-time>", "focus start time"),
  ).action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("focus.log")
      const options = command.opts()
      const durationSeconds = parseDuration(nonEmptyString(options.duration, "Focus duration"))
      const type = parseFocusType(options.type)
      const now = Temporal.Now.instant().round({
        smallestUnit: "second",
        roundingMode: "floor",
      })
      const start =
        options.start === undefined
          ? now.subtract({ seconds: durationSeconds })
          : focusBoundaryInstant(
              nonEmptyString(options.start, "Focus start"),
              context.profile.timeZone,
              "--start",
            )
      const end = options.start === undefined ? now : start.add({ seconds: durationSeconds })
      const task =
        options.task === undefined
          ? undefined
          : await resolveTask(context, nonEmptyString(options.task, "Task"))
      const note =
        options.note === undefined
          ? undefined
          : focusNote(nonEmptyString(options.note, "Focus note"))
      const input: FocusInput = {
        type,
        startTime: formatV1FocusDateTime(start, context.profile.timeZone),
        endTime: formatV1FocusDateTime(end, context.profile.timeZone),
        durationSeconds,
        ...(task ? { taskId: task.id } : {}),
        ...(note ? { note } : {}),
      }
      if (options.dryRun) {
        return {
          data: dryRunResult("focus.log", input),
          meta: context.metadata("local"),
        }
      }

      const response = await requireV1Mutation(context).createFocus(input)
      const fetchedAt = new Date().toISOString()
      const result = mapV1Focus(response, {
        defaultTimeZone: context.profile.timeZone,
        fetchedAt,
      })
      cacheFocusRecords(context, [response], fetchedAt)
      return {
        data: publicFocus(result),
        meta: context.metadata("v1", { fetchedAt }),
      }
    })
  })

  addWriteOptions(
    focus
      .command("delete")
      .description("Delete a focus record")
      .argument("<focus-id>")
      .requiredOption("--type <type>", "pomodoro or timing"),
  ).action(async (focusId: string, _options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("focus.delete")
      const id = nonEmptyString(focusId, "Focus id")
      const type = parseFocusType(command.opts().type)
      const request = { focusId: id, type }
      if (command.opts().dryRun) {
        return {
          data: dryRunResult("focus.delete", request),
          meta: context.metadata("local"),
        }
      }
      requireConfirmation(command.opts(), "delete the focus record")
      const response = await requireV1Mutation(context).deleteFocus(id, focusTypeCode(type))
      const result = mapV1Focus(response, {
        defaultTimeZone: context.profile.timeZone,
      })
      context.repositories.invalidate("focus_records")
      return {
        data: { deleted: result.id, record: publicFocus(result) },
        meta: context.metadata("v1"),
      }
    })
  })

  addDateRangeOptions(focus.command("stats").description("Show focus statistics")).action(
    async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("focus.stats")
        const range = resolveFocusDateRange(command.opts(), context.profile.timeZone)
        const result = await requireV2Read(context).getFocusDistribution(
          range.from,
          range.toInclusive,
        )
        const tagDurations = Object.fromEntries(
          Object.entries(result.tagDurations ?? {}).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
        return {
          data: {
            range: { from: range.from, to: range.to },
            tagDurations,
          },
          meta: context.metadata("v2", { fetchedAt: new Date().toISOString() }),
        }
      })
    },
  )

  addDateRangeOptions(focus.command("heatmap").description("Show a focus heatmap")).action(
    async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("focus.heatmap")
        const range = resolveFocusDateRange(command.opts(), context.profile.timeZone)
        const entries = await requireV2Read(context).getFocusHeatmap(range.from, range.toInclusive)
        return {
          data: {
            range: { from: range.from, to: range.to },
            entries: entries.map(safeUnknown),
          },
          meta: context.metadata("v2", { fetchedAt: new Date().toISOString() }),
        }
      })
    },
  )
}

/**
 * Split an exact focus interval into contiguous requests no longer than the
 * documented v1 30-day maximum. Returned values use TickTick's basic offset.
 */
export function chunkFocusRange(
  from: string,
  to: string,
  timeZone: string,
): readonly FocusRangeChunk[] {
  const start = focusBoundaryInstant(from, timeZone, "--from")
  const end = focusBoundaryInstant(to, timeZone, "--to")
  return chunkFocusInstants(start, end, timeZone)
}

export function resolveFocusListRange(
  options: { from?: unknown; to?: unknown },
  timeZone: string,
  now?: string,
): FocusListRange {
  const end =
    options.to === undefined
      ? currentInstant(now)
      : focusBoundaryInstant(nonEmptyString(options.to, "--to"), timeZone, "--to", now)
  const start =
    options.from === undefined
      ? end.subtract({ seconds: MAX_FOCUS_RANGE_SECONDS })
      : focusBoundaryInstant(nonEmptyString(options.from, "--from"), timeZone, "--from", now)
  return {
    from: start.toString(),
    to: end.toString(),
    chunks: chunkFocusInstants(start, end, timeZone),
  }
}

export function resolveFocusDateRange(
  options: { from?: unknown; to?: unknown },
  timeZone: string,
  now?: string,
): FocusDateRange {
  const today = profileDate(timeZone, now)
  const to =
    options.to === undefined
      ? today.add({ days: 1 })
      : focusCalendarDate(options.to, "--to", timeZone, now)
  const from =
    options.from === undefined
      ? to.subtract({ days: DEFAULT_FOCUS_RANGE_DAYS })
      : focusCalendarDate(options.from, "--from", timeZone, now)
  if (Temporal.PlainDate.compare(from, to) >= 0) {
    throw new AppError("invalid_input", "--from must be earlier than --to")
  }
  return {
    from: from.toString(),
    to: to.toString(),
    toInclusive: to.subtract({ days: 1 }).toString(),
  }
}

export function parseFocusType(value: unknown): FocusType {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AppError("invalid_input", "Focus type must be pomodoro or timing")
  }
  const normalized = String(value).trim().toLowerCase()
  if (["pomodoro", "pomo", "0"].includes(normalized)) return "pomodoro"
  if (["timing", "timer", "stopwatch", "1"].includes(normalized)) return "timing"
  throw new AppError("invalid_input", `Invalid focus type: ${value}`, {
    details: { accepted: ["pomodoro", "timing"] },
  })
}

function chunkFocusInstants(
  start: Temporal.Instant,
  end: Temporal.Instant,
  timeZone: string,
): FocusRangeChunk[] {
  if (Temporal.Instant.compare(start, end) >= 0) {
    throw new AppError("invalid_input", "--from must be earlier than --to")
  }
  const chunks: FocusRangeChunk[] = []
  let cursor = start
  while (Temporal.Instant.compare(cursor, end) < 0) {
    const maximum = cursor.add({ seconds: MAX_FOCUS_RANGE_SECONDS })
    const next = Temporal.Instant.compare(maximum, end) < 0 ? maximum : end
    chunks.push({
      from: formatV1FocusDateTime(cursor, timeZone),
      to: formatV1FocusDateTime(next, timeZone),
    })
    cursor = next
  }
  return chunks
}

function focusBoundaryInstant(
  value: string,
  timeZone: string,
  label: string,
  now?: string,
): Temporal.Instant {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^(today|tomorrow|eom)$/i.test(value)) {
      const date = resolveDateExpression(value, timeZone, now)
      return Temporal.Instant.from(getDayBounds(date, timeZone).start)
    }
    const normalized = normalizeDateTime(value, { timeZone })
    if (!normalized.instant) throw new Error("Date-time has no instant")
    return Temporal.Instant.from(normalized.instant).round({
      smallestUnit: "second",
      roundingMode: "floor",
    })
  } catch (cause) {
    throw new AppError("invalid_input", `Invalid ${label} date or date-time: ${value}`, { cause })
  }
}

function currentInstant(now?: string): Temporal.Instant {
  try {
    const instant =
      now === undefined ? Temporal.Now.instant() : Temporal.Instant.from(normalizeWireOffset(now))
    return instant.round({ smallestUnit: "second", roundingMode: "floor" })
  } catch (cause) {
    throw new AppError("invalid_input", `Invalid current time: ${now ?? ""}`, { cause })
  }
}

function formatV1FocusDateTime(instant: Temporal.Instant, timeZone: string): string {
  const value = instant.toZonedDateTimeISO(timeZone)
  const date = value.toPlainDate().toString()
  const time = [value.hour, value.minute, value.second].map(pad).join(":")
  return `${date}T${time}${value.offset.replaceAll(":", "")}`
}

function focusCalendarDate(
  value: unknown,
  label: string,
  timeZone: string,
  now?: string,
): Temporal.PlainDate {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("invalid_input", `${label} requires a calendar date`)
  }
  try {
    return resolveDateExpression(value, timeZone, now)
  } catch (cause) {
    throw new AppError("invalid_input", `Invalid ${label} date: ${value}`, { cause })
  }
}

function deduplicateFocus(records: readonly DomainFocus[]): DomainFocus[] {
  const values = new Map<string, DomainFocus>()
  for (const record of records) values.set(`${record.type}:${record.id}`, record)
  return [...values.values()]
}

function sortFocus(records: readonly DomainFocus[]): DomainFocus[] {
  return [...records].sort(
    (left, right) =>
      right.startTime.localeCompare(left.startTime) ||
      left.type.localeCompare(right.type) ||
      left.id.localeCompare(right.id),
  )
}

function cacheFocusRecords(
  context: AppContext,
  records: readonly V1Focus[],
  fetchedAt: string,
  authoritativeResource?: string,
): void {
  const unique = new Map(records.map((record) => [`${record.type}:${record.id}`, record]))
  context.store.transaction(() => {
    context.repositories.upsertRawResource(
      "focus_records",
      [...unique.values()].map((record) => ({ ...record })),
      "v1",
      fetchedAt,
    )
    if (authoritativeResource) {
      context.repositories.setFreshness({
        resource: authoritativeResource,
        source: "v1",
        fetchedAt,
        ...(context.cacheIdentity ? { accountFingerprint: context.cacheIdentity } : {}),
      })
    }
  })
}

function focusResource(types: readonly FocusType[], range: FocusListRange): string {
  return `focus.records:${[...types].sort().join(",")}:${range.from}:${range.to}`
}

function assertFocusCacheAccount(context: AppContext, cacheIdentity: string | undefined): void {
  const expected = context.cacheIdentity
  if (expected && cacheIdentity && expected !== cacheIdentity) {
    throw new AppError("credential_account_mismatch", "Cached data belongs to another account", {
      details: { resource: "focus.records" },
    })
  }
}

function isStale(fetchedAt: string, ttlSeconds: number): boolean {
  const time = Date.parse(fetchedAt)
  return !Number.isFinite(time) || Date.now() - time > ttlSeconds * 1000
}

function focusTypeCode(type: FocusType): 0 | 1 {
  return type === "pomodoro" ? 0 : 1
}

function publicFocus(focus: DomainFocus): Record<string, unknown> {
  const { raw: _raw, ...safe } = focus
  return safe
}

function safeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeUnknown)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^(?:raw|authorization|cookie|token|secret)$/i.test(key))
      .map(([key, child]) => [key, safeUnknown(child)]),
  )
}

function focusNote(value: string): string {
  if (value.length > 5_000) {
    throw new AppError("invalid_input", "Focus note must not exceed 5000 characters")
  }
  return value
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("invalid_input", `${label} is required`)
  }
  return value.trim()
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function requireV1Read(context: AppContext): V1Client {
  if (context.options.offline) throw new AppError("invalid_input", "Network access is disabled")
  if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
  return context.v1
}

function requireV1Mutation(context: AppContext): V1Client {
  if (context.options.offline) throw new AppError("invalid_input", "Mutations are online-only")
  if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
  return context.v1
}

function requireV2Read(context: AppContext): V2Client {
  if (context.options.offline) throw new AppError("invalid_input", "Network access is disabled")
  if (!context.v2) throw new AppError("authentication_missing", "A v2 session is required")
  return context.v2
}
