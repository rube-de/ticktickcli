import { Temporal } from "@js-temporal/polyfill"
import type { Command } from "commander"
import { AppError, PartialFailureError, reconcileAfterWrite } from "../api/errors"
import type { V1Client } from "../api/v1/client"
import { mapV1Habit, mapV1HabitCheckins } from "../api/v1/mapper"
import { type V1Habit, type V1HabitCheckinAggregate, V1HabitSchema } from "../api/v1/schemas"
import type { AppContext } from "../app/context"
import { profileDate, resolveDateExpression } from "../core/dates"
import { parseRecurrenceExpression } from "../core/recur"
import { ResolutionError, requireResolved } from "../core/resolve"
import type { HabitInput } from "../domain/inputs"
import type { DomainCheckin, DomainHabit } from "../domain/models"
import { dryRunResult, splitCommaValues } from "./common"
import { addDateRangeOptions, addWriteOptions, executeCommand } from "./runtime"

const DEFAULT_HABIT_RANGE_DAYS = 30

export interface HabitDateRange {
  from: string
  to: string
  fromStamp: number
  toInclusiveStamp: number
}

interface HabitState {
  habits: readonly DomainHabit[]
  source: "v1" | "cache"
  fetchedAt: string
  stale: boolean
}

interface CheckinState {
  checkins: readonly DomainCheckin[]
  source: "v1" | "cache"
  fetchedAt: string
  stale: boolean
}

export function registerHabitCommands(program: Command): void {
  const habit = program.command("habit").description("Manage habits and check-ins")

  habit
    .command("list")
    .description("List habits")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        const state = await loadHabits(context)
        return {
          data: sortHabits(state.habits).map(publicHabit),
          meta: context.metadata(state.source, {
            fetchedAt: state.fetchedAt,
            stale: state.stale,
          }),
        }
      })
    })

  habit
    .command("show")
    .description("Show a habit")
    .argument("<id-or-name>")
    .action(async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const state = await loadHabits(context)
        const resolved = resolveHabit(query, state.habits)
        return {
          data: publicHabit(resolved),
          meta: context.metadata(state.source, {
            fetchedAt: state.fetchedAt,
            stale: state.stale,
          }),
        }
      })
    })

  addWriteOptions(
    habit
      .command("checkin")
      .description("Check in one or more habits")
      .argument("<habit...>")
      .option("--date <date>", "calendar date in the profile timezone", "today")
      .option("--value <number>", "check-in value", Number, 1),
  ).action(async (queries: string[], _options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("habit.checkin")
      const state = await loadHabits(context)
      const habits = resolveHabits(queries, state.habits)
      const date = habitDate(String(command.opts().date), context.profile.timeZone)
      const value = finiteNumber(command.opts().value, "Check-in value", { minimum: 0 })
      const request = habits.map((habit) => ({
        habitId: habit.id,
        stamp: dateStamp(date),
        date,
        value,
        status: 2,
      }))
      if (command.opts().dryRun) {
        return {
          data: dryRunResult("habit.checkin", request),
          meta: context.metadata("local"),
        }
      }

      const v1 = requireV1Mutation(context)
      const successes: string[] = []
      const checkins: DomainCheckin[] = []
      const failures: Array<{ id: string; code: string; message: string }> = []
      for (const item of request) {
        try {
          const checkin = await writeHabitCheckin(context, v1, item)
          successes.push(item.habitId)
          checkins.push(checkin)
        } catch (error) {
          if (
            request.length === 1 &&
            error instanceof AppError &&
            error.code === "write_outcome_unknown"
          ) {
            throw error
          }
          failures.push(failureFor(item.habitId, error))
        }
      }
      cacheCheckins(context, checkins)
      if (failures.length > 0) {
        throw new PartialFailureError("Some habits could not be checked in", failures, successes)
      }
      return {
        data: checkins.map(publicCheckin),
        meta: context.metadata("v1", { fetchedAt: new Date().toISOString() }),
      }
    })
  })

  addDateRangeOptions(
    habit.command("log").description("List habit check-ins").argument("[habit...]"),
  ).action(async (queries: string[], _options, command: Command) => {
    await executeCommand(command, async (context) => {
      const state = await loadHabits(context)
      const habits = selectHabits(queries, state.habits)
      const range = resolveHabitDateRange(command.opts(), context.profile.timeZone)
      const checkinState = await fetchHabitCheckins(context, habits, range)
      return {
        data: sortCheckins(checkinState.checkins).map(publicCheckin),
        meta: context.metadata(checkinState.source, {
          fetchedAt: checkinState.fetchedAt,
          stale: checkinState.stale,
          range: { from: range.from, to: range.to },
        }),
      }
    })
  })

  addWriteOptions(addHabitOptions(habit.command("add").description("Create a habit"), true)).action(
    async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("habit.add")
        const input = habitCreateInput(command.opts(), context.profile.timeZone)
        if (command.opts().dryRun) {
          return {
            data: dryRunResult("habit.add", input),
            meta: context.metadata("local"),
          }
        }

        const v1 = requireV1Mutation(context)
        const beforeRecords = await v1.listHabits()
        const before = new Set(beforeRecords.map(({ id }) => id))
        const response = await v1.createHabit(input)
        const reconciled = response
          ? {
              wire: response,
              records: [...beforeRecords.filter(({ id }) => id !== response.id), response],
            }
          : await reconcileCreatedHabit(v1, input.name, before)
        const { wire, records } = reconciled
        const fetchedAt = new Date().toISOString()
        cacheHabits(context, records, fetchedAt)
        const result = mapV1Habit(wire, {
          defaultTimeZone: context.profile.timeZone,
          fetchedAt,
        })
        return {
          data: publicHabit(result),
          meta: context.metadata("v1", { fetchedAt }),
        }
      })
    },
  )

  addWriteOptions(
    addHabitOptions(
      habit.command("edit").description("Edit a habit").argument("<id-or-name>"),
      false,
    ),
  ).action(async (query: string, _options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("habit.edit")
      const state = await loadHabits(context)
      const habit = resolveHabit(query, state.habits)
      const patch = habitPatch(command.opts(), context.profile.timeZone)
      if (Object.keys(patch).length === 0) {
        throw new AppError("invalid_input", "At least one habit edit option is required")
      }
      if (command.opts().dryRun) {
        return {
          data: dryRunResult("habit.edit", { id: habit.id, patch }),
          meta: context.metadata("local"),
        }
      }

      const v1 = requireV1Mutation(context)
      const response = await v1.updateHabit(habit.id, patch)
      const wire =
        response ??
        (await reconcileAfterWrite("habit.edit", { habitId: habit.id }, () =>
          v1.getHabit(habit.id),
        ))
      const fetchedAt = new Date().toISOString()
      cacheHabits(context, [wire], fetchedAt, false)
      const result = mapV1Habit(wire, {
        defaultTimeZone: context.profile.timeZone,
        fetchedAt,
      })
      return {
        data: publicHabit(result),
        meta: context.metadata("v1", { fetchedAt }),
      }
    })
  })

  addDateRangeOptions(
    habit.command("stats").description("Show habit statistics").argument("[habit...]"),
  ).action(async (queries: string[], _options, command: Command) => {
    await executeCommand(command, async (context) => {
      const state = await loadHabits(context)
      const habits = selectHabits(queries, state.habits)
      const range = resolveHabitDateRange(command.opts(), context.profile.timeZone)
      const checkinState = await fetchHabitCheckins(context, habits, range)
      return {
        data: summarizeHabitStats(habits, checkinState.checkins, range),
        meta: context.metadata(checkinState.source, {
          fetchedAt: checkinState.fetchedAt,
          stale: checkinState.stale,
          range: { from: range.from, to: range.to },
        }),
      }
    })
  })
}

export function resolveHabitDateRange(
  options: { from?: unknown; to?: unknown },
  timeZone: string,
  now?: string,
): HabitDateRange {
  const today = profileDate(timeZone, now)
  const to =
    options.to === undefined
      ? today.add({ days: 1 })
      : parseHabitDateOption(options.to, "--to", timeZone, now)
  const from =
    options.from === undefined
      ? to.subtract({ days: DEFAULT_HABIT_RANGE_DAYS })
      : parseHabitDateOption(options.from, "--from", timeZone, now)
  if (Temporal.PlainDate.compare(from, to) >= 0) {
    throw new AppError("invalid_input", "--from must be earlier than --to")
  }
  return {
    from: from.toString(),
    to: to.toString(),
    fromStamp: dateStamp(from.toString()),
    toInclusiveStamp: dateStamp(to.subtract({ days: 1 }).toString()),
  }
}

export function summarizeHabitStats(
  habits: readonly DomainHabit[],
  checkins: readonly DomainCheckin[],
  range: Pick<HabitDateRange, "from" | "to">,
): Record<string, unknown>[] {
  const byHabit = new Map<string, DomainCheckin[]>()
  for (const checkin of checkins) {
    const values = byHabit.get(checkin.habitId) ?? []
    values.push(checkin)
    byHabit.set(checkin.habitId, values)
  }
  return sortHabits(habits).map((habit) => {
    const values = byHabit.get(habit.id) ?? []
    return {
      id: habit.id,
      name: habit.name,
      status: habit.status,
      range: { from: range.from, to: range.to },
      lifetime: {
        totalCheckIns: habit.totalCheckIns ?? null,
        currentStreak: habit.currentStreak ?? null,
        completedCycles: habit.completedCycles ?? null,
      },
      period: {
        checkIns: values.length,
        completed: values.filter(({ status }) => status === "completed").length,
        value: values.reduce((total, { value }) => total + value, 0),
      },
    }
  })
}

async function loadHabits(context: AppContext): Promise<HabitState> {
  const freshness = context.repositories.getFreshness("habits")
  assertCacheAccount(context, freshness?.accountFingerprint)
  const stale = freshness ? isStale(freshness.fetchedAt, context.profile.cacheTtlSeconds) : true
  const canUseCache = Boolean(
    freshness && !context.options.fresh && (!stale || context.options.staleOk),
  )

  if (context.options.offline || canUseCache) {
    if (!freshness) {
      throw new AppError("local_state", "Habit data is not available offline", {
        details: { resource: "habits" },
      })
    }
    const habits = context.repositories
      .listRawResource("habits")
      .map((record) => V1HabitSchema.parse(record))
      .map((record) =>
        mapV1Habit(record, {
          defaultTimeZone: context.profile.timeZone,
          fetchedAt: freshness.fetchedAt,
        }),
      )
    return { habits, source: "cache", fetchedAt: freshness.fetchedAt, stale }
  }

  const v1 = requireV1Read(context)
  context.capability("habit.list")
  const records = await v1.listHabits()
  const fetchedAt = new Date().toISOString()
  cacheHabits(context, records, fetchedAt)
  return {
    habits: records.map((record) =>
      mapV1Habit(record, {
        defaultTimeZone: context.profile.timeZone,
        fetchedAt,
      }),
    ),
    source: "v1",
    fetchedAt,
    stale: false,
  }
}

function cacheHabits(
  context: AppContext,
  records: readonly V1Habit[],
  fetchedAt: string,
  authoritative = true,
): void {
  context.store.transaction(() => {
    context.repositories.upsertHabits(
      records.map((record) => ({ ...record })),
      "v1",
      fetchedAt,
    )
    if (authoritative) {
      context.repositories.reconcileResource("habits", new Set(records.map(({ id }) => id)))
      context.repositories.setFreshness({
        resource: "habits",
        source: "v1",
        fetchedAt,
        ...(context.cacheIdentity ? { accountFingerprint: context.cacheIdentity } : {}),
      })
    }
  })
}

async function fetchHabitCheckins(
  context: AppContext,
  habits: readonly DomainHabit[],
  range: HabitDateRange,
): Promise<CheckinState> {
  const resource = checkinResource(habits, range)
  const freshness = context.repositories.getFreshness(resource)
  assertCacheAccount(context, freshness?.accountFingerprint)
  const stale = freshness ? isStale(freshness.fetchedAt, context.profile.cacheTtlSeconds) : true
  const canUseCache = Boolean(
    freshness && !context.options.fresh && (!stale || context.options.staleOk),
  )
  if (context.options.offline || canUseCache) {
    if (!freshness) {
      throw new AppError("local_state", "Habit check-in data is not available offline", {
        details: { resource: "habit.checkins", range: { from: range.from, to: range.to } },
      })
    }
    const habitIds = new Set(habits.map(({ id }) => id))
    const checkins = context.repositories
      .listRawResource("checkins")
      .flatMap((record) => cachedCheckin(record, freshness.fetchedAt))
      .filter(({ habitId, date }) => habitIds.has(habitId) && date >= range.from && date < range.to)
    return { checkins, source: "cache", fetchedAt: freshness.fetchedAt, stale }
  }
  if (habits.length === 0) {
    const fetchedAt = new Date().toISOString()
    cacheCheckins(context, [], fetchedAt, resource)
    return { checkins: [], source: "v1", fetchedAt, stale: false }
  }
  context.capability("habit.log")
  const records = await requireV1Read(context).habitCheckins(
    habits.map(({ id }) => id),
    range.fromStamp,
    range.toInclusiveStamp,
  )
  const fetchedAt = new Date().toISOString()
  const checkins = records
    .flatMap((record) =>
      mapV1HabitCheckins(record, {
        defaultTimeZone: context.profile.timeZone,
        fetchedAt,
      }),
    )
    .filter(({ date }) => date >= range.from && date < range.to)
  cacheCheckins(context, checkins, fetchedAt, resource)
  return { checkins, source: "v1", fetchedAt, stale: false }
}

async function writeHabitCheckin(
  context: AppContext,
  v1: V1Client,
  request: { habitId: string; stamp: number; date: string; value: number; status: number },
): Promise<DomainCheckin> {
  const response = await v1.checkinHabit(request.habitId, {
    stamp: request.stamp,
    value: request.value,
    status: request.status,
  })
  let aggregates: readonly V1HabitCheckinAggregate[] = response ? [response] : []
  let matches = matchingCheckins(context, aggregates, request.habitId, request.date)
  if (matches.length === 0) {
    aggregates = await reconcileAfterWrite(
      "habit.checkin",
      { habitId: request.habitId, date: request.date },
      () => v1.habitCheckins([request.habitId], request.stamp, request.stamp),
    )
    matches = matchingCheckins(context, aggregates, request.habitId, request.date)
  }
  const result = sortCheckins(matches)[0]
  if (!result) {
    throw new AppError(
      "write_outcome_unknown",
      "Habit check-in succeeded but could not be confirmed by readback",
      { details: { habitId: request.habitId, date: request.date } },
    )
  }
  return result
}

function matchingCheckins(
  context: AppContext,
  records: readonly V1HabitCheckinAggregate[],
  habitId: string,
  date: string,
): DomainCheckin[] {
  const fetchedAt = new Date().toISOString()
  return records
    .flatMap((record) =>
      mapV1HabitCheckins(record, {
        defaultTimeZone: context.profile.timeZone,
        fetchedAt,
      }),
    )
    .filter((checkin) => checkin.habitId === habitId && checkin.date === date)
}

function cacheCheckins(
  context: AppContext,
  checkins: readonly DomainCheckin[],
  fetchedAt = new Date().toISOString(),
  authoritativeResource?: string,
): void {
  context.store.transaction(() => {
    context.repositories.upsertRawResource(
      "checkins",
      checkins.map((checkin) => ({
        id: checkin.id,
        habitId: checkin.habitId,
        checkinDate: checkin.date,
        value: checkin.value,
        status: checkin.status === "completed" ? 2 : checkin.status === "in_progress" ? 0 : null,
        ...(checkin.etag === undefined ? {} : { etag: checkin.etag }),
      })),
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

function checkinResource(habits: readonly DomainHabit[], range: HabitDateRange): string {
  return `habit.checkins:${habits
    .map(({ id }) => id)
    .sort()
    .join(",")}:${range.from}:${range.to}`
}

function cachedCheckin(record: Record<string, unknown>, fetchedAt: string): DomainCheckin[] {
  if (
    typeof record.id !== "string" ||
    typeof record.habitId !== "string" ||
    typeof record.checkinDate !== "string"
  ) {
    return []
  }
  const status = record.status === 2 ? "completed" : record.status === 0 ? "in_progress" : "unknown"
  return [
    {
      id: record.id,
      habitId: record.habitId,
      date: record.checkinDate,
      value: typeof record.value === "number" ? record.value : 0,
      status,
      source: "v1",
      fetchedAt,
      raw: record,
      ...(typeof record.etag === "string" ? { etag: record.etag } : {}),
    },
  ]
}

async function reconcileCreatedHabit(
  v1: V1Client,
  name: string,
  before: ReadonlySet<string>,
): Promise<{ wire: V1Habit; records: V1Habit[] }> {
  const records = await reconcileAfterWrite("habit.add", { name }, () => v1.listHabits())
  const candidates = records.filter((record) => !before.has(record.id) && record.name === name)
  if (candidates.length !== 1) {
    throw new AppError("write_outcome_unknown", "Habit creation readback was ambiguous", {
      details: { candidateIds: candidates.map(({ id }) => id) },
    })
  }
  return { wire: candidates[0] as V1Habit, records }
}

function addHabitOptions(command: Command, nameRequired: boolean): Command {
  const target = nameRequired
    ? command.requiredOption("--name <name>", "habit name")
    : command.option("--name <name>", "habit name")
  return target
    .option("--icon <icon>", "icon resource")
    .option("--color <color>", "habit color")
    .option("--encouragement <text>", "encouragement text")
    .option("--type <type>", "habit type")
    .option("--goal <number>", "goal value", Number)
    .option("--step <number>", "increment value", Number)
    .option("--unit <unit>", "goal unit")
    .option("--repeat <expression>", "RRULE or supported recurrence expression")
    .option("--reminders <values>", "comma-separated reminders")
    .option("--excluded-dates <dates>", "comma-separated calendar dates")
    .option("--sort-order <number>", "sort order", Number)
    .option("--section <id>", "section id")
    .option("--target-days <number>", "target day count", Number)
    .option("--target-start-date <date>", "target start date")
    .option("--record-enabled <boolean>", "whether detailed records are enabled")
}

function habitCreateInput(options: Record<string, unknown>, timeZone: string): HabitInput {
  const name = nonEmptyString(options.name, "Habit name")
  return { name, ...habitPatch({ ...options, name: undefined }, timeZone) }
}

function habitPatch(options: Record<string, unknown>, timeZone: string): Partial<HabitInput> {
  return {
    ...(options.name === undefined ? {} : { name: nonEmptyString(options.name, "Habit name") }),
    ...(options.icon === undefined ? {} : { icon: nonEmptyString(options.icon, "Habit icon") }),
    ...(options.color === undefined ? {} : { color: nonEmptyString(options.color, "Habit color") }),
    ...(options.encouragement === undefined
      ? {}
      : { encouragement: nonEmptyString(options.encouragement, "Habit encouragement") }),
    ...(options.type === undefined ? {} : { type: nonEmptyString(options.type, "Habit type") }),
    ...(options.goal === undefined
      ? {}
      : { goal: finiteNumber(options.goal, "Habit goal", { exclusiveMinimum: 0 }) }),
    ...(options.step === undefined
      ? {}
      : { step: finiteNumber(options.step, "Habit step", { exclusiveMinimum: 0 }) }),
    ...(options.unit === undefined ? {} : { unit: nonEmptyString(options.unit, "Habit unit") }),
    ...(options.repeat === undefined
      ? {}
      : {
          repeatRule: parseRecurrenceExpression(nonEmptyString(options.repeat, "Habit recurrence"))
            .rule,
        }),
    ...(options.reminders === undefined
      ? {}
      : { reminders: splitCommaValues(options.reminders as string) }),
    ...(options.excludedDates === undefined
      ? {}
      : {
          excludedDates: splitCommaValues(options.excludedDates as string).map((date) =>
            habitDate(date, timeZone),
          ),
        }),
    ...(options.sortOrder === undefined
      ? {}
      : { sortOrder: finiteNumber(options.sortOrder, "Sort order") }),
    ...(options.section === undefined
      ? {}
      : { sectionId: nonEmptyString(options.section, "Habit section") }),
    ...(options.targetDays === undefined
      ? {}
      : {
          targetDays: finiteNumber(options.targetDays, "Target days", {
            exclusiveMinimum: 0,
            integer: true,
          }),
        }),
    ...(options.targetStartDate === undefined
      ? {}
      : {
          targetStartDate: habitDate(
            nonEmptyString(options.targetStartDate, "Target start date"),
            timeZone,
          ),
        }),
    ...(options.recordEnabled === undefined
      ? {}
      : { recordEnabled: booleanValue(options.recordEnabled, "--record-enabled") }),
  }
}

function selectHabits(
  queries: readonly string[] | undefined,
  habits: readonly DomainHabit[],
): DomainHabit[] {
  return queries && queries.length > 0 ? resolveHabits(queries, habits) : sortHabits(habits)
}

function resolveHabits(
  queries: readonly string[] | undefined,
  habits: readonly DomainHabit[],
): DomainHabit[] {
  const resolved = (queries ?? []).map((query) => resolveHabit(query, habits))
  const seen = new Set<string>()
  return resolved.filter((habit) => {
    if (seen.has(habit.id)) return false
    seen.add(habit.id)
    return true
  })
}

function resolveHabit(query: string, habits: readonly DomainHabit[]): DomainHabit {
  try {
    return requireResolved(query, habits).value
  } catch (error) {
    if (!(error instanceof ResolutionError)) {
      throw new AppError("internal_error", "Habit resolution failed unexpectedly", { cause: error })
    }
    throw new AppError(error.code === "ambiguous" ? "ambiguous" : "not_found", error.message, {
      details: {
        query: error.query,
        resolutionCode: error.code,
        minimumPrefixLength: error.code === "prefix_too_short" ? 4 : undefined,
        candidates: error.candidates.map(({ id, name }) => ({ id, name })),
      },
    })
  }
}

function sortHabits(habits: readonly DomainHabit[]): DomainHabit[] {
  return [...habits].sort(
    (left, right) =>
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  )
}

function sortCheckins(checkins: readonly DomainCheckin[]): DomainCheckin[] {
  return [...checkins].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.habitId.localeCompare(right.habitId) ||
      left.id.localeCompare(right.id),
  )
}

function habitDate(value: string, timeZone: string, now?: string): string {
  try {
    return resolveDateExpression(value, timeZone, now).toString()
  } catch (cause) {
    throw new AppError("invalid_input", `Invalid habit date: ${value}`, { cause })
  }
}

function parseHabitDateOption(
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

function dateStamp(date: string): number {
  return Number(date.replaceAll("-", ""))
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

function publicHabit(habit: DomainHabit): Record<string, unknown> {
  const { raw: _raw, ...safe } = habit
  return safe
}

function publicCheckin(checkin: DomainCheckin): Record<string, unknown> {
  const { raw: _raw, ...safe } = checkin
  return safe
}

function finiteNumber(
  value: unknown,
  label: string,
  options: { minimum?: number; exclusiveMinimum?: number; integer?: boolean } = {},
): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (
    !Number.isFinite(parsed) ||
    (options.integer === true && !Number.isInteger(parsed)) ||
    (options.minimum !== undefined && parsed < options.minimum) ||
    (options.exclusiveMinimum !== undefined && parsed <= options.exclusiveMinimum)
  ) {
    throw new AppError("invalid_input", `${label} is invalid`)
  }
  return parsed
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("invalid_input", `${label} is required`)
  }
  return value.trim()
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true
    if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false
  }
  throw new AppError("invalid_input", `${label} must be true or false`)
}

function failureFor(id: string, error: unknown): { id: string; code: string; message: string } {
  if (error instanceof AppError) return { id, code: error.code, message: error.message }
  return {
    id,
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  }
}

function assertCacheAccount(context: AppContext, cacheIdentity: string | undefined): void {
  const expected = context.cacheIdentity
  if (expected && cacheIdentity && expected !== cacheIdentity) {
    throw new AppError("credential_account_mismatch", "Cached data belongs to another account", {
      details: { resource: "habits" },
    })
  }
}

function isStale(fetchedAt: string, ttlSeconds: number): boolean {
  const time = Date.parse(fetchedAt)
  return !Number.isFinite(time) || Date.now() - time > ttlSeconds * 1000
}
