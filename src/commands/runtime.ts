import type { Command } from "commander"
import type { AppContext, GlobalOptions } from "../app/context"
import { type OperationResult, runOperation } from "../app/operation"

export type CommandHandler<T = unknown> = (context: AppContext) => Promise<OperationResult<T>>

export async function executeCommand(
  command: Command,
  handler: CommandHandler<unknown>,
): Promise<void> {
  const raw = command.optsWithGlobals() as Record<string, unknown>
  const options: GlobalOptions = {
    ...(raw as GlobalOptions),
    noInput: raw.noInput === true || raw.input === false,
  }
  process.exitCode = await runOperation(options, handler)
}

export function addWriteOptions(command: Command): Command {
  return command
    .option("--dry-run", "validate and show the request without writing")
    .option("--yes", "confirm a destructive operation")
}

export function addDateRangeOptions(command: Command): Command {
  return command.option("--from <date>", "inclusive start").option("--to <date>", "exclusive end")
}
