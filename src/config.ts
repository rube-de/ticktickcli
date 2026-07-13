import { randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { dirname } from "node:path"

import { type AliasDefinitions, normalizeAliasName, validateAliasDefinitions } from "./core/aliases"
import { resolveTimeZone } from "./core/dates"
import {
  DEFAULT_HOST,
  DEFAULT_PROFILE,
  type SupportedHost,
  normalizeHost,
  normalizeProfileName,
  resolvePaths,
} from "./platform/paths"

export const CONFIG_VERSION = 1 as const
export const DEFAULT_CACHE_TTL_SECONDS = 300

export interface ProfileConfig {
  host: SupportedHost
  timeZone?: string
  cacheTtlSeconds?: number
  /** Non-secret identity used to detect cache/account changes when an API exposes one. */
  accountIdentity?: string
}

export interface HttpConfig {
  timeoutMs: number
  maximumReadRetries: number
  readsPerSecond: number
}

export interface ContextConfig {
  /** Saved argv defaults. They are data tokens and are never evaluated by a shell. */
  tokens: readonly string[]
}

export type AliasConfig = AliasDefinitions

export interface AppConfig {
  version: typeof CONFIG_VERSION
  activeProfile: string
  profiles: Record<string, ProfileConfig>
  http: HttpConfig
  contexts: Record<string, ContextConfig>
  activeContext: string | null
  aliases: Record<string, readonly string[]>
}

export interface ResolveProfileOptions {
  profile?: string
  host?: string
  timeZone?: string
  accountTimeZone?: string
  env?: Readonly<Record<string, string | undefined>>
}

export interface ResolvedProfile extends ProfileConfig {
  name: string
  host: SupportedHost
  timeZone: string
  cacheTtlSeconds: number
  saved: boolean
}

export class ConfigError extends Error {
  readonly code: "invalid_config" | "config_io"

  constructor(code: ConfigError["code"], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "ConfigError"
    this.code = code
  }
}

export function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    activeProfile: DEFAULT_PROFILE,
    profiles: {
      [DEFAULT_PROFILE]: { host: DEFAULT_HOST },
    },
    http: {
      timeoutMs: 30_000,
      maximumReadRetries: 3,
      readsPerSecond: 2,
    },
    contexts: {},
    activeContext: null,
    aliases: {},
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function positiveNumber(value: unknown, label: string, allowZero = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw new ConfigError(
      "invalid_config",
      `${label} must be ${allowZero ? "a non-negative" : "a positive"} integer`,
    )
  }
  return value
}

export function normalizeContextName(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized) || normalized.includes("..")) {
    throw new ConfigError(
      "invalid_config",
      "Context names must be 1-64 ASCII letters, numbers, dots, underscores, or hyphens",
    )
  }
  return normalized
}

export function validateConfigTokens(value: unknown, label: string, allowEmpty = true): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 256) {
    throw new ConfigError(
      "invalid_config",
      `${label} must be ${allowEmpty ? "an" : "a non-empty"} array of at most 256 tokens`,
    )
  }
  return value.map((token, index) => {
    if (typeof token !== "string" || token.length > 4_096 || hasControlCharacter(token)) {
      throw new ConfigError("invalid_config", `${label}[${index}] is not a safe argv token`)
    }
    return token
  })
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) as number
    return codePoint < 0x20 || codePoint === 0x7f
  })
}

export function parseConfig(value: unknown): AppConfig {
  if (!isObject(value) || value.version !== CONFIG_VERSION || !isObject(value.profiles)) {
    throw new ConfigError("invalid_config", "Unsupported config.json format")
  }

  const profiles: Record<string, ProfileConfig> = {}
  for (const [nameValue, profileValue] of Object.entries(value.profiles)) {
    const name = normalizeProfileName(nameValue)
    if (!isObject(profileValue) || typeof profileValue.host !== "string") {
      throw new ConfigError("invalid_config", `Invalid profile: ${name}`)
    }
    const profile: ProfileConfig = { host: normalizeHost(profileValue.host) }
    if (profileValue.timeZone !== undefined) {
      if (typeof profileValue.timeZone !== "string") {
        throw new ConfigError("invalid_config", `Invalid timezone for profile: ${name}`)
      }
      profile.timeZone = resolveTimeZone(profileValue.timeZone)
    }
    if (profileValue.cacheTtlSeconds !== undefined) {
      profile.cacheTtlSeconds = positiveNumber(
        profileValue.cacheTtlSeconds,
        `cacheTtlSeconds for profile ${name}`,
        true,
      )
    }
    if (profileValue.accountIdentity !== undefined) {
      if (
        typeof profileValue.accountIdentity !== "string" ||
        !profileValue.accountIdentity.trim()
      ) {
        throw new ConfigError("invalid_config", `Invalid account identity for profile: ${name}`)
      }
      profile.accountIdentity = profileValue.accountIdentity
    }
    profiles[name] = profile
  }

  if (typeof value.activeProfile !== "string") {
    throw new ConfigError("invalid_config", "activeProfile must be a profile name")
  }
  const activeProfile = normalizeProfileName(value.activeProfile)
  if (!profiles[activeProfile]) {
    throw new ConfigError("invalid_config", `Active profile does not exist: ${activeProfile}`)
  }

  if (!isObject(value.http)) throw new ConfigError("invalid_config", "http settings are required")
  const http: HttpConfig = {
    timeoutMs: positiveNumber(value.http.timeoutMs, "http.timeoutMs"),
    maximumReadRetries: positiveNumber(
      value.http.maximumReadRetries,
      "http.maximumReadRetries",
      true,
    ),
    readsPerSecond: positiveNumber(value.http.readsPerSecond, "http.readsPerSecond"),
  }

  const contextsValue = value.contexts ?? {}
  if (!isObject(contextsValue)) {
    throw new ConfigError("invalid_config", "contexts must be an object")
  }
  if (Object.keys(contextsValue).length > 256) {
    throw new ConfigError("invalid_config", "contexts may contain at most 256 entries")
  }
  const contexts: Record<string, ContextConfig> = {}
  for (const [nameValue, contextValue] of Object.entries(contextsValue)) {
    const name = normalizeContextName(nameValue)
    if (contexts[name]) throw new ConfigError("invalid_config", `Duplicate context: ${name}`)
    if (!isObject(contextValue)) {
      throw new ConfigError("invalid_config", `Invalid context: ${name}`)
    }
    contexts[name] = {
      tokens: validateConfigTokens(contextValue.tokens, `contexts.${name}.tokens`),
    }
  }

  let activeContext: string | null = null
  if (value.activeContext !== undefined && value.activeContext !== null) {
    if (typeof value.activeContext !== "string") {
      throw new ConfigError("invalid_config", "activeContext must be a context name or null")
    }
    activeContext = normalizeContextName(value.activeContext)
    if (!contexts[activeContext]) {
      throw new ConfigError("invalid_config", `Active context does not exist: ${activeContext}`)
    }
  }

  const aliasesValue = value.aliases ?? {}
  if (!isObject(aliasesValue)) throw new ConfigError("invalid_config", "aliases must be an object")
  if (Object.keys(aliasesValue).length > 256) {
    throw new ConfigError("invalid_config", "aliases may contain at most 256 entries")
  }
  const aliases: Record<string, readonly string[]> = {}
  for (const [nameValue, tokensValue] of Object.entries(aliasesValue)) {
    let name: string
    try {
      name = normalizeAliasName(nameValue)
    } catch (cause) {
      throw new ConfigError("invalid_config", `Invalid alias name: ${nameValue}`, { cause })
    }
    if (aliases[name]) throw new ConfigError("invalid_config", `Duplicate alias: ${name}`)
    aliases[name] = validateConfigTokens(tokensValue, `aliases.${name}`, false)
  }
  try {
    validateAliasDefinitions(aliases)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "unknown expansion error"
    throw new ConfigError(
      "invalid_config",
      `Alias definitions cannot be expanded safely: ${reason}`,
      {
        cause,
      },
    )
  }

  return {
    version: CONFIG_VERSION,
    activeProfile,
    profiles,
    http,
    contexts,
    activeContext,
    aliases,
  }
}

export async function loadConfig(path = resolvePaths().configFile): Promise<AppConfig> {
  try {
    const stats = await lstat(path).catch((cause: unknown) => {
      if (isObject(cause) && cause.code === "ENOENT") return undefined
      throw cause
    })
    if (!stats) return defaultConfig()
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new ConfigError("config_io", "Config path must be a regular file, not a symlink")
    }
    return parseConfig(JSON.parse(await readFile(path, "utf8")) as unknown)
  } catch (cause) {
    if (cause instanceof ConfigError) throw cause
    throw new ConfigError("config_io", "Cannot read config.json", { cause })
  }
}

export async function saveConfig(
  configValue: AppConfig,
  path = resolvePaths().configFile,
): Promise<void> {
  const config = parseConfig(configValue)
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== "win32") await chmod(directory, 0o700)

  try {
    const stats = await lstat(path).catch((cause: unknown) => {
      if (isObject(cause) && cause.code === "ENOENT") return undefined
      throw cause
    })
    if (stats && (stats.isSymbolicLink() || !stats.isFile())) {
      throw new ConfigError("config_io", "Config path must be a regular file, not a symlink")
    }
  } catch (cause) {
    if (cause instanceof ConfigError) throw cause
    throw new ConfigError("config_io", "Cannot inspect config.json", { cause })
  }

  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } catch (cause) {
    await handle?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw new ConfigError("config_io", "Cannot save config.json", { cause })
  }
}

/** Flag > TT_PROFILE/TT_HOST > saved profile; timezone follows the plan's four-level policy. */
export function resolveProfile(
  config: AppConfig,
  optionsValue: ResolveProfileOptions | string = {},
): ResolvedProfile {
  const options = typeof optionsValue === "string" ? { profile: optionsValue } : optionsValue
  const env = options.env ?? process.env
  const name = normalizeProfileName(options.profile ?? env.TT_PROFILE ?? config.activeProfile)
  const saved = config.profiles[name]
  const host = normalizeHost(options.host ?? env.TT_HOST ?? saved?.host ?? DEFAULT_HOST)
  const timeZone = resolveTimeZone(options.timeZone, saved?.timeZone, options.accountTimeZone)

  return {
    ...(saved ?? { host }),
    name,
    host,
    timeZone,
    cacheTtlSeconds: saved?.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
    saved: saved !== undefined,
  }
}

export function withProfile(
  config: AppConfig,
  nameValue: string,
  profileValue: ProfileConfig,
  makeActive = false,
): AppConfig {
  const name = normalizeProfileName(nameValue)
  const profile = parseConfig({
    ...config,
    profiles: { [name]: profileValue },
    activeProfile: name,
  }).profiles[name] as ProfileConfig
  return {
    ...config,
    activeProfile: makeActive ? name : config.activeProfile,
    profiles: { ...config.profiles, [name]: profile },
  }
}
