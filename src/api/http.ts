import type { ZodType } from "zod"
import {
  AppError,
  HttpError,
  ProtocolError,
  WriteOutcomeUnknownError,
  appErrorCodeForHttpStatus,
  messageForHttpError,
  semanticErrorCode,
} from "./errors"
import { redactHeaders, redactUrl, redactValue } from "./redact"

export type ResponseMode = "JSON_REQUIRED" | "JSON_OPTIONAL" | "NO_CONTENT"
export type RetryMode = "read" | "idempotent" | "reconcilable" | "never"
export type QueryValue = string | number | boolean | null | undefined

export interface HttpDiagnostic {
  phase: "request" | "response" | "retry"
  method: string
  url: string
  attempt: number
  status?: number
  delayMs?: number
  headers?: Record<string, string>
  body?: unknown
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ApiHttpClientOptions {
  baseUrl: string
  headers?: HeadersInit
  fetch?: FetchLike
  timeoutMs?: number
  maxReadRetries?: number
  maxRetryDelayMs?: number
  /** Positive values serialize and conservatively space read requests. */
  readsPerSecond?: number
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
  now?: () => number
  onDiagnostic?: (diagnostic: HttpDiagnostic) => void
}

export interface HttpRequestOptions<T> {
  method?: string
  query?: Readonly<Record<string, QueryValue | readonly QueryValue[]>>
  headers?: HeadersInit
  json?: unknown
  body?: BodyInit
  responseMode?: ResponseMode
  schema?: ZodType<T>
  retry?: RetryMode
  timeoutMs?: number
  signal?: AbortSignal
  operation?: string
}

export class ApiHttpClient {
  readonly baseUrl: URL
  private readonly defaultHeaders: Headers
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number
  private readonly maxReadRetries: number
  private readonly maxRetryDelayMs: number
  private readonly sleepImpl: (milliseconds: number) => Promise<void>
  private readonly random: () => number
  private readonly now: () => number
  private readonly onDiagnostic?: (diagnostic: HttpDiagnostic) => void
  private readonly readIntervalMs: number
  private nextReadAt = 0
  private readQueue: Promise<void> = Promise.resolve()

  constructor(options: ApiHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.defaultHeaders = new Headers(options.headers)
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxReadRetries = options.maxReadRetries ?? 2
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000
    this.sleepImpl = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds))
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
    this.onDiagnostic = options.onDiagnostic
    this.readIntervalMs =
      options.readsPerSecond && options.readsPerSecond > 0
        ? Math.ceil(1000 / options.readsPerSecond)
        : 0
  }

  async request<T>(path: string, options: HttpRequestOptions<T> = {}): Promise<T | undefined> {
    if (options.json !== undefined && options.body !== undefined) {
      throw new AppError("invalid_input", "A request cannot contain both json and body")
    }

    const method = (options.method ?? "GET").toUpperCase()
    const responseMode = options.responseMode ?? "JSON_REQUIRED"
    const retryMode = options.retry ?? (method === "GET" || method === "HEAD" ? "read" : "never")
    const url = buildApiUrl(this.baseUrl, path, options.query)
    const headers = mergeHeaders(this.defaultHeaders, options.headers)
    let body = options.body
    if (options.json !== undefined) {
      headers.set("content-type", "application/json")
      try {
        body = JSON.stringify(options.json)
      } catch (cause) {
        throw new AppError("invalid_input", "The request body is not JSON serializable", { cause })
      }
    }

    const attempts = canAutomaticallyRetry(retryMode) ? this.maxReadRetries + 1 : 1
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      this.diagnostic({
        phase: "request",
        method,
        url: redactUrl(url),
        attempt,
        headers: redactHeaders(headers),
        ...(options.json === undefined ? {} : { body: redactValue(options.json) }),
      })

      try {
        await this.throttleRead(method)
        const response = await this.fetchOnce(url, {
          method,
          headers,
          body,
          redirect: "manual",
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? this.timeoutMs,
        })
        const text = await response.text()
        const parsedBody = parseJsonIfPossible(text)

        this.diagnostic({
          phase: "response",
          method,
          url: redactUrl(url),
          attempt,
          status: response.status,
          headers: redactHeaders(response.headers),
          ...(text.length === 0 ? {} : { body: redactValue(parsedBody ?? text) }),
        })

        if (response.redirected || isRedirectStatus(response.status)) {
          throw new AppError("redirect_rejected", "API redirects are not followed", {
            details: { method, path: url.pathname, status: response.status },
          })
        }

        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), this.now())
          if (attempt < attempts && isRetryableStatus(response.status)) {
            const delayMs = this.retryDelay(attempt, retryAfterMs)
            this.diagnostic({
              phase: "retry",
              method,
              url: redactUrl(url),
              attempt,
              status: response.status,
              delayMs,
            })
            await this.sleepImpl(delayMs)
            continue
          }

          const safeBody = redactValue(parsedBody ?? text)
          throw new HttpError(
            appErrorCodeForHttpStatus(response.status),
            messageForHttpError(response.status, parsedBody),
            {
              status: response.status,
              method,
              path: `${url.pathname}${url.search}`,
              responseBody: safeBody,
              retryAfterMs,
              semanticCode: semanticErrorCode(parsedBody),
            },
          )
        }

        return parseSuccessBody(text, responseMode, options.schema, {
          method,
          path: `${url.pathname}${url.search}`,
          status: response.status,
          operation: options.operation,
        })
      } catch (cause) {
        if (cause instanceof AppError) throw cause
        if (attempt < attempts) {
          const delayMs = this.retryDelay(attempt)
          this.diagnostic({
            phase: "retry",
            method,
            url: redactUrl(url),
            attempt,
            delayMs,
          })
          await this.sleepImpl(delayMs)
          continue
        }

        if (retryMode === "never" || retryMode === "reconcilable") {
          throw new WriteOutcomeUnknownError(method, `${url.pathname}${url.search}`, cause)
        }
        throw new AppError("network_error", "The API request failed", {
          details: { method, path: `${url.pathname}${url.search}` },
          retryable: true,
          cause,
        })
      }
    }

    throw new AppError("internal_error", "The HTTP retry loop exited unexpectedly")
  }

  private async fetchOnce(
    url: URL,
    options: Omit<RequestInit, "signal"> & { signal?: AbortSignal; timeoutMs: number },
  ): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) abortFromCaller()
    else options.signal?.addEventListener("abort", abortFromCaller, { once: true })

    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error("Request timed out"))
    }, options.timeoutMs)

    try {
      const { timeoutMs: _timeoutMs, ...init } = options
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } catch (cause) {
      if (timedOut) {
        throw new Error(`Request timed out after ${options.timeoutMs}ms`, { cause })
      }
      throw cause
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", abortFromCaller)
    }
  }

  private retryDelay(attempt: number, retryAfterMs?: number): number {
    const exponential = Math.min(this.maxRetryDelayMs, 500 * 2 ** (attempt - 1))
    const jittered = Math.round(exponential * (0.5 + this.random() * 0.5))
    return Math.min(this.maxRetryDelayMs, retryAfterMs ?? jittered)
  }

  private diagnostic(diagnostic: HttpDiagnostic): void {
    this.onDiagnostic?.(diagnostic)
  }

  private async throttleRead(method: string): Promise<void> {
    if (this.readIntervalMs === 0 || (method !== "GET" && method !== "HEAD")) return
    const slot = this.readQueue.then(async () => {
      const delay = Math.max(0, this.nextReadAt - this.now())
      if (delay > 0) await this.sleepImpl(delay)
      this.nextReadAt = Math.max(this.nextReadAt, this.now()) + this.readIntervalMs
    })
    this.readQueue = slot.catch(() => undefined)
    await slot
  }
}

export function buildApiUrl(
  baseUrl: URL | string,
  path: string,
  query?: Readonly<Record<string, QueryValue | readonly QueryValue[]>>,
): URL {
  const base = typeof baseUrl === "string" ? normalizeBaseUrl(baseUrl) : baseUrl
  const cleanPath = validateRelativeApiPath(path)
  const separator = base.pathname.endsWith("/") ? "" : "/"
  const url = new URL(base.toString())
  const [pathPart = "", queryPart] = cleanPath.split("?", 2)
  url.pathname = `${base.pathname}${separator}${pathPart.replace(/^\/+/, "")}`
  url.search = queryPart ?? ""
  url.hash = ""

  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      const values = Array.isArray(raw) ? raw : [raw]
      for (const value of values) {
        if (value !== undefined && value !== null) url.searchParams.append(key, String(value))
      }
    }
  }
  if (url.origin !== base.origin) throw new AppError("invalid_input", "API path changed origin")
  return url
}

export function validateRelativeApiPath(path: string): string {
  if (path.length === 0) throw new AppError("invalid_input", "API path cannot be empty")
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) {
    throw new AppError("invalid_input", "API paths must be relative to the configured origin")
  }
  if (/[\\\r\n\0]/.test(path) || path.includes("#")) {
    throw new AppError("invalid_input", "API path contains forbidden characters")
  }

  const pathOnly = path.split("?", 1)[0] ?? ""
  for (const rawSegment of pathOnly.split("/")) {
    let segment: string
    try {
      segment = decodeURIComponent(rawSegment)
    } catch (cause) {
      throw new AppError("invalid_input", "API path contains invalid encoding", { cause })
    }
    if (segment === "." || segment === "..") {
      throw new AppError("invalid_input", "API path traversal is not allowed")
    }
  }
  return path
}

export function parseRetryAfter(value: string | null, nowMs = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - nowMs)
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new AppError("invalid_input", "API base URL must use HTTPS")
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AppError(
      "invalid_input",
      "API base URL cannot contain credentials, query, or fragment",
    )
  }
  url.pathname = url.pathname.replace(/\/+$/, "")
  return url
}

function mergeHeaders(defaults: Headers, additional?: HeadersInit): Headers {
  const headers = new Headers(defaults)
  if (additional) {
    for (const [key, value] of new Headers(additional).entries()) headers.set(key, value)
  }
  headers.set("accept", "application/json")
  return headers
}

function parseSuccessBody<T>(
  text: string,
  mode: ResponseMode,
  schema: ZodType<T> | undefined,
  context: Readonly<Record<string, unknown>>,
): T | undefined {
  if (mode === "NO_CONTENT") return undefined
  if (text.trim().length === 0) {
    if (mode === "JSON_OPTIONAL") return undefined
    throw new ProtocolError("The API returned an empty body where JSON was required", context)
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new ProtocolError("The API returned invalid JSON", context, cause)
  }

  if (!schema) return value as T
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ProtocolError("The API response did not match the expected schema", {
      ...context,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    })
  }
  return result.data
}

function parseJsonIfPossible(text: string): unknown {
  if (text.trim().length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function canAutomaticallyRetry(mode: RetryMode): boolean {
  return mode === "read" || mode === "idempotent"
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400
}
