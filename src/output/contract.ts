export const CONTRACT_VERSION = 1 as const

export const EXIT_CODES = {
  SUCCESS: 0,
  USAGE: 2,
  AUTH_OR_CAPABILITY: 3,
  NOT_FOUND_OR_AMBIGUOUS: 4,
  CONFLICT_OR_PARTIAL: 5,
  NETWORK_OR_UNKNOWN_WRITE: 6,
  PROTOCOL: 7,
  LOCAL_STATE: 8,
} as const

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]

export type ErrorCode =
  | "invalid_input"
  | "auth_required"
  | "authentication_failed"
  | "capability_missing"
  | "credential_account_mismatch"
  | "token_not_user_bound"
  | "forbidden"
  | "not_found"
  | "ambiguous"
  | "prefix_too_short"
  | "conflict"
  | "partial_failure"
  | "network_error"
  | "rate_limited"
  | "write_outcome_unknown"
  | "protocol_error"
  | "schema_drift"
  | "local_state"
  | "config_error"
  | "storage_error"
  | "unsupported"
  | "internal_error"

export type OutputSource = "v1" | "v2" | "cache" | "local"

export interface EnvelopeMeta {
  profile?: string
  host?: string
  source?: OutputSource
  stale?: boolean
  fetchedAt?: string
  warnings?: readonly string[]
  [key: string]: unknown
}

export interface SuccessEnvelope<T> {
  version: typeof CONTRACT_VERSION
  ok: true
  data: T
  meta: EnvelopeMeta
}

export interface ErrorDescription {
  code: ErrorCode
  message: string
  details: Readonly<Record<string, unknown>>
}

export interface ErrorEnvelope {
  version: typeof CONTRACT_VERSION
  ok: false
  error: ErrorDescription
  meta: EnvelopeMeta
}

export type OutputEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope

export function exitCodeFor(errorCode: ErrorCode): ExitCode {
  switch (errorCode) {
    case "invalid_input":
      return EXIT_CODES.USAGE
    case "auth_required":
    case "authentication_failed":
    case "capability_missing":
    case "credential_account_mismatch":
    case "token_not_user_bound":
    case "forbidden":
    case "unsupported":
      return EXIT_CODES.AUTH_OR_CAPABILITY
    case "not_found":
    case "ambiguous":
    case "prefix_too_short":
      return EXIT_CODES.NOT_FOUND_OR_AMBIGUOUS
    case "conflict":
    case "partial_failure":
      return EXIT_CODES.CONFLICT_OR_PARTIAL
    case "network_error":
    case "rate_limited":
    case "write_outcome_unknown":
      return EXIT_CODES.NETWORK_OR_UNKNOWN_WRITE
    case "protocol_error":
    case "schema_drift":
      return EXIT_CODES.PROTOCOL
    case "local_state":
    case "config_error":
    case "storage_error":
    case "internal_error":
      return EXIT_CODES.LOCAL_STATE
  }
}

export class CliError extends Error {
  readonly code: ErrorCode
  readonly details: Readonly<Record<string, unknown>>
  readonly exitCode: ExitCode

  constructor(
    code: ErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "CliError"
    this.code = code
    this.details = details
    this.exitCode = exitCodeFor(code)
  }
}

export function successEnvelope<T>(data: T, meta: EnvelopeMeta = {}): SuccessEnvelope<T> {
  return { version: CONTRACT_VERSION, ok: true, data, meta }
}

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  meta: EnvelopeMeta = {},
): ErrorEnvelope {
  return {
    version: CONTRACT_VERSION,
    ok: false,
    error: { code, message, details },
    meta,
  }
}

export function envelopeFromError(error: unknown, meta: EnvelopeMeta = {}): ErrorEnvelope {
  if (error instanceof CliError)
    return errorEnvelope(error.code, error.message, error.details, meta)
  return errorEnvelope("internal_error", "An unexpected internal error occurred", {}, meta)
}
