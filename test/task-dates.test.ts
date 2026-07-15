import { describe, expect, test } from "bun:test"
import { V1TaskSchema } from "../src/api/v1/schemas"
import { resolveIsAllDay, responseHasRequestedDates } from "../src/commands/task"
import { resolveDateExpression } from "../src/core/dates"

describe("resolveIsAllDay", () => {
  test("infers all-day from a bare calendar date when --all-day is omitted", () => {
    expect(resolveIsAllDay(undefined, "2026-07-15")).toBe(true)
  })

  test("infers all-day from a normalized keyword date expression (today/tomorrow/eom)", () => {
    const normalized = resolveDateExpression("today", "UTC").toString()
    expect(resolveIsAllDay(undefined, normalized)).toBe(true)
  })

  test("does not infer all-day from a full datetime", () => {
    expect(resolveIsAllDay(undefined, "2026-07-15T09:00:00+0200")).toBe(false)
  })

  test("an explicit --all-day wins even for a full datetime", () => {
    expect(resolveIsAllDay(true, "2026-07-15T09:00:00+0200")).toBe(true)
  })

  test("treats an absent sample as not all-day", () => {
    expect(resolveIsAllDay(undefined, undefined)).toBe(false)
  })
})

describe("responseHasRequestedDates", () => {
  const baseInput = { title: "Task", projectId: "project-1" }

  test("trusts a response that reports the requested dueDate", () => {
    const response = V1TaskSchema.parse({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      dueDate: "2026-07-15T00:00:00.000+0000",
    })
    expect(responseHasRequestedDates({ ...baseInput, dueDate: "2026-07-15" }, response)).toBe(true)
  })

  test("distrusts a response that silently drops the requested dueDate", () => {
    const response = V1TaskSchema.parse({ id: "task-1", projectId: "project-1", title: "Task" })
    expect(responseHasRequestedDates({ ...baseInput, dueDate: "2026-07-15" }, response)).toBe(false)
  })

  test("distrusts a response that silently drops the requested startDate", () => {
    const response = V1TaskSchema.parse({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      dueDate: "2026-07-15T00:00:00.000+0000",
    })
    expect(
      responseHasRequestedDates(
        { ...baseInput, dueDate: "2026-07-15", startDate: "2026-07-10" },
        response,
      ),
    ).toBe(false)
  })

  test("is unaffected by dates that were not requested", () => {
    const response = V1TaskSchema.parse({ id: "task-1", projectId: "project-1", title: "Task" })
    expect(responseHasRequestedDates(baseInput, response)).toBe(true)
  })
})
