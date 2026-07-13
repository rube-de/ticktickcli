import type { DomainTask } from "../domain/models"

export interface IcsOptions {
  calendarName?: string
  productId?: string
  generatedAt?: string
}

export function serializeTasksToIcs(
  tasks: readonly DomainTask[],
  options: IcsOptions = {},
): string {
  const generatedAt = formatUtc(options.generatedAt ?? new Date().toISOString())
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeText(options.productId ?? "-//ticktickcli//tt//EN")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.calendarName ?? "TickTick Tasks")}`,
  ]

  for (const task of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push("BEGIN:VEVENT")
    lines.push(`UID:${escapeText(`${task.id}@ticktickcli`)}`)
    lines.push(`DTSTAMP:${generatedAt}`)
    lines.push(`SUMMARY:${escapeText(task.title)}`)
    const description = task.description ?? task.content
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`)
    if (task.tags.length > 0) lines.push(`CATEGORIES:${task.tags.map(escapeText).join(",")}`)
    if (task.isAllDay) {
      const start = calendarDate(task.startDate ?? task.dueDate)
      const due = calendarDate(task.dueDate)
      if (start) lines.push(`DTSTART;VALUE=DATE:${start}`)
      if (due) lines.push(`DUE;VALUE=DATE:${due}`)
    } else {
      const start = dateTimeProperty("DTSTART", task.startDate, task.timeZone)
      const due = dateTimeProperty("DUE", task.dueDate, task.timeZone)
      if (start) lines.push(start)
      if (due) lines.push(due)
    }
    if (task.repeatRule) lines.push(normalizeRRule(task.repeatRule))
    if (task.status === "completed") {
      lines.push("STATUS:COMPLETED")
      if (task.completedTime) lines.push(`COMPLETED:${formatUtc(task.completedTime)}`)
    } else if (task.status === "wont_do") {
      lines.push("STATUS:CANCELLED")
    } else {
      lines.push("STATUS:CONFIRMED")
    }
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
}

export function foldLine(line: string): string[] {
  if (Buffer.byteLength(line, "utf8") <= 75) return [line]
  const result: string[] = []
  let current = ""
  let currentBytes = 0
  let allowance = 75
  for (const character of line) {
    const bytes = Buffer.byteLength(character, "utf8")
    if (currentBytes + bytes > allowance && current.length > 0) {
      result.push(result.length === 0 ? current : ` ${current}`)
      current = character
      currentBytes = bytes
      allowance = 74
    } else {
      current += character
      currentBytes += bytes
    }
  }
  if (current.length > 0) result.push(result.length === 0 ? current : ` ${current}`)
  return result
}

function dateTimeProperty(
  name: string,
  value: string | undefined,
  timeZone?: string,
): string | undefined {
  if (!value) return undefined
  if (timeZone && !/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    return `${name};TZID=${escapeParameter(timeZone)}:${formatLocal(value)}`
  }
  return `${name}:${formatUtc(value)}`
}

function calendarDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[1]}${match[2]}${match[3]}` : undefined
}

function formatLocal(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value)
  if (!match) throw new TypeError(`Invalid local date-time: ${value}`)
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6] ?? "00"}`
}

function formatUtc(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid date-time: ${value}`)
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
}

function normalizeRRule(value: string): string {
  const normalized = value.trim().replace(/^RRULE:/i, "")
  if (!normalized) throw new TypeError("RRULE cannot be empty")
  return `RRULE:${normalized}`
}

function escapeParameter(value: string): string {
  if (/^[A-Za-z0-9_+\-/]+$/.test(value)) return value
  return `"${value.replace(/["\\]/g, "\\$&")}"`
}
