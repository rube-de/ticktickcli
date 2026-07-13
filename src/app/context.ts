import { createHash } from "node:crypto"
import {
  type Capability,
  type CapabilityOperation,
  assertCapability,
  lookupCapability,
} from "../api/capabilities"
import { AppError } from "../api/errors"
import type { FetchLike, HttpDiagnostic } from "../api/http"
import { V1Client } from "../api/v1/client"
import { V2Client } from "../api/v2/client"
import { type AppConfig, type ResolvedProfile, loadConfig, resolveProfile } from "../config"
import { type ResolvedCredentials, resolveCredentials } from "../platform/credentials"
import { type ResolvedPaths, resolvePaths } from "../platform/paths"
import { StoreDatabase } from "../store/db"
import { Repositories } from "../store/repositories"

export interface GlobalOptions {
  json?: boolean
  fields?: string
  plain?: boolean
  csv?: boolean
  profile?: string
  host?: string
  timezone?: string
  fresh?: boolean
  staleOk?: boolean
  offline?: boolean
  noInput?: boolean
  verbose?: boolean
}

export class AppContext {
  readonly repositories: Repositories

  private constructor(
    readonly options: GlobalOptions,
    readonly config: AppConfig,
    readonly profile: ResolvedProfile,
    readonly paths: ResolvedPaths,
    readonly credentials: ResolvedCredentials,
    readonly v1: V1Client | undefined,
    readonly v2: V2Client | undefined,
    readonly store: StoreDatabase,
    readonly diagnostics: HttpDiagnostic[],
    readonly cacheIdentity: string | undefined,
  ) {
    this.repositories = new Repositories(store)
  }

  static async create(options: GlobalOptions = {}): Promise<AppContext> {
    validateGlobalOptions(options)
    const bootstrapPaths = resolvePaths({
      profile: options.profile ?? process.env.TT_PROFILE,
      host: options.host ?? process.env.TT_HOST,
    })
    let config: AppConfig
    try {
      config = await loadConfig(bootstrapPaths.configFile)
    } catch (cause) {
      throw new AppError("local_state", "Configuration could not be loaded", { cause })
    }
    const profile = resolveProfile(config, {
      profile: options.profile,
      host: options.host,
      timeZone: options.timezone,
    })
    const paths = resolvePaths({ profile: profile.name, host: profile.host })
    const diagnostics: HttpDiagnostic[] = []
    const onDiagnostic = options.verbose
      ? (diagnostic: HttpDiagnostic) => diagnostics.push(diagnostic)
      : undefined
    let credentials: ResolvedCredentials
    try {
      credentials = await resolveCredentials({
        profile: profile.name,
        host: profile.host,
        credentialsFile: paths.credentialsFile,
      })
    } catch (cause) {
      throw new AppError("local_state", "Credentials could not be resolved", { cause })
    }

    const v1 = credentials.v1.value
      ? new V1Client({
          accessToken: credentials.v1.value,
          host: profile.host,
          timeoutMs: config.http.timeoutMs,
          maxReadRetries: config.http.maximumReadRetries,
          readsPerSecond: config.http.readsPerSecond,
          onDiagnostic,
          ...(options.offline ? { fetch: offlineFetch } : {}),
        })
      : undefined
    const v2 = credentials.session.value
      ? new V2Client({
          host: profile.host,
          ...(credentials.session.kind === "cookie"
            ? { sessionCookie: credentials.session.value }
            : { sessionToken: credentials.session.value }),
          timeoutMs: config.http.timeoutMs,
          maxReadRetries: config.http.maximumReadRetries,
          readsPerSecond: config.http.readsPerSecond,
          onDiagnostic,
          ...(options.offline ? { fetch: offlineFetch } : {}),
        })
      : undefined

    let store: StoreDatabase
    try {
      store = StoreDatabase.open(paths.cacheFile)
    } catch (cause) {
      throw new AppError("local_state", "The local cache could not be opened", { cause })
    }
    return new AppContext(
      options,
      config,
      profile,
      paths,
      credentials,
      v1,
      v2,
      store,
      diagnostics,
      deriveCacheIdentity(profile.host, profile.accountIdentity, credentials),
    )
  }

  capability(operation: CapabilityOperation | string): Capability {
    return assertCapability(operation, {
      host: this.profile.host,
      hasV1Token: Boolean(this.credentials.v1.value),
      hasV2Session: Boolean(this.credentials.session.value),
    })
  }

  supports(operation: CapabilityOperation | string): Capability | undefined {
    return lookupCapability(operation, {
      host: this.profile.host,
      hasV1Token: Boolean(this.credentials.v1.value),
      hasV2Session: Boolean(this.credentials.session.value),
    })
  }

  assertOnline(): void {
    if (this.options.offline) {
      throw new AppError("invalid_input", "Network access is disabled by --offline")
    }
  }

  metadata(source: "v1" | "v2" | "cache" | "local", extra: Record<string, unknown> = {}) {
    return {
      profile: this.profile.name,
      host: this.profile.host,
      source,
      ...extra,
    } as const
  }

  close(): void {
    this.store.close()
  }
}

const offlineFetch: FetchLike = async () => {
  throw new AppError("invalid_input", "Network access is disabled by --offline")
}

export function deriveCacheIdentity(
  host: string,
  accountIdentity: string | undefined,
  credentials: Pick<ResolvedCredentials, "v1" | "session">,
): string | undefined {
  if (accountIdentity) {
    return `account:${createHash("sha256").update(`${host}\0${accountIdentity}`).digest("hex")}`
  }
  if (!credentials.v1.value && !credentials.session.value) return undefined
  const fingerprint = JSON.stringify([
    host,
    credentials.v1.value ?? null,
    credentials.session.kind ?? null,
    credentials.session.value ?? null,
  ])
  return `credentials:${createHash("sha256").update(fingerprint).digest("hex")}`
}

function validateGlobalOptions(options: GlobalOptions): void {
  const outputModes = [options.json, options.plain, options.csv].filter(Boolean).length
  if (outputModes > 1) {
    throw new AppError("invalid_input", "--json, --plain, and --csv are mutually exclusive")
  }
  const freshnessModes = [options.fresh, options.staleOk, options.offline].filter(Boolean).length
  if (freshnessModes > 1) {
    throw new AppError("invalid_input", "--fresh, --stale-ok, and --offline are mutually exclusive")
  }
}
