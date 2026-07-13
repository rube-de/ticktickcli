export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"

export interface ParsedRecurrence {
  rule: string
  frequency: RecurrenceFrequency
  interval: number
  byDay?: readonly string[]
}

export class RecurrenceSyntaxError extends Error {
  readonly expression: string

  constructor(message: string, expression: string) {
    super(message)
    this.name = "RecurrenceSyntaxError"
    this.expression = expression
  }
}

const DAY_NAMES: Readonly<Record<string, string>> = {
  monday: "MO",
  tuesday: "TU",
  wednesday: "WE",
  thursday: "TH",
  friday: "FR",
  saturday: "SA",
  sunday: "SU",
}

const VALID_BY_DAY = /^(?:[+-]?\d{1,2})?(?:MO|TU|WE|TH|FR|SA|SU)$/

export function parseRRule(value: string): ParsedRecurrence {
  const expression = value.trim()
  const body = expression.toUpperCase().startsWith("RRULE:") ? expression.slice(6) : expression
  const properties = new Map<string, string>()

  for (const component of body.split(";")) {
    const separator = component.indexOf("=")
    if (separator <= 0 || separator === component.length - 1) {
      throw new RecurrenceSyntaxError(`Invalid RRULE component: ${component}`, value)
    }
    const key = component.slice(0, separator).toUpperCase()
    const propertyValue = component.slice(separator + 1).toUpperCase()
    if (properties.has(key))
      throw new RecurrenceSyntaxError(`Duplicate RRULE property: ${key}`, value)
    properties.set(key, propertyValue)
  }

  const frequency = properties.get("FREQ")
  if (!frequency || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(frequency)) {
    throw new RecurrenceSyntaxError("RRULE requires a supported FREQ", value)
  }

  const intervalValue = properties.get("INTERVAL") ?? "1"
  if (!/^\d+$/.test(intervalValue) || Number(intervalValue) < 1) {
    throw new RecurrenceSyntaxError("RRULE INTERVAL must be a positive integer", value)
  }

  const byDayValue = properties.get("BYDAY")
  const byDay = byDayValue?.split(",")
  if (byDay?.some((day) => !VALID_BY_DAY.test(day))) {
    throw new RecurrenceSyntaxError("RRULE contains an invalid BYDAY value", value)
  }

  const canonical = [...properties.entries()]
    .map(([key, propertyValue]) => `${key}=${propertyValue}`)
    .join(";")

  return {
    rule: `RRULE:${canonical}`,
    frequency: frequency as RecurrenceFrequency,
    interval: Number(intervalValue),
    ...(byDay ? { byDay } : {}),
  }
}

function naturalRule(
  frequency: RecurrenceFrequency,
  interval = 1,
  byDay?: readonly string[],
): string {
  const components = [`FREQ=${frequency}`, `INTERVAL=${interval}`]
  if (byDay?.length) components.push(`BYDAY=${byDay.join(",")}`)
  return `RRULE:${components.join(";")}`
}

/** A narrow English grammar. Unsupported language is rejected rather than guessed. */
export function parseRecurrenceExpression(expressionValue: string): ParsedRecurrence {
  const expression = expressionValue.trim()
  if (!expression)
    throw new RecurrenceSyntaxError("Recurrence expression cannot be empty", expressionValue)
  if (/^(?:RRULE:)?FREQ=/i.test(expression)) return parseRRule(expression)

  const normalized = expression.toLowerCase().replace(/\s+/g, " ")
  const simple: Readonly<Record<string, RecurrenceFrequency>> = {
    daily: "DAILY",
    "every day": "DAILY",
    weekly: "WEEKLY",
    "every week": "WEEKLY",
    monthly: "MONTHLY",
    "every month": "MONTHLY",
    yearly: "YEARLY",
    annually: "YEARLY",
    "every year": "YEARLY",
  }
  const simpleFrequency = simple[normalized]
  if (simpleFrequency) return parseRRule(naturalRule(simpleFrequency))

  if (normalized === "weekdays" || normalized === "every weekday") {
    return parseRRule(naturalRule("WEEKLY", 1, ["MO", "TU", "WE", "TH", "FR"]))
  }

  const day = /^every (monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.exec(
    normalized,
  )?.[1]
  if (day) return parseRRule(naturalRule("WEEKLY", 1, [DAY_NAMES[day] as string]))

  const intervalMatch = /^every (\d+) (day|week|month|year)s?$/.exec(normalized)
  if (intervalMatch?.[1] && intervalMatch[2]) {
    const frequencyByUnit: Record<string, RecurrenceFrequency> = {
      day: "DAILY",
      week: "WEEKLY",
      month: "MONTHLY",
      year: "YEARLY",
    }
    const frequency = frequencyByUnit[intervalMatch[2]]
    if (frequency) return parseRRule(naturalRule(frequency, Number(intervalMatch[1])))
  }

  throw new RecurrenceSyntaxError(
    `Unsupported recurrence expression: ${expression}`,
    expressionValue,
  )
}

export function assertRecurrenceHasStart(
  recurrenceRule: string | undefined,
  startDate: string | undefined,
): void {
  if (recurrenceRule && !startDate) {
    throw new RecurrenceSyntaxError(
      "A recurring task requires an explicit start-date anchor",
      recurrenceRule,
    )
  }
}
