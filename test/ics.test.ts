import { describe, expect, test } from "bun:test"
import { foldLine, serializeTasksToIcs } from "../src/core/ics"
import type { DomainTask } from "../src/domain/models"

function task(overrides: Partial<DomainTask> = {}): DomainTask {
  return {
    id: "abc123",
    projectId: "p1",
    title: "Pay rent",
    kind: "text",
    status: "open",
    priority: 0,
    tags: [],
    reminders: [],
    checklist: [],
    isAllDay: true,
    dueDate: "2026-07-14",
    source: "v1",
    fetchedAt: "2026-07-13T10:00:00Z",
    ...overrides,
  }
}

describe("ICS serialization", () => {
  test("emits deterministic CRLF calendar bytes", () => {
    const value = serializeTasksToIcs([task({ tags: ["home", "money"] })], {
      generatedAt: "2026-07-13T12:34:56Z",
      calendarName: "Tasks",
    })
    expect(value).toContain("DTSTAMP:20260713T123456Z\r\n")
    expect(value).toContain("DUE;VALUE=DATE:20260714\r\n")
    expect(value).toContain("CATEGORIES:home,money\r\n")
    expect(value.endsWith("END:VCALENDAR\r\n")).toBe(true)
    expect(value.replace(/\r\n/g, "")).not.toContain("\n")
  })

  test("escapes text and preserves RRULE", () => {
    const value = serializeTasksToIcs(
      [task({ title: "A, B; C\\D\nnext", repeatRule: "FREQ=DAILY;INTERVAL=2" })],
      { generatedAt: "2026-07-13T12:34:56Z" },
    )
    expect(value).toContain("SUMMARY:A\\, B\\; C\\\\D\\nnext")
    expect(value).toContain("RRULE:FREQ=DAILY;INTERVAL=2")
  })

  test("folds UTF-8 without splitting characters or exceeding 75 octets", () => {
    const lines = foldLine(`SUMMARY:${"é".repeat(80)}`)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
    expect(
      lines
        .join("")
        .replace(/^SUMMARY:/, "")
        .replace(/ /g, ""),
    ).toBe("é".repeat(80))
  })
})
