import { describe, expect, test } from "bun:test"
import { Command } from "commander"

import {
  AliasExpansionError,
  expandAliasArgv,
  registerConfigurationCommands,
} from "../src/commands/configuration"
import { defaultConfig, parseConfig } from "../src/config"

describe("configuration schema", () => {
  test("adds backward-compatible defaults to config files from before contexts and aliases", () => {
    const parsed = parseConfig({
      version: 1,
      activeProfile: "default",
      profiles: { default: { host: "ticktick.com" } },
      http: { timeoutMs: 30_000, maximumReadRetries: 3, readsPerSecond: 2 },
    })
    expect(parsed.contexts).toEqual({})
    expect(parsed.activeContext).toBeNull()
    expect(parsed.aliases).toEqual({})
  })

  test("accepts token arrays and rejects shell strings, controls, and cycles", () => {
    expect(
      parseConfig({
        ...defaultConfig(),
        contexts: { work: { tokens: ["project:Work", "+important"] } },
        activeContext: "work",
        aliases: { mine: ["task", "list", "project:Personal"] },
      }),
    ).toMatchObject({
      activeContext: "work",
      contexts: { work: { tokens: ["project:Work", "+important"] } },
      aliases: { mine: ["task", "list", "project:Personal"] },
    })

    expect(() => parseConfig({ ...defaultConfig(), aliases: { mine: "task list" } })).toThrow(
      "must be a non-empty array",
    )
    expect(() =>
      parseConfig({ ...defaultConfig(), aliases: { mine: ["task", "bad\nvalue"] } }),
    ).toThrow("safe argv token")
    expect(() =>
      parseConfig({ ...defaultConfig(), aliases: { first: ["second"], second: ["first"] } }),
    ).toThrow("Alias cycle detected")
  })

  test("requires an active context to exist", () => {
    expect(() => parseConfig({ ...defaultConfig(), activeContext: "missing" })).toThrow(
      "Active context does not exist",
    )
  })
})

describe("alias argv expansion", () => {
  test("expands token arrays recursively while preserving launcher and user arguments", () => {
    const aliases = {
      mine: ["--profile", "work", "personal"],
      personal: ["task", "list", "project:Personal"],
    }
    expect(
      expandAliasArgv(["bun", "/app/src/index.ts", "--json", "mine", "+important"], aliases),
    ).toEqual([
      "bun",
      "/app/src/index.ts",
      "--json",
      "--profile",
      "work",
      "task",
      "list",
      "project:Personal",
      "+important",
    ])
  })

  test("keeps metacharacters as inert argv data", () => {
    const value = "$(touch /tmp/should-not-exist); echo nope"
    expect(
      expandAliasArgv(["bun", "index.ts", "unsafe"], {
        unsafe: ["task", "add", "--title", value],
      }),
    ).toEqual(["bun", "index.ts", "task", "add", "--title", value])
  })

  test("detects cycles and recursion limits", () => {
    expect(() =>
      expandAliasArgv(["bun", "index.ts", "first"], {
        first: ["second"],
        second: ["first"],
      }),
    ).toThrow(AliasExpansionError)
    expect(() =>
      expandAliasArgv(
        ["bun", "index.ts", "first"],
        { first: ["second"], second: ["task", "list"] },
        { maximumDepth: 1 },
      ),
    ).toThrow("maximum depth")
  })

  test("does not expand tokens following the literal separator", () => {
    expect(expandAliasArgv(["bun", "index.ts", "--", "mine"], { mine: ["task", "list"] })).toEqual([
      "bun",
      "index.ts",
      "--",
      "mine",
    ])
  })
})

describe("configuration command registration", () => {
  test("registers the complete context and alias noun-verb surface", () => {
    const program = new Command()
    registerConfigurationCommands(program)
    const descriptors = Object.fromEntries(
      program.commands.map((command) => [
        command.name(),
        command.commands.map((child) => child.name()).sort(),
      ]),
    )
    expect(descriptors).toEqual({
      alias: ["list", "remove", "set"],
      context: ["list", "off", "use"],
    })
  })
})
