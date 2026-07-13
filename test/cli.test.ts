import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "ticktickcli-subprocess-"))
const cwd = join(import.meta.dir, "..")
const environment = {
  ...process.env,
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
  NO_COLOR: "1",
  CI: "1",
}

afterAll(() => rmSync(root, { recursive: true, force: true }))

function run(args: readonly string[], stdin?: string) {
  return Bun.spawnSync({
    cmd: [process.execPath, "--no-env-file", "src/index.ts", ...args],
    cwd,
    env: environment,
    stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  })
}

describe("CLI subprocess contract", () => {
  test("accepts global JSON flags after subcommands and emits one envelope", () => {
    const result = run(["auth", "status", "--json", "--no-input"])
    expect(result.exitCode).toBe(0)
    expect(result.stderr.toString()).toBe("")
    const envelope = JSON.parse(result.stdout.toString()) as Record<string, unknown>
    expect(envelope.version).toBe(1)
    expect(envelope.ok).toBe(true)
  })

  test("uses stable local-state exit code and stdout/stderr separation in JSON mode", () => {
    const result = run(["task", "list", "--offline", "--json", "--no-input"])
    expect(result.exitCode).toBe(8)
    expect(result.stderr.toString()).toBe("")
    const envelope = JSON.parse(result.stdout.toString()) as {
      ok: boolean
      error: { code: string }
    }
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe("local_state")
  })

  test("returns usage errors as JSON without Commander diagnostics", () => {
    const result = run(["--json", "definitely-not-a-command"])
    expect(result.exitCode).toBe(2)
    expect(result.stderr.toString()).toBe("")
    expect(JSON.parse(result.stdout.toString()).error.code).toBe("invalid_input")
  })

  test("blocks verification network calls centrally in offline mode", () => {
    const result = run(["auth", "status", "--verify", "--offline", "--json"])
    expect(result.exitCode).toBe(2)
    expect(result.stderr.toString()).toBe("")
    expect(JSON.parse(result.stdout.toString()).error).toMatchObject({
      code: "invalid_input",
      message: "Network access is disabled by --offline",
    })
  })

  test("dry-run destructive cache clear does not require confirmation", () => {
    const result = run(["cache", "clear", "--dry-run", "--json"])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString()).data.dryRun).toBe(true)
  })

  test("keeps profile-add host and timezone options local after global option hoisting", () => {
    const result = run([
      "profile",
      "add",
      "work",
      "--host",
      "dida365.com",
      "--timezone",
      "Europe/London",
      "--dry-run",
      "--json",
    ])
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.stdout.toString()).data
    expect(data).toMatchObject({
      dryRun: true,
      name: "work",
      host: "dida365.com",
      timeZone: "Europe/London",
    })
  })

  test("prints completions as raw text outside machine output modes", () => {
    const result = run(["completion", "bash"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("complete -F _tt_complete tt")
  })
})
