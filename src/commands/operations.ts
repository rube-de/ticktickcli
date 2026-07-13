import { type Command, Option } from "commander"
import { validateCapabilityManifest } from "../api/capabilities"
import { AppError, isUserUnboundTokenSignature } from "../api/errors"
import { forceCoreSync, planCoreSync } from "../app/state"
import { type AppConfig, type ProfileConfig, parseConfig, saveConfig, withProfile } from "../config"
import { normalizeHost, normalizeProfileName } from "../platform/paths"
import { requireConfirmation } from "./common"
import { generateCompletion } from "./completion"
import { addWriteOptions, executeCommand } from "./runtime"

export function registerOperationCommands(program: Command): void {
  program
    .command("sync")
    .description("Synchronize local account state")
    .option("--full", "force an authoritative full sync")
    .option("--dry-run", "show the selected sync strategy without network or cache writes")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        if (context.options.offline) {
          throw new AppError("invalid_input", "sync cannot run with --offline")
        }
        const plan = planCoreSync(context)
        if (command.opts().dryRun) {
          return {
            data: {
              dryRun: true,
              operation: "sync",
              strategy: plan.strategy,
            },
            meta: context.metadata("local"),
          }
        }
        const result = await forceCoreSync(context)
        return {
          data: result,
          meta: context.metadata(result.source, {
            fetchedAt: result.fetchedAt,
            stale: false,
          }),
        }
      })
    })

  program
    .command("doctor")
    .description("Diagnose paths, contracts, credentials, and cache health")
    .option("--verify", "make low-risk credential verification requests")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        const checks: Array<Record<string, unknown>> = [
          {
            name: "capability_manifest",
            ok: validateCapabilityManifest().length === 0,
            problems: validateCapabilityManifest(),
          },
          { name: "cache_integrity", ok: context.store.integrityCheck() },
          {
            name: "credentials",
            ok: context.credentials.mode !== "none",
            mode: context.credentials.mode,
            v1Source: context.credentials.v1.source,
            sessionSource: context.credentials.session.source,
          },
        ]
        if (command.opts().verify) {
          context.assertOnline()
          if (context.v1) {
            try {
              await context.v1.listProjects()
              checks.push({ name: "v1_credential", ok: true })
            } catch (error) {
              checks.push({
                name: "v1_credential",
                ok: false,
                code: isUserUnboundTokenSignature(error)
                  ? "token_not_user_bound"
                  : "authentication_failed",
              })
            }
          }
          if (context.v2) {
            try {
              await context.v2.request("/user/status")
              checks.push({ name: "v2_session", ok: true })
            } catch {
              checks.push({ name: "v2_session", ok: false, code: "authentication_failed" })
            }
          }
        }
        return {
          data: {
            ok: checks.every((check) => check.ok !== false),
            checks,
            paths: {
              config: context.paths.configFile,
              credentials: context.paths.credentialsFile,
              cache: context.paths.cacheFile,
            },
          },
          meta: context.metadata("local"),
        }
      })
    })

  registerCache(program)
  registerProfiles(program)
  registerConfig(program)
  registerCompletion(program)
  registerRawApi(program)
}

function registerCache(program: Command): void {
  const cache = program.command("cache").description("Inspect or clear local cached data")
  cache.command("status").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => ({
      data: { file: context.paths.cacheFile, ...context.repositories.status() },
      meta: context.metadata("cache"),
    }))
  })
  addWriteOptions(cache.command("clear").description("Delete cached account data")).action(
    async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        if (command.opts().dryRun) {
          return {
            data: { dryRun: true, operation: "cache.clear", file: context.paths.cacheFile },
            meta: context.metadata("local"),
          }
        }
        requireConfirmation(command.opts(), "clear cached account data")
        context.store.transaction(() => context.repositories.clearAll())
        return {
          data: { cleared: true, credentialsRetained: true, file: context.paths.cacheFile },
          meta: context.metadata("local"),
        }
      })
    },
  )
}

function registerProfiles(program: Command): void {
  const profile = program.command("profile").description("Manage isolated account profiles")
  profile.command("list").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => ({
      data: Object.entries(context.config.profiles)
        .map(([name, value]) => ({ name, ...value, active: name === context.config.activeProfile }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      meta: context.metadata("local"),
    }))
  })
  profile
    .command("add")
    .argument("<name>")
    .addOption(
      new Option("--profile-add-host <host>", "TickTick host").hideHelp().default("ticktick.com"),
    )
    .addOption(new Option("--profile-add-timezone <iana>", "profile IANA timezone").hideHelp())
    .option("--use", "make this the active profile")
    .option("--dry-run", "validate without saving")
    .addHelpText(
      "after",
      "\nProfile options:\n  --host <host>       TickTick host\n  --timezone <iana>   profile IANA timezone",
    )
    .action(async (name: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const normalized = normalizeProfileName(name)
        if (context.config.profiles[normalized]) {
          throw new AppError("conflict", `Profile already exists: ${normalized}`)
        }
        const profileConfig: ProfileConfig = {
          host: normalizeHost(command.opts().profileAddHost),
          ...(command.opts().profileAddTimezone
            ? { timeZone: command.opts().profileAddTimezone }
            : {}),
        }
        const config = withProfile(context.config, normalized, profileConfig, command.opts().use)
        if (command.opts().dryRun) {
          return {
            data: { dryRun: true, name: normalized, ...config.profiles[normalized] },
            meta: context.metadata("local"),
          }
        }
        await saveConfig(config, context.paths.configFile)
        return {
          data: { name: normalized, ...config.profiles[normalized] },
          meta: context.metadata("local"),
        }
      })
    })
  addWriteOptions(
    profile.command("remove").argument("<name>").description("Remove a profile configuration"),
  ).action(async (name: string, _options, command: Command) => {
    await executeCommand(command, async (context) => {
      const normalized = normalizeProfileName(name)
      if (!context.config.profiles[normalized]) {
        throw new AppError("not_found", `Profile not found: ${normalized}`)
      }
      if (Object.keys(context.config.profiles).length === 1) {
        throw new AppError("conflict", "The final profile cannot be removed")
      }
      if (command.opts().dryRun) {
        return {
          data: { dryRun: true, operation: "profile.remove", name: normalized },
          meta: context.metadata("local"),
        }
      }
      requireConfirmation(command.opts(), "remove the profile")
      const profiles = { ...context.config.profiles }
      delete profiles[normalized]
      const activeProfile =
        context.config.activeProfile === normalized
          ? (Object.keys(profiles).sort()[0] as string)
          : context.config.activeProfile
      await saveConfig({ ...context.config, profiles, activeProfile }, context.paths.configFile)
      return {
        data: { removed: normalized, cacheRetained: true, credentialsRetained: true },
        meta: context.metadata("local"),
      }
    })
  })
  profile
    .command("use")
    .argument("<name>")
    .option("--dry-run", "validate without saving")
    .action(async (name: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const normalized = normalizeProfileName(name)
        if (!context.config.profiles[normalized])
          throw new AppError("not_found", `Profile not found: ${normalized}`)
        if (command.opts().dryRun) {
          return {
            data: { dryRun: true, activeProfile: normalized },
            meta: context.metadata("local"),
          }
        }
        await saveConfig({ ...context.config, activeProfile: normalized }, context.paths.configFile)
        return { data: { activeProfile: normalized }, meta: context.metadata("local") }
      })
    })
}

function registerConfig(program: Command): void {
  const config = program.command("config").description("Read or update non-secret configuration")
  config
    .command("get")
    .argument("[key]")
    .action(async (key: string | undefined, _options, command: Command) => {
      await executeCommand(command, async (context) => ({
        data: key ? getConfigValue(context.config, key) : context.config,
        meta: context.metadata("local"),
      }))
    })
  config
    .command("set")
    .argument("<key>")
    .argument("<value>")
    .option("--dry-run", "validate without saving")
    .action(async (key: string, value: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const next = setConfigValue(context.config, key, parseConfigScalar(value))
        const parsed = parseConfig(next)
        if (!command.opts().dryRun) await saveConfig(parsed, context.paths.configFile)
        return {
          data: {
            ...(command.opts().dryRun ? { dryRun: true } : {}),
            key,
            value: getConfigValue(next, key),
          },
          meta: context.metadata("local"),
        }
      })
    })
}

function registerCompletion(program: Command): void {
  const completion = program.command("completion").description("Print shell completion code")
  for (const shell of ["bash", "zsh", "fish"] as const) {
    completion.command(shell).action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => ({
        data: { shell, script: generateCompletion(shell) },
        raw: generateCompletion(shell),
        meta: context.metadata("local"),
      }))
    })
  }
}

function registerRawApi(program: Command): void {
  const api = program.command("api").description("Read-only API escape hatch")
  api
    .command("get")
    .argument("<relative-path>")
    .option("--v2", "use the private v2 API")
    .option("--raw", "print uncontracted raw JSON in human mode")
    .action(async (path: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        if (context.options.offline)
          throw new AppError("invalid_input", "api get cannot run with --offline")
        const client = command.opts().v2 ? context.v2 : context.v1
        if (!client) {
          throw new AppError(
            "authentication_missing",
            command.opts().v2 ? "A v2 session is required" : "A v1 token is required",
          )
        }
        const data = await client.request(path)
        return {
          data,
          ...(command.opts().raw ? { raw: `${JSON.stringify(data)}\n` } : {}),
          meta: context.metadata(command.opts().v2 ? "v2" : "v1"),
        }
      })
    })
}

function getConfigValue(config: AppConfig, key: string): unknown {
  let value: unknown = config
  for (const component of key.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !(component in value)) {
      throw new AppError("not_found", `Configuration key not found: ${key}`)
    }
    value = (value as Record<string, unknown>)[component]
  }
  return value
}

function setConfigValue(config: AppConfig, key: string, value: unknown): AppConfig {
  if (
    !/^(activeProfile|http\.(timeoutMs|maximumReadRetries|readsPerSecond)|profiles\.[a-z0-9._-]+\.(host|timeZone|cacheTtlSeconds))$/.test(
      key,
    )
  ) {
    throw new AppError("invalid_input", `Configuration key is not writable: ${key}`)
  }
  const clone = structuredClone(config) as unknown as Record<string, unknown>
  const components = key.split(".")
  const final = components.pop() as string
  let target = clone
  for (const component of components) {
    const child = target[component]
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      throw new AppError("not_found", `Configuration key not found: ${key}`)
    }
    target = child as Record<string, unknown>
  }
  target[final] = value
  return clone as unknown as AppConfig
}

function parseConfigScalar(value: string): unknown {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  return value
}
