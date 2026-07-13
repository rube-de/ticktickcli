import { describe, expect, test } from "bun:test"

import { hasPatchValues } from "../src/domain/inputs"

describe("domain inputs", () => {
  test("distinguishes an omitted field from an explicit clear", () => {
    expect(hasPatchValues({})).toBe(false)
    expect(hasPatchValues({ dueDate: undefined })).toBe(false)
    expect(hasPatchValues({ dueDate: null })).toBe(true)
    expect(hasPatchValues({ priority: 0 })).toBe(true)
  })
})
