import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { deriveCacheIdentity } from "../src/app/context"
import { defaultConfig, loadConfig, resolveProfile, saveConfig, withProfile } from "../src/config"
import {
  readSecretFromStdin,
  removeCredentials,
  resolveCredentials,
  saveCredential,
} from "../src/platform/credentials"
import { normalizeHost, resolvePaths, validateProfileName } from "../src/platform/paths"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tt-test-"))
  temporaryDirectories.push(directory)
  return directory
}

describe("platform paths", () => {
  test("normalizes only supported hosts and safe profile path segments", () => {
    expect(normalizeHost("API.TICKTICK.COM")).toBe("ticktick.com")
    expect(() => normalizeHost("example.com")).toThrow("Unsupported host")
    expect(validateProfileName("work-1")).toBe(true)
    expect(validateProfileName("../work")).toBe(false)

    const paths = resolvePaths({
      profile: "Work",
      host: "ticktick",
      baseDirectories: {
        data: "/data",
        config: "/config",
        cache: "/cache",
        log: "/log",
        temp: "/tmp",
      },
    })
    expect(paths.cacheFile).toBe("/data/state/profiles/work/ticktick.com/cache.sqlite3")
  })
})

describe("credentials", () => {
  test("derives a non-secret cache identity that changes with credentials", () => {
    const first = deriveCacheIdentity("ticktick.com", undefined, {
      v1: { value: "first-secret-token", source: "environment" },
      session: { source: "none" },
    })
    const same = deriveCacheIdentity("ticktick.com", undefined, {
      v1: { value: "first-secret-token", source: "saved" },
      session: { source: "none" },
    })
    const changed = deriveCacheIdentity("ticktick.com", undefined, {
      v1: { value: "second-secret-token", source: "environment" },
      session: { source: "none" },
    })

    expect(first).toBe(same)
    expect(changed).not.toBe(first)
    expect(first).not.toContain("first-secret-token")
  })

  test("uses environment over saved credentials and writes restrictive files", async () => {
    const directory = await temporaryDirectory()
    const credentialsFile = join(directory, "config", "credentials.json")
    await saveCredential({
      profile: "default",
      host: "ticktick.com",
      kind: "v1",
      value: "saved-token",
      credentialsFile,
    })
    await saveCredential({
      profile: "default",
      host: "ticktick.com",
      kind: "session_token",
      value: "saved-session",
      credentialsFile,
    })

    const saved = await resolveCredentials({ credentialsFile, env: {} })
    expect(saved.mode).toBe("hybrid")
    expect(saved.v1).toMatchObject({ value: "saved-token", source: "saved" })

    const overridden = await resolveCredentials({
      credentialsFile,
      env: { TT_ACCESS_TOKEN: "environment-token" },
    })
    expect(overridden.v1).toMatchObject({ value: "environment-token", source: "environment" })
    if (process.platform !== "win32") expect((await stat(credentialsFile)).mode & 0o777).toBe(0o600)
    expect(await readFile(credentialsFile, "utf8")).not.toContain("environment-token")

    await saveCredential({
      kind: "session_cookie",
      value: "t=cookie-session; locale=en",
      credentialsFile,
    })
    expect((await resolveCredentials({ credentialsFile, env: {} })).session.kind).toBe("cookie")
    await saveCredential({
      kind: "session_token",
      value: "replacement-session",
      credentialsFile,
    })
    expect((await resolveCredentials({ credentialsFile, env: {} })).session).toMatchObject({
      kind: "token",
      value: "replacement-session",
    })

    expect(await removeCredentials({ scope: "all", credentialsFile })).toEqual([
      "v1",
      "session_token",
    ])
  })

  test("reads a secret from non-TTY stdin", async () => {
    const stream = {
      isTTY: false,
      async *[Symbol.asyncIterator]() {
        yield "secret-value\n"
      },
    }
    expect(await readSecretFromStdin(stream)).toBe("secret-value")
  })
})

describe("config", () => {
  test("round-trips config and resolves explicit/environment/saved precedence", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "config.json")
    const config = withProfile(
      defaultConfig(),
      "work",
      { host: "dida365.com", timeZone: "Asia/Tokyo", cacheTtlSeconds: 60 },
      true,
    )
    await saveConfig(config, path)
    const loaded = await loadConfig(path)
    expect(resolveProfile(loaded, { env: {}, timeZone: "Europe/Zurich" })).toMatchObject({
      name: "work",
      host: "dida365.com",
      timeZone: "Europe/Zurich",
      cacheTtlSeconds: 60,
    })
  })
})
