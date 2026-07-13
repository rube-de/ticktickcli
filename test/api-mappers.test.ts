import { describe, expect, test } from "bun:test"
import { mapV1Habit, mapV1Task } from "../src/api/v1/mapper"
import { V1HabitSchema, V1TaskSchema } from "../src/api/v1/schemas"
import { mapV2CalendarEvent, mapV2Filter, mapV2Task, toV2TaskCreate } from "../src/api/v2/mapper"
import { V2CalendarEventSchema, V2FilterSchema, V2TaskSchema } from "../src/api/v2/schemas"

describe("API mappers", () => {
  test("normalizes v1 task status, dates, checklist, and retains additive raw fields", () => {
    const wire = V1TaskSchema.parse({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      status: 2,
      priority: 5,
      timeZone: "Europe/Zurich",
      dueDate: "2026-07-13T12:00:00+0200",
      items: [{ id: "item-1", title: "Step", status: 1 }],
      futureField: "preserved",
    })
    const task = mapV1Task(wire, { fetchedAt: "2026-07-13T10:00:00Z" })

    expect(task).toMatchObject({
      status: "completed",
      priority: 5,
      dueDate: "2026-07-13T10:00:00Z",
      rawDueDate: "2026-07-13T12:00:00+0200",
      checklist: [{ id: "item-1", status: "completed" }],
      raw: { futureField: "preserved" },
    })
  })

  test("does not guess an unverified habit archive status code", () => {
    const wire = V1HabitSchema.parse({ id: "habit-1", name: "Read", status: 1 })
    expect(mapV1Habit(wire, { fetchedAt: "2026-07-13T10:00:00Z" }).status).toBe("unknown")
  })

  test("normalizes v2 tasks and treats -1 pinnedTime as unpinned", () => {
    const wire = V2TaskSchema.parse({
      id: "task-1",
      projectId: "project-1",
      title: "Task",
      status: -1,
      pinnedTime: "-1",
      deleted: 1,
    })
    const task = mapV2Task(wire, { fetchedAt: "2026-07-13T10:00:00Z" })
    expect(task.status).toBe("wont_do")
    expect(task.pinnedTime).toBeUndefined()
    expect(task.deleted).toBe(true)
  })

  test("keeps parent assignment out of the v2 add item for the required second request", () => {
    const plan = toV2TaskCreate(
      {
        title: "Child",
        projectId: "project-1",
        parentId: "parent-1",
      },
      "aaaaaaaaaaaaaaaaaaaaaaaa",
    )
    expect(plan.parentId).toBe("parent-1")
    expect(plan.task).not.toHaveProperty("parentId")
  })

  test("parses JSON-encoded filter rules but retains unsupported strings", () => {
    const parsed = mapV2Filter(
      V2FilterSchema.parse({ id: "filter-1", name: "Today", rule: '{"type":0}' }),
      { fetchedAt: "2026-07-13T10:00:00Z" },
    )
    const unsupported = mapV2Filter(
      V2FilterSchema.parse({ id: "filter-2", name: "Custom", rule: "not-json" }),
      { fetchedAt: "2026-07-13T10:00:00Z" },
    )
    expect(parsed.rule).toEqual({ type: 0 })
    expect(unsupported.rule).toBe("not-json")
  })

  test("normalizes calendar event aliases only when required structure is present", () => {
    const event = mapV2CalendarEvent(
      V2CalendarEventSchema.parse({
        eventId: "event-1",
        summary: "Meeting",
        startTime: "2026-07-13T09:00:00+0000",
        endTime: "2026-07-13T10:00:00+0000",
      }),
      { fetchedAt: "2026-07-13T08:00:00Z" },
    )
    expect(event).toMatchObject({
      id: "event-1",
      title: "Meeting",
      startDate: "2026-07-13T09:00:00Z",
      endDate: "2026-07-13T10:00:00Z",
    })
  })
})
