import { describe, expect, test } from "bun:test"

import { isTaskOverdueForView } from "../src/commands/views"
import {
  dateOnlyToWireInstant,
  getDayBounds,
  isDueToday,
  isOverdue,
  normalizeDateTime,
  resolveTimeZone,
} from "../src/core/dates"

describe("date normalization", () => {
  test("uses 23-hour day bounds across a spring DST transition", () => {
    const bounds = getDayBounds("2024-03-10", "America/New_York")
    expect(bounds.start).toBe("2024-03-10T05:00:00Z")
    expect(bounds.endExclusive).toBe("2024-03-11T04:00:00Z")
  })

  test("does not UTC-shift all-day calendar dates", () => {
    const due = normalizeDateTime("2024-03-10T00:00:00+0000", {
      timeZone: "America/Los_Angeles",
      isAllDay: true,
    })
    expect(due.instant).toBeUndefined()
    expect(due.localDate).toBe("2024-03-10")
    expect(isDueToday(due, "Pacific/Auckland", "2024-03-09T12:00:00Z")).toBe(true)
  })

  test("applies an explicit DST disambiguation policy", () => {
    expect(() =>
      normalizeDateTime("2024-03-10T02:30:00", {
        timeZone: "America/New_York",
        disambiguation: "reject",
      }),
    ).toThrow("Invalid date-time")
    expect(
      normalizeDateTime("2024-03-10T02:30:00", {
        timeZone: "America/New_York",
        disambiguation: "later",
      }).instant,
    ).toBe("2024-03-10T07:30:00Z")
  })

  test("compares floating timed tasks by time, not only by calendar date", () => {
    const due = normalizeDateTime("2026-07-13T09:00:00", {
      timeZone: "Europe/Zurich",
      isFloating: true,
    })
    expect(isOverdue(due, "Europe/Zurich", "2026-07-13T10:00:00+02:00")).toBe(true)
  })

  test("includes a timed task due earlier today in the overdue view", () => {
    expect(
      isTaskOverdueForView(
        {
          id: "task-1",
          projectId: "project-1",
          title: "Earlier today",
          kind: "text",
          status: "open",
          priority: 0,
          tags: [],
          reminders: [],
          checklist: [],
          isAllDay: false,
          dueDate: "2026-07-13T08:00:00Z",
          source: "v1",
          fetchedAt: "2026-07-13T08:00:00Z",
        },
        "Europe/Zurich",
        "2026-07-13T12:00:00+02:00",
      ),
    ).toBe(true)
  })

  test("honors timezone precedence", () => {
    expect(resolveTimeZone("Europe/Zurich", "UTC", "Asia/Tokyo")).toBe("Europe/Zurich")
  })

  test("anchors a bare calendar date at UTC midnight for the write wire format", () => {
    expect(dateOnlyToWireInstant("2026-07-15")).toBe("2026-07-15T00:00:00.000+0000")
  })

  test("rejects a calendar date that does not exist", () => {
    expect(() => dateOnlyToWireInstant("2026-02-30")).toThrow()
  })

  test("round-trips a write-wire all-day date back to the same calendar date, in any timezone", () => {
    const wire = dateOnlyToWireInstant("2026-07-15")
    for (const timeZone of ["UTC", "Europe/Zurich", "America/Los_Angeles", "Pacific/Auckland"]) {
      expect(normalizeDateTime(wire, { timeZone, isAllDay: true }).localDate).toBe("2026-07-15")
    }
  })
})
