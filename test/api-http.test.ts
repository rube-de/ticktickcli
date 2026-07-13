import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { AppError, HttpError, ProtocolError, WriteOutcomeUnknownError } from "../src/api/errors"
import { ApiHttpClient, buildApiUrl, parseRetryAfter } from "../src/api/http"
import {
  REDACTED,
  neutralizeTerminalText,
  redactHeaders,
  redactUrl,
  redactValue,
} from "../src/api/redact"
import { createSequenceFetch, emptyResponse, jsonResponse } from "./api-test-helpers"

describe("ApiHttpClient", () => {
  test("keeps requests under the configured API base path", () => {
    expect(
      buildApiUrl("https://api.ticktick.com/open/v1", "/project", { limit: 5 }).toString(),
    ).toBe("https://api.ticktick.com/open/v1/project?limit=5")
    expect(() => buildApiUrl("https://api.ticktick.com/open/v1", "https://evil.test/x")).toThrow(
      AppError,
    )
    expect(() => buildApiUrl("https://api.ticktick.com/open/v1", "/../api/v2/user")).toThrow(
      AppError,
    )
    expect(() => buildApiUrl("https://api.ticktick.com/open/v1", "/%2e%2e/secret")).toThrow(
      AppError,
    )
  })

  test("enforces endpoint-specific empty-body modes", async () => {
    const requiredMock = createSequenceFetch([emptyResponse(200)])
    const required = new ApiHttpClient({
      baseUrl: "https://api.ticktick.com/open/v1",
      fetch: requiredMock.fetch,
    })
    expect(required.request("/project", { responseMode: "JSON_REQUIRED" })).rejects.toBeInstanceOf(
      ProtocolError,
    )

    const optionalMock = createSequenceFetch([emptyResponse(201), emptyResponse(204)])
    const optional = new ApiHttpClient({
      baseUrl: "https://api.ticktick.com/open/v1",
      fetch: optionalMock.fetch,
    })
    expect(await optional.request("/task", { responseMode: "JSON_OPTIONAL" })).toBeUndefined()
    expect(await optional.request("/task", { responseMode: "NO_CONTENT" })).toBeUndefined()
  })

  test("retains additive fields and rejects missing required structure", async () => {
    const schema = z.object({ id: z.string() }).passthrough()
    const mock = createSequenceFetch([
      jsonResponse({ id: "a", future: { enabled: true } }),
      jsonResponse({ future: true }),
    ])
    const http = new ApiHttpClient({
      baseUrl: "https://api.ticktick.com/api/v2",
      fetch: mock.fetch,
    })
    expect(await http.request("/task/a", { schema })).toEqual({
      id: "a",
      future: { enabled: true },
    })
    expect(http.request("/task/b", { schema })).rejects.toBeInstanceOf(ProtocolError)
  })

  test("honors Retry-After for retryable reads", async () => {
    const mock = createSequenceFetch([
      jsonResponse(
        { errorCode: "exceed_query_limit" },
        { status: 429, headers: { "retry-after": "2" } },
      ),
      jsonResponse({ ok: true }),
    ])
    const delays: number[] = []
    const http = new ApiHttpClient({
      baseUrl: "https://api.ticktick.com/open/v1",
      fetch: mock.fetch,
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
      maxReadRetries: 1,
    })
    expect(await http.request<{ ok: boolean }>("/project")).toEqual({ ok: true })
    expect(delays).toEqual([2000])
    expect(mock.requests).toHaveLength(2)
  })

  test("does not retry an ambiguous write transport failure", async () => {
    let calls = 0
    const http = new ApiHttpClient({
      baseUrl: "https://api.ticktick.com/open/v1",
      fetch: async () => {
        calls += 1
        throw new Error("socket closed")
      },
      maxReadRetries: 5,
    })
    expect(
      http.request("/task", { method: "POST", json: { title: "x" }, retry: "never" }),
    ).rejects.toBeInstanceOf(WriteOutcomeUnknownError)
    expect(calls).toBe(1)
  })

  test("parses semantic server errors without leaking their body through details", async () => {
    const mock = createSequenceFetch([
      jsonResponse(
        { errorCode: "unknown_exception", message: "user@example.com failed" },
        { status: 500 },
      ),
    ])
    const http = new ApiHttpClient({
      baseUrl: "https://api.ticktick.com/open/v1",
      fetch: mock.fetch,
    })
    const error = await http.request("/project").catch((cause) => cause)
    expect(error).toBeInstanceOf(HttpError)
    if (!(error instanceof HttpError)) throw error
    expect(error.semanticCode).toBe("unknown_exception")
    expect(error.responseBody).toEqual({
      errorCode: "unknown_exception",
      message: `${REDACTED} failed`,
    })
    expect(error.details).not.toHaveProperty("responseBody")
  })

  test("rejects redirects instead of forwarding credentials", async () => {
    const mock = createSequenceFetch([
      new Response(null, { status: 302, headers: { location: "https://evil.test/collect" } }),
    ])
    const http = new ApiHttpClient({
      baseUrl: "https://api.ticktick.com/open/v1",
      fetch: mock.fetch,
    })
    const error = await http.request("/project").catch((cause) => cause)
    expect(error).toBeInstanceOf(AppError)
    if (!(error instanceof AppError)) throw error
    expect(error.code).toBe("redirect_rejected")
    expect(mock.requests[0]?.init.redirect).toBe("manual")
  })
})

describe("retry parsing and redaction", () => {
  test("parses delta seconds and HTTP dates", () => {
    expect(parseRetryAfter("3", 0)).toBe(3000)
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:05 GMT", 1000)).toBe(4000)
    expect(parseRetryAfter("invalid", 0)).toBeUndefined()
  })

  test("redacts headers, URLs, nested secrets, and emails", () => {
    expect(
      redactHeaders({ Authorization: "Bearer secret", Cookie: "t=secret", Accept: "json" }),
    ).toEqual({
      accept: "json",
      authorization: REDACTED,
      cookie: REDACTED,
    })
    const redactedUrl = new URL(redactUrl("https://api.test/path?t=secret&q=user@example.com"))
    expect(redactedUrl.searchParams.get("t")).toBe(REDACTED)
    expect(redactedUrl.searchParams.get("q")).toBe(REDACTED)
    expect(redactValue({ accessToken: "secret", nested: { email: "user@example.com" } })).toEqual({
      accessToken: REDACTED,
      nested: { email: REDACTED },
    })
    expect(neutralizeTerminalText("safe\u001b[31mred\u0007")).toBe("safered�")
  })
})
