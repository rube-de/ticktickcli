import { describe, expect, test } from "bun:test"

import { filterTasksForList } from "../src/commands/task"
import { evaluateFilter, parseFilter, partitionFilter } from "../src/core/filters"
import type { DomainTask } from "../src/domain/models"

const TASK: DomainTask = {
  id: "task-123456",
  projectId: "project-123456",
  title: "Ship release notes",
  content: "Mention the protocol change",
  kind: "text",
  status: "open",
  priority: 5,
  tags: ["Work"],
  reminders: [],
  checklist: [],
  isAllDay: true,
  dueDate: "2026-07-13T00:00:00+0000",
  timeZone: "Europe/Zurich",
  source: "v1",
  fetchedAt: "2026-07-13T08:00:00Z",
}

describe("filter AST", () => {
  test("parses the initial implicit-AND grammar", () => {
    const ast = parseFilter('project:"Ignored" +work !high due:today text~protocol status:open')
    expect(ast.terms.map((term) => term.kind)).toEqual([
      "project",
      "tag",
      "priority",
      "due_on",
      "text_contains",
      "status",
    ])
  })

  test("keeps due predicates local unless the caller proves remote equivalence", () => {
    const ast = parseFilter("due:today +work")
    expect(partitionFilter(ast).remote.terms).toHaveLength(0)
    expect(partitionFilter(ast, new Set(["tag"])).remote.terms).toHaveLength(1)
  })

  test("evaluates dates in the profile timezone", () => {
    const ast = parseFilter("project:Engineering +work !high due:today text~protocol")
    expect(
      evaluateFilter(ast, TASK, {
        timeZone: "Europe/Zurich",
        now: "2026-07-13T12:00:00Z",
        projectNames: { "project-123456": "Engineering" },
      }),
    ).toBe(true)
  })

  test("reports unsupported clauses instead of ignoring them", () => {
    expect(() => parseFilter("owner:me")).toThrow("Unsupported filter clause")
    expect(() => parseFilter("(due:today OR due:tomorrow)")).toThrow()
  })

  test("applies the result limit after local predicates", () => {
    const tasks = Array.from({ length: 101 }, (_, index) => ({
      ...TASK,
      id: `task-${index}`,
      title: index === 100 ? "Needle" : `Unrelated ${index}`,
    }))
    expect(
      filterTasksForList(tasks, parseFilter("text~needle"), "Europe/Zurich", new Map(), 1).map(
        ({ id }) => id,
      ),
    ).toEqual(["task-100"])
  })
})
