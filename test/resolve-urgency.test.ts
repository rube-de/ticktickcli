import { describe, expect, test } from "bun:test"

import { resolveEntity } from "../src/core/resolve"
import { calculateUrgency } from "../src/core/urgency"
import type { DomainTask } from "../src/domain/models"

const entities = [
  { id: "abcd0001", name: "Work" },
  { id: "abcd0002", name: "Workshop" },
  { id: "beef0001", name: "Personal" },
]

describe("entity resolution", () => {
  test("uses exact normalized name before prefixes", () => {
    expect(resolveEntity(" work ", entities)).toMatchObject({
      ok: true,
      method: "exact_name",
      value: entities[0],
    })
  })

  test("returns candidate IDs on ambiguity and never guesses in machine mode", () => {
    const ambiguous = resolveEntity("abcd", entities)
    expect(ambiguous).toMatchObject({ ok: false, code: "ambiguous" })
    if (!ambiguous.ok)
      expect(ambiguous.candidates.map(({ id }) => id)).toEqual(["abcd0001", "abcd0002"])

    expect(
      resolveEntity("Persnal", entities, { allowFuzzy: true, interactive: false }),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    })
  })

  test("enforces the minimum prefix length after exact matching", () => {
    expect(resolveEntity("abc", entities)).toMatchObject({ ok: false, code: "prefix_too_short" })
  })
})

describe("urgency", () => {
  test("ranks overdue high-priority tasks deterministically", () => {
    const task: DomainTask = {
      id: "task-1",
      projectId: "project-1",
      title: "Overdue",
      kind: "text",
      status: "open",
      priority: 5,
      tags: [],
      reminders: [],
      checklist: [],
      isAllDay: true,
      dueDate: "2026-07-10",
      source: "v1",
      fetchedAt: "2026-07-13T00:00:00Z",
    }
    expect(
      calculateUrgency(task, { timeZone: "Europe/Zurich", now: "2026-07-13T12:00:00Z" }),
    ).toMatchObject({
      score: 133,
      due: 103,
      priority: 30,
    })
  })
})
