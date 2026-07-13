import { describe, expect, test } from "bun:test"
import {
  CAPABILITY_MANIFEST,
  type CapabilityDefinition,
  assertCapability,
  capabilitiesFor,
  lookupCapability,
  validateCapabilityManifest,
} from "../src/api/capabilities"
import { CapabilityError } from "../src/api/errors"

describe("capability manifest", () => {
  const v1 = {
    host: "ticktick.com" as const,
    hasV1Token: true,
    hasV2Session: false,
  }
  const v2 = {
    host: "ticktick.com" as const,
    hasV1Token: false,
    hasV2Session: true,
  }

  test("is internally valid and never exposes source-only evidence as stable", () => {
    expect(validateCapabilityManifest()).toEqual([])
    expect(
      (CAPABILITY_MANIFEST as readonly CapabilityDefinition[]).filter(
        (capability) =>
          capability.stable &&
          (capability.verification === "SOURCE_ONLY" || capability.verification === "UNVERIFIED"),
      ),
    ).toEqual([])
  })

  test("selects stable official-first operations with the required credential", () => {
    expect(assertCapability("task.add", v1).id).toBe("v1.task.add")
    expect(assertCapability("task.pin", v2).id).toBe("v2.task.pin")
    expect(() => assertCapability("task.pin", v1)).toThrow(CapabilityError)
  })

  test("keeps every stable capability unavailable on Dida until its host gate closes", () => {
    expect(
      lookupCapability("project.list", {
        host: "dida365.com",
        hasV1Token: true,
        hasV2Session: true,
      }),
    ).toBeUndefined()
    const error = (() => {
      try {
        assertCapability("project.list", {
          host: "dida365.com",
          hasV1Token: true,
          hasV2Session: true,
        })
      } catch (cause) {
        return cause
      }
    })()
    expect(error).toBeInstanceOf(CapabilityError)
    expect((error as CapabilityError).code).toBe("host_unsupported")
  })

  test("hides incremental sync, remote search, and habit archive by default", () => {
    for (const operation of ["sync.incremental", "search.remote", "habit.archive"] as const) {
      expect(lookupCapability(operation, v2)).toBeUndefined()
      expect(capabilitiesFor(operation).every((capability) => !capability.stable)).toBe(true)
      expect(lookupCapability(operation, { ...v2, allowExperimental: true })).toBeDefined()
    }
  })
})
