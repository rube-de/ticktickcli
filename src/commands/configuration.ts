import type { Command } from "commander"

import { AppError } from "../api/errors"
import {
  type AppConfig,
  type ContextConfig,
  normalizeContextName,
  saveConfig,
  validateConfigTokens,
} from "../config"
import {
  type AliasDefinitions,
  AliasExpansionError,
  type AliasExpansionOptions,
  expandAliasArgv as expandAliasArgvCore,
  normalizeAliasName,
  validateAliasDefinitions,
} from "../core/aliases"
import { topLevelCommands } from "./metadata"
import type { CommandHandler } from "./runtime"

export { AliasExpansionError } from "../core/aliases"
export type { AliasDefinitions, AliasExpansionOptions } from "../core/aliases"

/**
 * Expand configured aliases as argv tokens. The returned array is passed
 * directly to Commander; neither alias names nor values are evaluated by a shell.
 */
export function expandAliasArgv(
  argv: readonly string[],
  aliases: AliasDefinitions,
  options: Omit<AliasExpansionOptions, "prefixLength"> = {},
): string[] {
  return expandAliasArgvCore(argv, aliases, options)
}

export function expandConfiguredAliasArgv(
  argv: readonly string[],
  config: Pick<AppConfig, "aliases">,
  options: Omit<AliasExpansionOptions, "prefixLength"> = {},
): string[] {
  return expandAliasArgvCore(argv, config.aliases, options)
}

export function registerConfigurationCommands(program: Command): void {
  registerContexts(program)
  registerAliases(program)
}

async function executeCommand<T>(command: Command, handler: CommandHandler<T>): Promise<void> {
  const runtime = await import("./runtime")
  await runtime.executeCommand(command, handler)
}

function registerContexts(program: Command): void {
  const contextCommand = program.command("context").description("Manage saved command defaults")

  contextCommand.command("list").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => ({
      data: Object.entries(context.config.contexts)
        .map(([name, value]) => ({
          name,
          tokens: value.tokens,
          active: name === context.config.activeContext,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      meta: context.metadata("local"),
    }))
  })

  contextCommand
    .command("use")
    .description("Select a saved context, optionally defining its default tokens")
    .argument("<name>")
    .argument("[tokens...]", "argv default tokens to save for this context")
    .option("--dry-run", "validate and show the config change without writing")
    .action(async (nameValue: string, tokensValue: string[], _options, command: Command) => {
      await executeCommand<Record<string, unknown>>(command, async (context) => {
        const name = contextNameFromInput(nameValue)
        const tokens = Array.isArray(tokensValue) ? tokensValue : []
        const existing = context.config.contexts[name]
        if (!existing && tokens.length === 0) {
          throw new AppError(
            "not_found",
            `Context not found: ${name}; supply default tokens to create it`,
          )
        }

        let definition: ContextConfig
        if (tokens.length > 0) {
          definition = {
            tokens: configTokensFromInput(tokens, `contexts.${name}.tokens`),
          }
        } else {
          if (!existing) throw new AppError("not_found", `Context not found: ${name}`)
          definition = existing
        }
        const next = {
          ...context.config,
          contexts: { ...context.config.contexts, [name]: definition },
          activeContext: name,
        }
        const dryRun = command.opts().dryRun === true
        if (!dryRun) await saveConfig(next, context.paths.configFile)
        return {
          data: {
            ...(dryRun ? { dryRun: true } : {}),
            activeContext: name,
            tokens: definition.tokens,
            created: existing === undefined,
            updated: tokens.length > 0,
          },
          meta: context.metadata("local"),
        }
      })
    })

  contextCommand
    .command("off")
    .description("Disable the active context without deleting it")
    .option("--dry-run", "validate and show the config change without writing")
    .action(async (_options, command: Command) => {
      await executeCommand<Record<string, unknown>>(command, async (context) => {
        const previous = context.config.activeContext
        const dryRun = command.opts().dryRun === true
        if (previous !== null && !dryRun) {
          await saveConfig({ ...context.config, activeContext: null }, context.paths.configFile)
        }
        return {
          data: {
            ...(dryRun ? { dryRun: true } : {}),
            activeContext: null,
            previous,
            changed: previous !== null,
          },
          meta: context.metadata("local"),
        }
      })
    })
}

function registerAliases(program: Command): void {
  const aliasCommand = program.command("alias").description("Manage token-only CLI aliases")

  aliasCommand.command("list").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => ({
      data: Object.entries(context.config.aliases)
        .map(([name, tokens]) => ({ name, tokens }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      meta: context.metadata("local"),
    }))
  })

  aliasCommand
    .command("set")
    .description("Set an alias to an argv token sequence")
    .argument("<name>")
    .argument("<tokens...>", "tokens to substitute for the alias")
    .option("--dry-run", "validate and show the config change without writing")
    .action(async (nameValue: string, tokensValue: string[], _options, command: Command) => {
      await executeCommand<Record<string, unknown>>(command, async (context) => {
        const name = aliasNameFromInput(nameValue)
        if (topLevelCommands().includes(name)) {
          throw new AppError("conflict", `Alias cannot replace a canonical command: ${name}`)
        }
        const tokens = configTokensFromInput(tokensValue, `aliases.${name}`, false)
        const aliases = { ...context.config.aliases, [name]: tokens }
        try {
          validateAliasDefinitions(aliases)
        } catch (cause) {
          if (cause instanceof AliasExpansionError) {
            throw new AppError("invalid_input", cause.message, { cause })
          }
          throw cause
        }
        const dryRun = command.opts().dryRun === true
        if (!dryRun) await saveConfig({ ...context.config, aliases }, context.paths.configFile)
        return {
          data: {
            ...(dryRun ? { dryRun: true } : {}),
            name,
            tokens,
            replaced: context.config.aliases[name] !== undefined,
          },
          meta: context.metadata("local"),
        }
      })
    })

  aliasCommand
    .command("remove")
    .description("Remove a saved alias")
    .argument("<name>")
    .option("--dry-run", "validate and show the config change without writing")
    .action(async (nameValue: string, _options, command: Command) => {
      await executeCommand<Record<string, unknown>>(command, async (context) => {
        const name = aliasNameFromInput(nameValue)
        if (!context.config.aliases[name]) {
          throw new AppError("not_found", `Alias not found: ${name}`)
        }
        const aliases = Object.fromEntries(
          Object.entries(context.config.aliases).filter(([candidate]) => candidate !== name),
        )
        const dryRun = command.opts().dryRun === true
        if (!dryRun) await saveConfig({ ...context.config, aliases }, context.paths.configFile)
        return {
          data: { ...(dryRun ? { dryRun: true } : {}), removed: name },
          meta: context.metadata("local"),
        }
      })
    })
}

function contextNameFromInput(value: string): string {
  try {
    return normalizeContextName(value)
  } catch (cause) {
    throw new AppError("invalid_input", `Invalid context name: ${value}`, { cause })
  }
}

function aliasNameFromInput(value: string): string {
  try {
    return normalizeAliasName(value)
  } catch (cause) {
    throw new AppError("invalid_input", `Invalid alias name: ${value}`, { cause })
  }
}

function configTokensFromInput(value: unknown, label: string, allowEmpty = true): string[] {
  try {
    return validateConfigTokens(value, label, allowEmpty)
  } catch (cause) {
    throw new AppError("invalid_input", `Invalid tokens for ${label}`, { cause })
  }
}
