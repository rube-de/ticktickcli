import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

interface CommandResult {
  stdout: string
  stderr: string
}

interface PackedFile {
  path: string
  mode: number
}

interface PackResult {
  filename: string
  files: PackedFile[]
}

interface PackageManifest {
  name: string
  version: string
}

async function run(
  command: readonly string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): Promise<CommandResult> {
  const processHandle = Bun.spawn([...command], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ])

  assert.equal(
    exitCode,
    0,
    `${command.join(" ")} failed with exit ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
  )
  return { stdout, stderr }
}

function cleanEnvironment(home: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    const isSecret = /(AUTHORIZATION|COOKIE|CREDENTIAL|PASSWORD|SECRET|TOKEN)/i.test(key)
    if (value === undefined || key.startsWith("TT_") || key === "TICKTICK_LIVE" || isSecret) {
      continue
    }
    env[key] = value
  }

  env.CI = "1"
  env.HOME = home
  env.XDG_CACHE_HOME = join(home, ".cache")
  env.XDG_CONFIG_HOME = join(home, ".config")
  env.XDG_DATA_HOME = join(home, ".local", "share")
  env.NPM_CONFIG_USERCONFIG = join(home, ".npmrc")
  return env
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, "..")
  const temporaryRoot = await mkdtemp(join(tmpdir(), "tt-package-smoke-"))
  const packageDirectory = join(temporaryRoot, "pack")
  const unpackDirectory = join(temporaryRoot, "unpacked")
  const installDirectory = join(temporaryRoot, "install")
  const executionDirectory = join(temporaryRoot, "execution")
  const homeDirectory = join(temporaryRoot, "home")

  try {
    await Promise.all([
      mkdir(packageDirectory),
      mkdir(unpackDirectory),
      mkdir(installDirectory),
      mkdir(executionDirectory),
      mkdir(homeDirectory),
    ])

    const env = cleanEnvironment(homeDirectory)
    const manifest = (await Bun.file(join(root, "package.json")).json()) as PackageManifest
    const packed = await run(
      ["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", packageDirectory],
      root,
      env,
    )
    const packResults = JSON.parse(packed.stdout) as PackResult[]
    assert.equal(packResults.length, 1, "npm pack must produce exactly one artifact")

    const packResult = packResults[0]
    assert.ok(packResult, "npm pack did not report an artifact")
    const packedPaths = new Set(packResult.files.map((file) => file.path))

    for (const requiredPath of [
      "package.json",
      "src/index.ts",
      "README.md",
      "LICENSE",
      "skills/SKILL.md",
      "docs/authentication.md",
      "docs/command-index.md",
      "docs/commands.md",
      "docs/configuration.md",
      "docs/man/tt.1",
    ]) {
      assert.ok(packedPaths.has(requiredPath), `package is missing ${requiredPath}`)
    }

    for (const filePath of packedPaths) {
      assert.ok(!filePath.startsWith(".claude/"), `package leaked internal file ${filePath}`)
      assert.ok(!filePath.startsWith(".github/"), `package leaked workflow file ${filePath}`)
      assert.ok(!filePath.startsWith(".env"), `package leaked environment file ${filePath}`)
      assert.ok(!filePath.startsWith("test/"), `package leaked test file ${filePath}`)
      assert.ok(!filePath.startsWith("tests/"), `package leaked test file ${filePath}`)
      assert.ok(
        !filePath.startsWith("docs/reference/"),
        `package leaked vendored reference ${filePath}`,
      )
      assert.ok(!filePath.startsWith("scripts/"), `package leaked build script ${filePath}`)
      assert.notEqual(filePath, "tsconfig.json", "package leaked tsconfig.json")
      assert.notEqual(filePath, "biome.json", "package leaked biome.json")
      assert.notEqual(filePath, "bun.lock", "package leaked bun.lock")
      assert.notEqual(filePath, "justfile", "package leaked justfile")
    }

    const tarball = join(packageDirectory, packResult.filename)
    await run(["tar", "-xzf", tarball, "-C", unpackDirectory], root)

    const packedEntry = join(unpackDirectory, "package", "src", "index.ts")
    const entryContents = await readFile(packedEntry, "utf8")
    assert.ok(entryContents.startsWith("#!/usr/bin/env bun\n"), "tt must use an env Bun shebang")

    const entryStats = await stat(packedEntry)
    assert.notEqual(entryStats.mode & 0o111, 0, "the packed tt entrypoint must be executable")

    await run(
      ["npm", "install", "--global", "--ignore-scripts", "--prefix", installDirectory, tarball],
      executionDirectory,
      env,
    )

    const installedBinary = join(installDirectory, "bin", "tt")
    const installedVersion = await run([installedBinary, "--version"], executionDirectory, env)
    assert.ok(
      installedVersion.stdout.includes(manifest.version),
      `installed tt --version did not contain ${manifest.version}`,
    )

    const installedHelp = await run([installedBinary, "--help"], executionDirectory, env)
    assert.ok(installedHelp.stdout.includes("tt"), "installed tt --help did not identify the CLI")

    const bunxVersion = await run(
      ["bunx", "--bun", "--package", `file:${tarball}`, "tt", "--version"],
      executionDirectory,
      env,
    )
    assert.ok(
      bunxVersion.stdout.includes(manifest.version),
      `bunx tt --version did not contain ${manifest.version}`,
    )

    process.stdout.write(
      `Package smoke test passed for ${manifest.name}@${manifest.version} (${packedPaths.size} files)\n`,
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

await main()
