import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

interface PackageManifest {
  private: boolean
  bin: Record<string, string>
  files: string[]
  engines: Record<string, string>
  scripts: Record<string, string>
  dependencies: Record<string, string>
  repository: {
    type: string
    url: string
  }
}

const root = resolve(import.meta.dir, "../..")
const manifest = (await Bun.file(resolve(root, "package.json")).json()) as PackageManifest

describe("release manifest", () => {
  test("declares the publishable Bun CLI contract", () => {
    expect(manifest.private).toBe(false)
    expect(manifest.bin).toEqual({ tt: "./src/index.ts" })
    expect(manifest.engines.bun).toBeDefined()
    expect(manifest.repository.type).toBe("git")
    expect(manifest.repository.url).toStartWith("git+")
  })

  test("uses an explicit package allowlist", () => {
    expect(manifest.files).toContain("src")
    expect(manifest.files).toContain("skills/SKILL.md")
    expect(manifest.files).toContain("docs/command-index.md")
    expect(manifest.files).toContain("docs/man/tt.1")
    expect(manifest.files.some((path) => path.startsWith(".claude"))).toBe(false)
    expect(manifest.files.some((path) => path.startsWith("docs/reference"))).toBe(false)
  })

  test("defines all release checks and runtime dependencies", () => {
    for (const script of ["typecheck", "lint", "docs:check", "test", "test:package", "check"]) {
      expect(manifest.scripts[script]).toBeDefined()
    }

    for (const dependency of ["@js-temporal/polyfill", "chalk", "commander", "env-paths", "zod"]) {
      expect(manifest.dependencies[dependency]).toBeDefined()
    }
  })

  test("ignores local agent inputs and keeps the public implementation plan available", async () => {
    const ignoreRules = await Bun.file(resolve(root, ".gitignore")).text()
    const publicPlan = await Bun.file(resolve(root, "docs/implementation-plan.md")).text()
    expect(ignoreRules.split(/\r?\n/)).toContain(".claude/files/")
    expect(publicPlan).toStartWith("# TickTick CLI — Implementation Plan")
  })
})
