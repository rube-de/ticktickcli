#!/usr/bin/env bun

import { Command, CommanderError } from "commander"
import { hoistGlobalOptions } from "./app/argv"
import { normalizeCliError } from "./app/operation"
import { registerAuthCommands } from "./commands/auth"
import { expandConfiguredAliasArgv, registerConfigurationCommands } from "./commands/configuration"
import { registerExtensionCommands } from "./commands/extensions"
import { registerFocusCommands } from "./commands/focus"
import { registerHabitCommands } from "./commands/habit"
import { COMMAND_METADATA } from "./commands/metadata"
import { registerOperationCommands } from "./commands/operations"
import { registerOrganizationCommands } from "./commands/organization"
import { registerProjectCommands } from "./commands/project"
import { registerTaskCommands } from "./commands/task"
import { registerViewCommands } from "./commands/views"
import { type AppConfig, loadConfig } from "./config"
import { errorEnvelope } from "./output/contract"
import { renderOutput } from "./output/render"
import { resolvePaths } from "./platform/paths"

export const VERSION = "0.0.1"

export function createProgram(): Command {
  const program = new Command()
    .name("tt")
    .description("Agent-first TickTick CLI")
    .version(VERSION)
    .showHelpAfterError()
    .allowExcessArguments(false)
    .option("--json", "emit one versioned JSON envelope")
    .option("--fields <fields>", "comma-separated output fields")
    .option("--plain", "emit tab-separated plain output")
    .option("--csv", "emit RFC-compatible CSV")
    .option("--profile <name>", "profile name")
    .option("--host <host>", "ticktick.com or dida365.com")
    .option("--timezone <iana>", "override the profile timezone")
    .option("--fresh", "force a network refresh")
    .option("--stale-ok", "allow stale cached data without refreshing")
    .option("--offline", "forbid all network access")
    .option("--no-input", "never prompt or launch interactive UI")
    .option("--verbose", "emit redacted diagnostics to stderr")

  registerAuthCommands(program)
  registerTaskCommands(program)
  registerProjectCommands(program)
  registerOrganizationCommands(program)
  registerViewCommands(program)
  registerExtensionCommands(program)
  registerHabitCommands(program)
  registerFocusCommands(program)
  registerOperationCommands(program)
  registerConfigurationCommands(program)
  return program
}

export async function main(argvValue: readonly string[] = process.argv): Promise<number> {
  let argv = [...argvValue]
  let config: AppConfig | undefined
  try {
    config = await loadConfig(resolvePaths().configFile)
    argv = expandConfiguredAliasArgv(argv, config)
    argv = applyActiveContext(argv, config)
    argv = hoistGlobalOptions(argv)
  } catch (error) {
    return renderStartupError(error, argv)
  }

  const json = hasOption(argv, "--json")
  const program = createProgram().exitOverride()
  program.configureOutput({
    writeErr: (text) => {
      if (!json) process.stderr.write(text)
    },
  })
  if (argv.length <= 2) {
    program.outputHelp()
    return 0
  }
  try {
    await program.parseAsync(argv, { from: "node" })
    return process.exitCode === undefined ? 0 : Number(process.exitCode)
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0
    const message = error instanceof Error ? error.message : "Invalid command invocation"
    if (json) {
      process.stdout.write(renderOutput(errorEnvelope("invalid_input", message), { mode: "json" }))
    }
    return error instanceof CommanderError ? (error.exitCode === 1 ? 2 : error.exitCode) : 2
  }
}

function applyActiveContext(argv: readonly string[], config: AppConfig): string[] {
  const name = config.activeContext
  if (!name) return [...argv]
  const context = config.contexts[name]
  if (!context || context.tokens.length === 0) return [...argv]

  const commandIndex = firstCommandIndex(argv)
  if (commandIndex === undefined) return [...argv]
  const root = argv[commandIndex]
  if (!root || ["context", "alias", "auth", "profile", "config", "completion"].includes(root)) {
    return [...argv]
  }
  const pathLength = longestCommandPath(argv.slice(commandIndex))
  const insertion = commandIndex + pathLength
  return [...argv.slice(0, insertion), ...context.tokens, ...argv.slice(insertion)]
}

function firstCommandIndex(argv: readonly string[]): number | undefined {
  const booleanOptions = new Set([
    "--json",
    "--plain",
    "--csv",
    "--fresh",
    "--stale-ok",
    "--offline",
    "--no-input",
    "--verbose",
  ])
  const valueOptions = new Set(["--fields", "--profile", "--host", "--timezone"])
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token || token === "--") return undefined
    const name = token.split("=", 1)[0] as string
    if (booleanOptions.has(name)) continue
    if (valueOptions.has(name)) {
      if (!token.includes("=")) index += 1
      continue
    }
    if (token.startsWith("-")) return undefined
    return index
  }
  return undefined
}

function longestCommandPath(tokens: readonly string[]): number {
  let length = 1
  for (const descriptor of COMMAND_METADATA) {
    if (
      descriptor.path.length > length &&
      descriptor.path.every((part, index) => tokens[index] === part)
    ) {
      length = descriptor.path.length
    }
  }
  return length
}

function hasOption(argv: readonly string[], name: string): boolean {
  return argv.slice(2).some((token) => token === name || token.startsWith(`${name}=`))
}

function renderStartupError(error: unknown, argv: readonly string[]): number {
  const cliError = normalizeCliError(error)
  if (hasOption(argv, "--json")) {
    process.stdout.write(
      renderOutput(errorEnvelope(cliError.code, cliError.message, cliError.details), {
        mode: "json",
      }),
    )
  } else {
    process.stderr.write(`${cliError.message}\n`)
  }
  return cliError.exitCode
}

if (import.meta.main) process.exitCode = await main()
