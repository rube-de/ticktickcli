export type AppErrorCode =
  | "invalid_input"
  | "authentication_missing"
  | "unauthorized"
  | "forbidden"
  | "capability_missing"
  | "host_unsupported"
  | "credential_account_mismatch"
  | "not_found"
  | "ambiguous"
  | "conflict"
  | "partial_failure"
  | "rate_limited"
  | "network_error"
  | "server_error"
  | "write_outcome_unknown"
  | "protocol_error"
  | "redirect_rejected"
  | "token_not_user_bound"
  | "local_state"
  | "internal_error"

export type ErrorDetails = Readonly<Record<string, unknown>>

export interface SerializedAppError {
  code: AppErrorCode
  message: string
  details: ErrorDetails
}

/**
 * Stable application error used at the API/app boundary. It intentionally does
 * not expose credentials, raw response bodies, or stack traces in `toJSON()`.
 */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly details: ErrorDetails
  readonly retryable: boolean

  constructor(
    code: AppErrorCode,
    message: string,
    options: {
      details?: ErrorDetails
      retryable?: boolean
      cause?: unknown
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "AppError"
    this.code = code
    this.details = options.details ?? {}
    this.retryable = options.retryable ?? false
  }

  toJSON(): SerializedAppError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

export interface HttpErrorOptions {
  status: number
  method: string
  path: string
  responseBody?: unknown
  retryAfterMs?: number
  semanticCode?: string
  cause?: unknown
}

export class HttpError extends AppError {
  readonly status: number
  readonly method: string
  readonly path: string
  /** This value must already be redacted by the HTTP layer. */
  readonly responseBody?: unknown
  readonly retryAfterMs?: number
  readonly semanticCode?: string

  constructor(code: AppErrorCode, message: string, options: HttpErrorOptions) {
    const details: Record<string, unknown> = {
      status: options.status,
      method: options.method,
      path: options.path,
    }
    if (options.retryAfterMs !== undefined) details.retryAfterMs = options.retryAfterMs
    if (options.semanticCode !== undefined) details.semanticCode = options.semanticCode

    super(code, message, {
      details,
      retryable: code === "rate_limited" || code === "server_error" || code === "network_error",
      cause: options.cause,
    })
    this.name = "HttpError"
    this.status = options.status
    this.method = options.method
    this.path = options.path
    this.responseBody = options.responseBody
    this.retryAfterMs = options.retryAfterMs
    this.semanticCode = options.semanticCode
  }
}

export class ProtocolError extends AppError {
  constructor(message: string, details: ErrorDetails = {}, cause?: unknown) {
    super("protocol_error", message, { details, cause })
    this.name = "ProtocolError"
  }
}

export class CapabilityError extends AppError {
  constructor(
    code: "capability_missing" | "host_unsupported" | "authentication_missing",
    message: string,
    details: ErrorDetails = {},
  ) {
    super(code, message, { details })
    this.name = "CapabilityError"
  }
}

export interface ItemFailure {
  id: string
  code: string
  message: string
}

export class PartialFailureError extends AppError {
  readonly failures: readonly ItemFailure[]
  readonly successes: readonly string[]

  constructor(
    message: string,
    failures: readonly ItemFailure[],
    successes: readonly string[] = [],
  ) {
    super("partial_failure", message, {
      details: { failures, successes },
    })
    this.name = "PartialFailureError"
    this.failures = failures
    this.successes = successes
  }
}

export class WriteOutcomeUnknownError extends AppError {
  constructor(method: string, path: string, cause?: unknown) {
    super("write_outcome_unknown", "The server may have applied the write", {
      details: {
        method,
        path,
        guidance: "Reconcile the resource before retrying.",
      },
      cause,
    })
    this.name = "WriteOutcomeUnknownError"
  }
}

/** A write returned success, but its required readback could not establish final state. */
export class ReconciliationUnknownError extends AppError {
  constructor(
    operation: string,
    identifiers: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super("write_outcome_unknown", "The write was accepted but reconciliation did not complete", {
      details: {
        operation,
        ...identifiers,
        guidance: "Read the affected resource before retrying the mutation.",
      },
      cause,
    })
    this.name = "ReconciliationUnknownError"
  }
}

export async function reconcileAfterWrite<T>(
  operation: string,
  identifiers: Readonly<Record<string, unknown>>,
  readback: () => Promise<T>,
): Promise<T> {
  try {
    return await readback()
  } catch (cause) {
    if (cause instanceof ReconciliationUnknownError) throw cause
    throw new ReconciliationUnknownError(operation, identifiers, cause)
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

export function semanticErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const record = body as Record<string, unknown>
  for (const key of ["errorCode", "code", "error_code"] as const) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

export function semanticErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const record = body as Record<string, unknown>
  for (const key of ["errorMessage", "message", "error_description", "error"] as const) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

export function appErrorCodeForHttpStatus(status: number): AppErrorCode {
  switch (status) {
    case 401:
      return "unauthorized"
    case 403:
      // A private API 403 is deliberately generic unless a verified mapping says otherwise.
      return "forbidden"
    case 404:
      return "not_found"
    case 408:
    case 429:
      return "rate_limited"
    case 409:
      return "conflict"
    default:
      return status >= 500 ? "server_error" : "invalid_input"
  }
}

export function messageForHttpError(status: number, body: unknown): string {
  return (
    semanticErrorMessage(body) ??
    {
      401: "Authentication was rejected",
      403: "The operation is forbidden",
      404: "The requested resource was not found",
      408: "The request timed out",
      409: "The request conflicts with current remote state",
      429: "The service rate limit was exceeded",
    }[status] ??
    (status >= 500 ? "The service returned an error" : "The request was rejected")
  )
}

export function isUserUnboundTokenSignature(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status === 500 &&
    error.semanticCode?.toLowerCase() === "unknown_exception"
  )
}
