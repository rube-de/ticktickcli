import { describe, expect, test } from "bun:test"

import { EXIT_CODES, errorEnvelope, exitCodeFor, successEnvelope } from "../src/output/contract"
import { renderOutput } from "../src/output/render"

describe("output contract", () => {
  test("keeps the versioned envelope while filtering data", () => {
    const envelope = successEnvelope(
      { id: "one", title: "Hello", private: "omit" },
      { profile: "default", source: "v1" },
    )
    expect(JSON.parse(renderOutput(envelope, { mode: "json", fields: "id,title" }))).toEqual({
      version: 1,
      ok: true,
      data: { id: "one", title: "Hello" },
      meta: { profile: "default", source: "v1" },
    })
  })

  test("maps errors to stable exit codes", () => {
    expect(exitCodeFor("capability_missing")).toBe(EXIT_CODES.AUTH_OR_CAPABILITY)
    expect(exitCodeFor("write_outcome_unknown")).toBe(EXIT_CODES.NETWORK_OR_UNKNOWN_WRITE)
    expect(exitCodeFor("schema_drift")).toBe(EXIT_CODES.PROTOCOL)
  })

  test("neutralizes terminal controls and quotes CSV cells", () => {
    const envelope = successEnvelope([{ title: 'bad\u001b[31m,"name"' }])
    expect(renderOutput(envelope, { mode: "csv" })).toBe('title\r\n"bad\\u001b[31m,""name"""\r\n')
  })

  test("neutralizes bidirectional control characters in human output", () => {
    const rendered = renderOutput(successEnvelope([{ title: "safe\u202eevil" }]), {
      mode: "plain",
      fields: "title",
    })
    expect(rendered).toBe("safe\\u202eevil\n")
  })

  test("renders structured errors without diagnostics in JSON", () => {
    const rendered = renderOutput(errorEnvelope("not_found", "No task", { id: "one" }), {
      mode: "json",
    })
    expect(JSON.parse(rendered)).toMatchObject({
      version: 1,
      ok: false,
      error: { code: "not_found", message: "No task", details: { id: "one" } },
    })
  })
})
