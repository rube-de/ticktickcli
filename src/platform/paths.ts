import { join } from "node:path"
import envPaths from "env-paths"

export const APPLICATION_ID = "ticktickcli"
export const DEFAULT_PROFILE = "default"
export const DEFAULT_HOST: SupportedHost = "ticktick.com"

export type SupportedHost = "ticktick.com" | "dida365.com"

export interface HostOrigins {
  host: SupportedHost
  v1: string
  v2: string
  web: string
}

const HOST_ALIASES: Readonly<Record<string, SupportedHost>> = {
  ticktick: "ticktick.com",
  "ticktick.com": "ticktick.com",
  "api.ticktick.com": "ticktick.com",
  dida: "dida365.com",
  dida365: "dida365.com",
  "dida365.com": "dida365.com",
  "api.dida365.com": "dida365.com",
}

export const HOST_ORIGINS: Readonly<Record<SupportedHost, HostOrigins>> = {
  "ticktick.com": {
    host: "ticktick.com",
    v1: "https://api.ticktick.com/open/v1",
    v2: "https://api.ticktick.com/api/v2",
    web: "https://ticktick.com",
  },
  "dida365.com": {
    host: "dida365.com",
    v1: "https://api.dida365.com/open/v1",
    v2: "https://api.dida365.com/api/v2",
    web: "https://dida365.com",
  },
}

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PathValidationError"
  }
}

export function normalizeHost(value: string | undefined): SupportedHost {
  const normalized = (value ?? DEFAULT_HOST)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
  const host = HOST_ALIASES[normalized]
  if (!host) throw new PathValidationError(`Unsupported host: ${value ?? ""}`)
  return host
}

export function validateProfileName(value: string): boolean {
  if (value !== value.normalize("NFKC")) return false
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) return false
  return value !== "." && value !== ".." && !value.includes("..")
}

export function normalizeProfileName(value: string | undefined): string {
  const normalized = (value ?? DEFAULT_PROFILE).normalize("NFKC").trim().toLowerCase()
  if (!validateProfileName(normalized)) {
    throw new PathValidationError(
      "Profile names must be 1-64 ASCII letters, numbers, dots, underscores, or hyphens",
    )
  }
  return normalized
}

export interface BaseDirectories {
  data: string
  config: string
  cache: string
  log: string
  temp: string
}

export interface ResolvePathsOptions {
  profile?: string
  host?: string
  /** Test hook; production callers should let env-paths select platform directories. */
  baseDirectories?: BaseDirectories
}

export interface ResolvedPaths {
  profile: string
  host: SupportedHost
  dataDir: string
  stateDir: string
  cacheDir: string
  configDir: string
  logDir: string
  tempDir: string
  configFile: string
  credentialsFile: string
  cacheFile: string
}

export function resolvePaths(options: ResolvePathsOptions = {}): ResolvedPaths {
  const profile = normalizeProfileName(options.profile)
  const host = normalizeHost(options.host)
  const base = options.baseDirectories ?? envPaths(APPLICATION_ID, { suffix: "" })
  const stateDir = join(base.data, "state")
  const profileStateDir = join(stateDir, "profiles", profile, host)

  return {
    profile,
    host,
    dataDir: base.data,
    stateDir,
    cacheDir: base.cache,
    configDir: base.config,
    logDir: base.log,
    tempDir: base.temp,
    configFile: join(base.config, "config.json"),
    credentialsFile: join(base.config, "credentials.json"),
    cacheFile: join(profileStateDir, "cache.sqlite3"),
  }
}
