import { AppError, type AppErrorCode } from "../api/errors"
import {
  CliError,
  type EnvelopeMeta,
  type ErrorCode,
  envelopeFromError,
  exitCodeFor,
  successEnvelope,
} from "../output/contract"
import { type OutputMode, renderOutput } from "../output/render"
import type { GlobalOptions } from "./context"
import { AppContext } from "./context"

export interface OperationResult<T = unknown> {
  data: T
  meta?: EnvelopeMeta
  /** Human-mode bytes such as completion scripts or ICS; JSON still uses the envelope. */
  raw?: string
}

export type OperationHandler<T = unknown> = (context: AppContext) => Promise<OperationResult<T>>

export interface OperationIo {
  stdout: Pick<NodeJS.WriteStream, "write">
  stderr: Pick<NodeJS.WriteStream, "write">
}

const defaultIo: OperationIo = { stdout: process.stdout, stderr: process.stderr }

export async function runOperation<T>(
  options: GlobalOptions,
  handler: OperationHandler<T>,
  io: OperationIo = defaultIo,
): Promise<number> {
  let context: AppContext | undefined
  try {
    context = await AppContext.create(options)
    const result = await handler(context)
    const meta: EnvelopeMeta = {
      profile: context.profile.name,
      host: context.profile.host,
      source: "local",
      ...(result.meta ?? {}),
    }
    if (result.raw !== undefined && !options.json && !options.plain && !options.csv) {
      io.stdout.write(result.raw)
    } else {
      io.stdout.write(
        renderOutput(successEnvelope(result.data, meta), {
          mode: outputMode(options),
          fields: options.fields,
        }),
      )
    }
    emitDiagnostics(context, io)
    return 0
  } catch (error) {
    const cliError = normalizeCliError(error)
    const meta: EnvelopeMeta = context
      ? { profile: context.profile.name, host: context.profile.host }
      : {
          ...(options.profile ? { profile: options.profile } : {}),
          ...(options.host ? { host: options.host } : {}),
        }
    const envelope = envelopeFromError(cliError, meta)
    const rendered = renderOutput(envelope, {
      mode: options.json ? "json" : "human",
      fields: options.fields,
    })
    if (options.json) io.stdout.write(rendered)
    else io.stderr.write(rendered)
    if (context) emitDiagnostics(context, io)
    return cliError.exitCode
  } finally {
    context?.close()
  }
}

export function normalizeCliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  if (error instanceof AppError) {
    const code = outputCodeForAppError(error.code)
    return new CliError(code, error.message, error.details, { cause: error })
  }
  if (error instanceof Error) {
    if (
      error.name === "PathValidationError" ||
      error.name === "QuickAddSyntaxError" ||
      error.name === "RecurrenceSyntaxError"
    ) {
      return new CliError("invalid_input", error.message, {}, { cause: error })
    }
    if (error.name === "CredentialError" || error.name === "ConfigError") {
      return new CliError("config_error", error.message, {}, { cause: error })
    }
  }
  return new CliError(
    "internal_error",
    "An unexpected internal error occurred",
    {},
    { cause: error },
  )
}

export function outputCodeForAppError(code: AppErrorCode): ErrorCode {
  switch (code) {
    case "invalid_input":
      return "invalid_input"
    case "authentication_missing":
      return "auth_required"
    case "unauthorized":
      return "authentication_failed"
    case "forbidden":
      return "forbidden"
    case "capability_missing":
      return "capability_missing"
    case "host_unsupported":
      return "unsupported"
    case "credential_account_mismatch":
      return "credential_account_mismatch"
    case "not_found":
      return "not_found"
    case "ambiguous":
      return "ambiguous"
    case "conflict":
      return "conflict"
    case "partial_failure":
      return "partial_failure"
    case "rate_limited":
      return "rate_limited"
    case "network_error":
    case "server_error":
      return "network_error"
    case "write_outcome_unknown":
      return "write_outcome_unknown"
    case "protocol_error":
    case "redirect_rejected":
      return "protocol_error"
    case "token_not_user_bound":
      return "token_not_user_bound"
    case "local_state":
    case "internal_error":
      return code
  }
}

export function operationExitCode(error: unknown): number {
  return exitCodeFor(normalizeCliError(error).code)
}

function outputMode(options: GlobalOptions): OutputMode {
  if (options.json) return "json"
  if (options.csv) return "csv"
  if (options.plain) return "plain"
  return "human"
}

function emitDiagnostics(context: AppContext, io: OperationIo): void {
  if (!context.options.verbose) return
  for (const diagnostic of context.diagnostics) {
    io.stderr.write(`${JSON.stringify({ diagnostic })}\n`)
  }
}
