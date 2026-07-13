const REDACTED = "[REDACTED]"

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "x-xsrf-token",
  "proxy-authorization",
])

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "session",
  "sessiontoken",
  "sessioncookie",
  "authorization",
  "cookie",
  "csrf",
  "csrftoken",
  "xsrf",
  "xsrftoken",
  "clientsecret",
  "password",
  "passwd",
  "email",
])
const TOKEN_QUERY_KEY = /^(?:access_token|refresh_token|session_token|token|t|code|client_secret)$/i
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const COOKIE_PATTERN = /\b(?:t|session|token|access_token|refresh_token)=([^;\s]+)/gi

export function redactHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  const output: Record<string, string> = {}
  const normalized = new Headers(headers)
  for (const [name, value] of normalized.entries()) {
    output[name] = SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? REDACTED : redactText(value)
  }
  return output
}

export function redactUrl(value: string | URL): string {
  let url: URL
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value)
  } catch {
    return redactText(String(value))
  }

  if (url.username) url.username = REDACTED
  if (url.password) url.password = REDACTED
  for (const [key, queryValue] of [...url.searchParams.entries()]) {
    url.searchParams.set(key, TOKEN_QUERY_KEY.test(key) ? REDACTED : redactText(queryValue))
  }
  return url.toString()
}

export function redactText(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(COOKIE_PATTERN, (match) => `${match.slice(0, match.indexOf("=") + 1)}${REDACTED}`)
    .replace(EMAIL_PATTERN, REDACTED)
}

export function redactValue(value: unknown): unknown {
  return redactValueInternal(value, new WeakSet<object>())
}

function redactValueInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactText(value)
  if (value === null || typeof value !== "object") return value
  if (value instanceof URL) return redactUrl(value)
  if (value instanceof Headers) return redactHeaders(value)
  if (seen.has(value)) return "[Circular]"
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactValueInternal(item, seen))
  }

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValueInternal(item, seen)
  }
  return output
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.replaceAll("_", "").replaceAll("-", "").toLowerCase())
}

/** Prevent remote text from injecting terminal control sequences. */
export function neutralizeTerminalText(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "�")
}

export { REDACTED }
