import { randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { dirname } from "node:path"

import { type SupportedHost, normalizeHost, normalizeProfileName, resolvePaths } from "./paths"

export type CredentialSource = "environment" | "environment_file" | "saved" | "none"
export type CredentialMode = "v1" | "v2" | "hybrid" | "none"
export type CredentialKind = "v1" | "session_token" | "session_cookie"

export interface SavedCredentialSet {
  accessToken?: string
  sessionToken?: string
  sessionCookie?: string
  updatedAt: string
}

export interface CredentialStore {
  version: 1
  profiles: Record<string, Partial<Record<SupportedHost, SavedCredentialSet>>>
}

export interface ResolvedSecret {
  value?: string
  source: CredentialSource
  /** Environment variable name only; never a secret or a fragment of one. */
  variable?: string
}

export interface ResolvedSessionSecret extends ResolvedSecret {
  kind?: "token" | "cookie"
}

export interface ResolvedCredentials {
  profile: string
  host: SupportedHost
  mode: CredentialMode
  fullCoverage: boolean
  v1: ResolvedSecret
  session: ResolvedSessionSecret
  /** Convenience fields for clients which build Cookie headers themselves. */
  sessionToken: ResolvedSecret
  sessionCookie: ResolvedSecret
}

export interface ResolveCredentialsOptions {
  profile?: string
  host?: string
  env?: Readonly<Record<string, string | undefined>>
  credentialsFile?: string
}

export interface SaveCredentialInput {
  profile?: string
  host?: string
  kind: CredentialKind
  value: string
  credentialsFile?: string
}

export interface RemoveCredentialsInput {
  profile?: string
  host?: string
  scope: "v1" | "session" | "all"
  credentialsFile?: string
}

export class CredentialError extends Error {
  readonly code:
    | "invalid_secret"
    | "secret_file_error"
    | "credential_store_error"
    | "stdin_required"

  constructor(code: CredentialError["code"], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CredentialError"
    this.code = code
  }
}

function emptyStore(): CredentialStore {
  return { version: 1, profiles: {} }
}

function normalizeSecret(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new CredentialError("invalid_secret", `${label} cannot be empty`)
  if (/\0|\r|\n/.test(normalized)) {
    throw new CredentialError("invalid_secret", `${label} contains forbidden control characters`)
  }
  return normalized
}

function validateCredential(kind: CredentialKind, value: string): string {
  const normalized = normalizeSecret(value, "Credential")
  if (kind === "session_cookie") {
    if (!/(?:^|;\s*)t=/.test(normalized)) {
      throw new CredentialError(
        "invalid_secret",
        "A session cookie header must contain the t cookie",
      )
    }
    return normalized
  }
  if (/\s/.test(normalized)) {
    throw new CredentialError("invalid_secret", "Token credentials cannot contain whitespace")
  }
  return normalized
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseStore(value: unknown): CredentialStore {
  if (!isObject(value) || value.version !== 1 || !isObject(value.profiles)) {
    throw new CredentialError("credential_store_error", "Unsupported credentials file format")
  }

  const profiles: CredentialStore["profiles"] = {}
  for (const [profileName, hostsValue] of Object.entries(value.profiles)) {
    const profile = normalizeProfileName(profileName)
    if (!isObject(hostsValue)) {
      throw new CredentialError("credential_store_error", "Invalid credentials profile")
    }
    const hosts: Partial<Record<SupportedHost, SavedCredentialSet>> = {}
    for (const [hostName, credentialValue] of Object.entries(hostsValue)) {
      const host = normalizeHost(hostName)
      if (!isObject(credentialValue) || typeof credentialValue.updatedAt !== "string") {
        throw new CredentialError("credential_store_error", "Invalid saved credential entry")
      }
      const entry: SavedCredentialSet = { updatedAt: credentialValue.updatedAt }
      if (credentialValue.accessToken !== undefined) {
        if (typeof credentialValue.accessToken !== "string") {
          throw new CredentialError("credential_store_error", "Invalid saved v1 credential")
        }
        entry.accessToken = validateCredential("v1", credentialValue.accessToken)
      }
      if (credentialValue.sessionToken !== undefined) {
        if (typeof credentialValue.sessionToken !== "string") {
          throw new CredentialError("credential_store_error", "Invalid saved session credential")
        }
        entry.sessionToken = validateCredential("session_token", credentialValue.sessionToken)
      }
      if (credentialValue.sessionCookie !== undefined) {
        if (typeof credentialValue.sessionCookie !== "string") {
          throw new CredentialError("credential_store_error", "Invalid saved session cookie")
        }
        entry.sessionCookie = validateCredential("session_cookie", credentialValue.sessionCookie)
      }
      hosts[host] = entry
    }
    profiles[profile] = hosts
  }
  return { version: 1, profiles }
}

async function assertRegularNonSymlink(path: string): Promise<void> {
  try {
    const stats = await lstat(path)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new CredentialError(
        "credential_store_error",
        "Credentials path must be a regular file, not a symlink",
      )
    }
  } catch (cause) {
    if (isObject(cause) && cause.code === "ENOENT") return
    if (cause instanceof CredentialError) throw cause
    throw new CredentialError("credential_store_error", "Cannot inspect credentials file", {
      cause,
    })
  }
}

export async function readCredentialStore(
  path = resolvePaths().credentialsFile,
): Promise<CredentialStore> {
  await assertRegularNonSymlink(path)
  try {
    const text = await readFile(path, "utf8")
    return parseStore(JSON.parse(text) as unknown)
  } catch (cause) {
    if (isObject(cause) && cause.code === "ENOENT") return emptyStore()
    if (cause instanceof CredentialError) throw cause
    throw new CredentialError("credential_store_error", "Cannot read credentials file", { cause })
  }
}

async function writeCredentialStore(path: string, store: CredentialStore): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== "win32") await chmod(directory, 0o700)
  await assertRegularNonSymlink(path)

  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(store, null, 2)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
    if (process.platform !== "win32") await chmod(path, 0o600)
  } catch (cause) {
    await handle?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw new CredentialError("credential_store_error", "Cannot save credentials file", { cause })
  }
}

async function readSecretFile(path: string, label: string): Promise<string> {
  try {
    const stats = await lstat(path)
    if (!stats.isFile()) throw new Error("not a regular file")
    return normalizeSecret(await readFile(path, "utf8"), label)
  } catch (cause) {
    throw new CredentialError("secret_file_error", `Cannot read ${label} file`, { cause })
  }
}

async function environmentSecret(
  env: Readonly<Record<string, string | undefined>>,
  directName: string,
  fileName: string,
  kind: CredentialKind,
): Promise<ResolvedSecret | undefined> {
  if (env[directName] !== undefined) {
    return {
      value: validateCredential(kind, env[directName] as string),
      source: "environment",
      variable: directName,
    }
  }
  if (env[fileName] !== undefined) {
    const path = normalizeSecret(env[fileName] as string, fileName)
    return {
      value: validateCredential(kind, await readSecretFile(path, directName)),
      source: "environment_file",
      variable: fileName,
    }
  }
  return undefined
}

function savedSecret(value: string | undefined): ResolvedSecret {
  return value ? { value, source: "saved" } : { source: "none" }
}

export async function resolveCredentials(
  options: ResolveCredentialsOptions = {},
): Promise<ResolvedCredentials> {
  const profile = normalizeProfileName(options.profile)
  const host = normalizeHost(options.host)
  const env = options.env ?? process.env
  const credentialsFile = options.credentialsFile ?? resolvePaths({ profile, host }).credentialsFile
  const store = await readCredentialStore(credentialsFile)
  const saved = store.profiles[profile]?.[host]

  const v1 =
    (await environmentSecret(env, "TT_ACCESS_TOKEN", "TT_ACCESS_TOKEN_FILE", "v1")) ??
    savedSecret(saved?.accessToken)

  // Precedence applies to the v2 credential as a whole: direct values, then files, then saved.
  const directCookie =
    env.TT_SESSION_COOKIE !== undefined
      ? {
          value: validateCredential("session_cookie", env.TT_SESSION_COOKIE),
          source: "environment" as const,
          variable: "TT_SESSION_COOKIE",
        }
      : undefined
  const directToken =
    env.TT_SESSION_TOKEN !== undefined
      ? {
          value: validateCredential("session_token", env.TT_SESSION_TOKEN),
          source: "environment" as const,
          variable: "TT_SESSION_TOKEN",
        }
      : undefined
  const fileCookie =
    !directCookie && !directToken && env.TT_SESSION_COOKIE_FILE !== undefined
      ? {
          value: validateCredential(
            "session_cookie",
            await readSecretFile(
              normalizeSecret(env.TT_SESSION_COOKIE_FILE, "TT_SESSION_COOKIE_FILE"),
              "TT_SESSION_COOKIE",
            ),
          ),
          source: "environment_file" as const,
          variable: "TT_SESSION_COOKIE_FILE",
        }
      : undefined
  const fileToken =
    !directCookie && !directToken && !fileCookie && env.TT_SESSION_TOKEN_FILE !== undefined
      ? {
          value: validateCredential(
            "session_token",
            await readSecretFile(
              normalizeSecret(env.TT_SESSION_TOKEN_FILE, "TT_SESSION_TOKEN_FILE"),
              "TT_SESSION_TOKEN",
            ),
          ),
          source: "environment_file" as const,
          variable: "TT_SESSION_TOKEN_FILE",
        }
      : undefined

  const selectedCookie =
    directCookie ??
    fileCookie ??
    (!directToken && !fileToken ? savedSecret(saved?.sessionCookie) : undefined)
  const selectedToken =
    directToken ??
    fileToken ??
    (!selectedCookie?.value ? savedSecret(saved?.sessionToken) : undefined)
  const sessionCookie = selectedCookie ?? { source: "none" as const }
  const sessionToken = selectedToken ?? { source: "none" as const }
  const session: ResolvedSessionSecret = sessionCookie.value
    ? { ...sessionCookie, kind: "cookie" }
    : sessionToken.value
      ? { ...sessionToken, kind: "token" }
      : { source: "none" }

  const hasV1 = Boolean(v1.value)
  const hasV2 = Boolean(session.value)
  const mode: CredentialMode = hasV1 && hasV2 ? "hybrid" : hasV1 ? "v1" : hasV2 ? "v2" : "none"

  return {
    profile,
    host,
    mode,
    fullCoverage: mode === "hybrid",
    v1,
    session,
    sessionToken,
    sessionCookie,
  }
}

export async function saveCredential(input: SaveCredentialInput): Promise<void> {
  const profile = normalizeProfileName(input.profile)
  const host = normalizeHost(input.host)
  const path = input.credentialsFile ?? resolvePaths({ profile, host }).credentialsFile
  const value = validateCredential(input.kind, input.value)
  const store = await readCredentialStore(path)
  const hosts = store.profiles[profile] ?? {}
  const current = hosts[host] ?? { updatedAt: new Date(0).toISOString() }
  const next: SavedCredentialSet = { ...current, updatedAt: new Date().toISOString() }
  if (input.kind === "v1") next.accessToken = value
  else if (input.kind === "session_token") {
    next.sessionToken = value
    next.sessionCookie = undefined
  } else {
    next.sessionCookie = value
    next.sessionToken = undefined
  }
  hosts[host] = next
  store.profiles[profile] = hosts
  await writeCredentialStore(path, store)
}

export async function removeCredentials(input: RemoveCredentialsInput): Promise<CredentialKind[]> {
  const profile = normalizeProfileName(input.profile)
  const host = normalizeHost(input.host)
  const path = input.credentialsFile ?? resolvePaths({ profile, host }).credentialsFile
  const store = await readCredentialStore(path)
  const entry = store.profiles[profile]?.[host]
  if (!entry) return []

  const removed: CredentialKind[] = []
  if ((input.scope === "v1" || input.scope === "all") && entry.accessToken !== undefined) {
    entry.accessToken = undefined
    removed.push("v1")
  }
  if (input.scope === "session" || input.scope === "all") {
    if (entry.sessionToken !== undefined) {
      entry.sessionToken = undefined
      removed.push("session_token")
    }
    if (entry.sessionCookie !== undefined) {
      entry.sessionCookie = undefined
      removed.push("session_cookie")
    }
  }
  entry.updatedAt = new Date().toISOString()
  await writeCredentialStore(path, store)
  return removed
}

export async function readSecretFromStdin(
  stream: AsyncIterable<Uint8Array | string> & { isTTY?: boolean } = process.stdin,
  maximumBytes = 64 * 1024,
): Promise<string> {
  if (stream.isTTY) {
    throw new CredentialError("stdin_required", "Non-TTY stdin is required for --stdin")
  }
  const decoder = new TextDecoder()
  let result = ""
  let bytes = 0
  for await (const chunk of stream) {
    const data = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
    bytes += new TextEncoder().encode(data).byteLength
    if (bytes > maximumBytes) {
      throw new CredentialError("invalid_secret", "Secret from stdin is too large")
    }
    result += data
  }
  result += decoder.decode()
  return normalizeSecret(result, "Secret from stdin")
}
