import { expect, test } from "bun:test"
import { generateCompletion } from "../src/commands/completion"

test("completion generators include stable top-level commands", () => {
  for (const shell of ["bash", "zsh", "fish"] as const) {
    const value = generateCompletion(shell)
    expect(value).toContain("task")
    expect(value).toContain("auth")
    expect(value).toContain("completion")
    expect(value).not.toContain("wont-do")
  }
})

test("completion generators distinguish nested command paths", () => {
  const bash = generateCompletion("bash")
  expect(bash).toContain("'task checklist')")
  expect(bash).toContain("add complete delete")

  const zsh = generateCompletion("zsh")
  expect(zsh).toContain("'task checklist') _values 'command' add complete delete")

  const fish = generateCompletion("fish")
  expect(fish).toContain(
    "__fish_seen_subcommand_from task; and __fish_seen_subcommand_from checklist",
  )
})
