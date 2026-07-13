import { describe, expect, test } from "bun:test"
import { Temporal } from "@js-temporal/polyfill"
import { Command } from "commander"
import {
  chunkFocusRange,
  parseFocusType,
  registerFocusCommands,
  resolveFocusDateRange,
  resolveFocusListRange,
} from "../src/commands/focus"
import { registerHabitCommands, resolveHabitDateRange } from "../src/commands/habit"
import { normalizeWireOffset } from "../src/core/dates"

describe("habit and focus command registration", () => {
  test("registers the stable Phase 4 surface without habit archive", () => {
    const program = new Command()
    registerHabitCommands(program)
    registerFocusCommands(program)

    expect(childNames(command(program, "habit"))).toEqual([
      "add",
      "checkin",
      "edit",
      "list",
      "log",
      "show",
      "stats",
    ])
    expect(childNames(command(program, "focus"))).toEqual([
      "delete",
      "heatmap",
      "list",
      "log",
      "stats",
    ])
    expect(command(program, "habit").commands.some((child) => child.name() === "archive")).toBe(
      false,
    )
  })

  test("exposes dry-run and confirmation flags on writes and required focus inputs", () => {
    const program = new Command()
    registerHabitCommands(program)
    registerFocusCommands(program)

    const checkin = command(command(program, "habit"), "checkin")
    expect(checkin.registeredArguments[0]?.variadic).toBe(true)
    expect(checkin.registeredArguments[0]?.required).toBe(true)
    expect(optionNames(checkin)).toEqual(
      expect.arrayContaining(["--date", "--value", "--dry-run", "--yes"]),
    )

    for (const name of ["add", "edit"] as const) {
      expect(optionNames(command(command(program, "habit"), name))).toEqual(
        expect.arrayContaining(["--dry-run", "--yes"]),
      )
    }

    const focusLog = command(command(program, "focus"), "log")
    expect(focusLog.options.find(({ long }) => long === "--duration")?.mandatory).toBe(true)
    expect(optionNames(focusLog)).toEqual(expect.arrayContaining(["--dry-run", "--yes"]))

    const focusDelete = command(command(program, "focus"), "delete")
    expect(focusDelete.options.find(({ long }) => long === "--type")?.mandatory).toBe(true)
    expect(optionNames(focusDelete)).toEqual(expect.arrayContaining(["--dry-run", "--yes"]))
  })
})

describe("focus range chunking", () => {
  test("covers a long interval with contiguous chunks no longer than 30 exact days", () => {
    const chunks = chunkFocusRange("2026-01-01T00:00:00Z", "2026-04-05T00:00:00Z", "UTC")
    expect(chunks).toHaveLength(4)

    const parsed = chunks.map(({ from, to }) => ({
      from: Temporal.Instant.from(normalizeWireOffset(from)),
      to: Temporal.Instant.from(normalizeWireOffset(to)),
    }))
    expect(parsed[0]?.from.toString()).toBe("2026-01-01T00:00:00Z")
    expect(parsed.at(-1)?.to.toString()).toBe("2026-04-05T00:00:00Z")
    for (const [index, chunk] of parsed.entries()) {
      expect(chunk.to.epochMilliseconds - chunk.from.epochMilliseconds).toBeLessThanOrEqual(
        30 * 24 * 60 * 60 * 1_000,
      )
      const previous = parsed[index - 1]
      if (previous) expect(chunk.from.equals(previous.to)).toBe(true)
    }
  })

  test("preserves exact coverage and emits the applicable offset across DST", () => {
    const chunks = chunkFocusRange("2026-03-01", "2026-04-30", "Europe/Zurich")
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.from).toEndWith("+0100")
    expect(chunks[0]?.to).toEndWith("+0200")
    expect(
      Temporal.Instant.from(normalizeWireOffset(chunks[0]?.to ?? "")).equals(
        Temporal.Instant.from(normalizeWireOffset(chunks[1]?.from ?? "")),
      ),
    ).toBe(true)
  })

  test("defaults focus listing to one exact 30-day chunk", () => {
    const range = resolveFocusListRange({}, "UTC", "2026-04-01T12:00:00Z")
    expect(range.from).toBe("2026-03-02T12:00:00Z")
    expect(range.to).toBe("2026-04-01T12:00:00Z")
    expect(range.chunks).toHaveLength(1)
  })
})

describe("habit and focus calendar ranges", () => {
  test("converts the exclusive habit end date to the v1 inclusive stamp", () => {
    expect(
      resolveHabitDateRange({ from: "2026-01-01", to: "2026-02-01" }, "Europe/Zurich"),
    ).toEqual({
      from: "2026-01-01",
      to: "2026-02-01",
      fromStamp: 20260101,
      toInclusiveStamp: 20260131,
    })
  })

  test("uses an exclusive CLI end and inclusive v2 statistics end", () => {
    expect(resolveFocusDateRange({ from: "2026-03-01", to: "2026-04-01" }, "UTC")).toEqual({
      from: "2026-03-01",
      to: "2026-04-01",
      toInclusive: "2026-03-31",
    })
  })

  test("rejects empty ranges and normalizes focus type aliases", () => {
    expect(() => resolveHabitDateRange({ from: "2026-01-01", to: "2026-01-01" }, "UTC")).toThrow(
      "--from must be earlier than --to",
    )
    expect(parseFocusType("0")).toBe("pomodoro")
    expect(parseFocusType("stopwatch")).toBe("timing")
    expect(() => parseFocusType("remote")).toThrow("Invalid focus type")
  })
})

function command(parent: Command, name: string): Command {
  const child = parent.commands.find((candidate) => candidate.name() === name)
  if (!child) throw new Error(`Missing command: ${name}`)
  return child
}

function childNames(parent: Command): string[] {
  return parent.commands.map((child) => child.name()).sort()
}

function optionNames(value: Command): Array<string | undefined> {
  return value.options.map(({ long }) => long)
}
