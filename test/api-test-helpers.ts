import type { FetchLike } from "../src/api/http"

export interface CapturedRequest {
  url: URL
  init: RequestInit
}

export type ResponseFactory =
  | Response
  | ((request: CapturedRequest, index: number) => Response | Promise<Response>)

export function createSequenceFetch(responses: readonly ResponseFactory[]): {
  fetch: FetchLike
  requests: CapturedRequest[]
} {
  const requests: CapturedRequest[] = []
  const fetch: FetchLike = async (input, init = {}) => {
    const request = { url: new URL(requestUrl(input)), init }
    const index = requests.push(request) - 1
    const factory = responses[index]
    if (!factory) throw new Error(`No mock response configured for request ${index + 1}`)
    return typeof factory === "function" ? factory(request, index) : factory.clone()
  }
  return { fetch, requests }
}

export function jsonResponse(value: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...headersRecord(init.headers) },
  })
}

export function emptyResponse(status = 204, headers?: HeadersInit): Response {
  return new Response(null, { status, headers })
}

export function requestJson(request: CapturedRequest): unknown {
  if (typeof request.init.body !== "string") return undefined
  return JSON.parse(request.init.body)
}

export function requestAt(requests: readonly CapturedRequest[], index: number): CapturedRequest {
  const request = requests[index]
  if (!request) throw new Error(`Expected captured request ${index + 1}`)
  return request
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input)
}

function headersRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries())
}
