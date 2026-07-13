import { describe, expect, test } from "bun:test"

import { parseQuickAdd } from "../src/core/quickadd"
import { assertRecurrenceHasStart, parseRecurrenceExpression } from "../src/core/recur"

describe("quick-add", () => {
  test("extracts supported sigils without mutating literal title text", () => {
    expect(parseQuickAdd("Pay rent !high #finance ~Personal *every month")).toEqual({
      title: "Pay rent",
      tags: ["finance"],
      priority: 5,
      project: "Personal",
      recurrenceRule: "RRULE:FREQ=MONTHLY;INTERVAL=1",
    })
  })

  test("supports escaped sigils and literal-title mode", () => {
    expect(parseQuickAdd("Write \\#not-a-tag #work")).toMatchObject({
      title: "Write #not-a-tag",
      tags: ["work"],
    })
    expect(parseQuickAdd("Keep #everything", { literalTitle: true })).toEqual({
      title: "Keep #everything",
      tags: [],
    })
  })
})

describe("recurrence", () => {
  test("supports a narrow deterministic English grammar", () => {
    expect(parseRecurrenceExpression("every 2 weeks")).toMatchObject({
      frequency: "WEEKLY",
      interval: 2,
      rule: "RRULE:FREQ=WEEKLY;INTERVAL=2",
    })
  })

  test("requires a start-date anchor", () => {
    expect(() => assertRecurrenceHasStart("RRULE:FREQ=DAILY", undefined)).toThrow(
      "requires an explicit start-date",
    )
  })
})
