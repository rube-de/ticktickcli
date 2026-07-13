import { Temporal } from "@js-temporal/polyfill"

export type DstDisambiguation = "compatible" | "earlier" | "later" | "reject"

export const DEFAULT_DST_DISAMBIGUATION: DstDisambiguation = "compatible"

export interface NormalizedDateTime {
  /** Exact original value for endpoint-specific round-tripping. */
  wire: string
  /** Canonical instant. All-day values intentionally have no instant. */
  instant?: string
  /** Calendar date in the value's declared/profile timezone. */
  localDate: string
  timeZone: string
  isAllDay: boolean
  isFloating: boolean
}

export interface NormalizeDateTimeOptions {
  timeZone: string
  isAllDay?: boolean
  isFloating?: boolean
  disambiguation?: DstDisambiguation
}

export interface DayBounds {
  date: string
  timeZone: string
  start: string
  endExclusive: string
}

export class DateNormalizationError extends Error {
  readonly value: string

  constructor(message: string, value: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "DateNormalizationError"
    this.value = value
  }
}

/** Convert TickTick's basic numeric offset to the extended form Temporal accepts everywhere. */
export function normalizeWireOffset(value: string): string {
  return value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
}

export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim() !== timeZone || timeZone.length === 0) return false

  try {
    Temporal.Now.zonedDateTimeISO(timeZone)
    return true
  } catch {
    return false
  }
}

export function systemTimeZone(): string {
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone
  return candidate && isValidTimeZone(candidate) ? candidate : "UTC"
}

/** Flag > saved profile > verified account setting > OS timezone. */
export function resolveTimeZone(
  explicit?: string,
  saved?: string,
  account?: string,
  operatingSystem = systemTimeZone(),
): string {
  const candidate = [explicit, saved, account, operatingSystem].find(
    (value): value is string => value !== undefined && value.length > 0,
  )

  if (!candidate || !isValidTimeZone(candidate)) {
    throw new DateNormalizationError(`Invalid IANA timezone: ${candidate ?? ""}`, candidate ?? "")
  }
  return candidate
}

function hasExplicitOffset(value: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:?\d{2})(?:\[[^\]]+\])?$/.test(value)
}

function datePrefix(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  if (!match?.[1]) throw new DateNormalizationError("Expected an ISO calendar date", value)
  return Temporal.PlainDate.from(match[1]).toString()
}

export function normalizeDateTime(
  wireValue: string,
  options: NormalizeDateTimeOptions,
): NormalizedDateTime {
  const wire = wireValue.trim()
  if (!wire) throw new DateNormalizationError("Date value cannot be empty", wireValue)
  if (!isValidTimeZone(options.timeZone)) {
    throw new DateNormalizationError(`Invalid IANA timezone: ${options.timeZone}`, wireValue)
  }

  const isAllDay = options.isAllDay ?? false
  const isFloating = options.isFloating ?? false
  if (isAllDay) {
    return {
      wire,
      localDate: datePrefix(wire),
      timeZone: options.timeZone,
      isAllDay: true,
      isFloating,
    }
  }

  try {
    const normalized = normalizeWireOffset(wire)
    const disambiguation = options.disambiguation ?? DEFAULT_DST_DISAMBIGUATION
    const instant = hasExplicitOffset(normalized)
      ? Temporal.Instant.from(normalized)
      : Temporal.PlainDateTime.from(normalized)
          .toZonedDateTime(options.timeZone, {
            disambiguation,
          })
          .toInstant()
    const zoned = instant.toZonedDateTimeISO(options.timeZone)

    return {
      wire,
      instant: instant.toString(),
      localDate: zoned.toPlainDate().toString(),
      timeZone: options.timeZone,
      isAllDay: false,
      isFloating,
    }
  } catch (cause) {
    throw new DateNormalizationError(`Invalid date-time: ${wireValue}`, wireValue, { cause })
  }
}

export function toInstant(now?: Temporal.Instant | string): Temporal.Instant {
  if (typeof now === "string") return Temporal.Instant.from(normalizeWireOffset(now))
  return now ?? Temporal.Now.instant()
}

export function profileDate(timeZone: string, now?: Temporal.Instant | string): Temporal.PlainDate {
  if (!isValidTimeZone(timeZone)) {
    throw new DateNormalizationError(`Invalid IANA timezone: ${timeZone}`, timeZone)
  }
  return toInstant(now).toZonedDateTimeISO(timeZone).toPlainDate()
}

export function getDayBounds(
  date: Temporal.PlainDate | string,
  timeZone: string,
  disambiguation: DstDisambiguation = DEFAULT_DST_DISAMBIGUATION,
): DayBounds {
  const plainDate = typeof date === "string" ? Temporal.PlainDate.from(date) : date
  const start = plainDate
    .toPlainDateTime(Temporal.PlainTime.from("00:00"))
    .toZonedDateTime(timeZone, { disambiguation })
    .toInstant()
  const end = plainDate
    .add({ days: 1 })
    .toPlainDateTime(Temporal.PlainTime.from("00:00"))
    .toZonedDateTime(timeZone, { disambiguation })
    .toInstant()

  return {
    date: plainDate.toString(),
    timeZone,
    start: start.toString(),
    endExclusive: end.toString(),
  }
}

export function dateInProfileTimeZone(value: NormalizedDateTime, profileTimeZone: string): string {
  if (value.isAllDay || value.isFloating || !value.instant) return value.localDate
  return Temporal.Instant.from(value.instant)
    .toZonedDateTimeISO(profileTimeZone)
    .toPlainDate()
    .toString()
}

export function isDueToday(
  due: NormalizedDateTime,
  profileTimeZone: string,
  now?: Temporal.Instant | string,
): boolean {
  return (
    dateInProfileTimeZone(due, profileTimeZone) === profileDate(profileTimeZone, now).toString()
  )
}

export function isOverdue(
  due: NormalizedDateTime,
  profileTimeZone: string,
  now?: Temporal.Instant | string,
): boolean {
  const current = toInstant(now)
  if (due.isAllDay || !due.instant) {
    return (
      Temporal.PlainDate.compare(
        Temporal.PlainDate.from(due.localDate),
        profileDate(profileTimeZone, current),
      ) < 0
    )
  }
  return Temporal.Instant.compare(Temporal.Instant.from(due.instant), current) < 0
}

export function daysFromToday(
  date: string,
  profileTimeZone: string,
  now?: Temporal.Instant | string,
): number {
  return profileDate(profileTimeZone, now).until(Temporal.PlainDate.from(date), {
    largestUnit: "day",
  }).days
}

export type RelativeDateKeyword = "today" | "tomorrow" | "eom"

export function resolveDateExpression(
  expression: RelativeDateKeyword | string,
  profileTimeZone: string,
  now?: Temporal.Instant | string,
): Temporal.PlainDate {
  const today = profileDate(profileTimeZone, now)
  switch (expression.toLowerCase()) {
    case "today":
      return today
    case "tomorrow":
      return today.add({ days: 1 })
    case "eom":
      return today.with({ day: today.daysInMonth })
    default:
      try {
        return Temporal.PlainDate.from(expression)
      } catch (cause) {
        throw new DateNormalizationError(`Unsupported date expression: ${expression}`, expression, {
          cause,
        })
      }
  }
}
