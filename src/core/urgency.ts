import type { Temporal } from "@js-temporal/polyfill"

import type { DomainTask, TaskPriority } from "../domain/models"
import { dateInProfileTimeZone, daysFromToday, isOverdue, normalizeDateTime } from "./dates"

export interface UrgencyBreakdown {
  score: number
  due: number
  priority: number
  start: number
  reasons: readonly string[]
}

export interface UrgencyOptions {
  timeZone: string
  now?: Temporal.Instant | string
}

const PRIORITY_SCORE: Record<TaskPriority, number> = {
  0: 0,
  1: 10,
  3: 20,
  5: 30,
}

function taskDate(task: DomainTask, value: string, options: UrgencyOptions): string | undefined {
  try {
    const normalized = normalizeDateTime(value, {
      timeZone: task.timeZone ?? options.timeZone,
      isAllDay: task.isAllDay,
      isFloating: task.isFloating,
    })
    return dateInProfileTimeZone(normalized, options.timeZone)
  } catch {
    return undefined
  }
}

/**
 * A deliberately small, deterministic policy for `tt next`. It is pure so the
 * weights can evolve behind golden tests without leaking wire semantics into UI code.
 */
export function calculateUrgency(task: DomainTask, options: UrgencyOptions): UrgencyBreakdown {
  if (task.status !== "open" || task.deleted) {
    return { score: Number.NEGATIVE_INFINITY, due: 0, priority: 0, start: 0, reasons: [] }
  }

  const reasons: string[] = []
  const priority = PRIORITY_SCORE[task.priority]
  if (priority) reasons.push(`priority:${task.priority}`)

  let due = 0
  if (task.dueDate) {
    try {
      const normalized = normalizeDateTime(task.dueDate, {
        timeZone: task.timeZone ?? options.timeZone,
        isAllDay: task.isAllDay,
        isFloating: task.isFloating,
      })
      const calendarDate = dateInProfileTimeZone(normalized, options.timeZone)
      const days = daysFromToday(calendarDate, options.timeZone, options.now)
      if (isOverdue(normalized, options.timeZone, options.now)) {
        due = 100 + Math.min(30, Math.max(1, -days))
        reasons.push("due:overdue")
      } else if (days === 0) {
        due = 80
        reasons.push("due:today")
      } else if (days === 1) {
        due = 50
        reasons.push("due:tomorrow")
      } else if (days <= 7) {
        due = 25 - Math.max(0, days - 2) * 3
        reasons.push("due:this_week")
      }
    } catch {
      // Protocol validation reports malformed dates; urgency simply leaves them unranked.
    }
  }

  let start = 0
  if (task.startDate) {
    const calendarDate = taskDate(task, task.startDate, options)
    if (calendarDate) {
      const days = daysFromToday(calendarDate, options.timeZone, options.now)
      if (days <= 0) {
        start = 5
        reasons.push("started")
      }
    }
  }

  return { score: due + priority + start, due, priority, start, reasons }
}

export function compareUrgency(
  left: DomainTask,
  right: DomainTask,
  options: UrgencyOptions,
): number {
  const leftScore = calculateUrgency(left, options).score
  const rightScore = calculateUrgency(right, options).score
  if (leftScore !== rightScore) return leftScore > rightScore ? -1 : 1
  return left.id.localeCompare(right.id)
}
