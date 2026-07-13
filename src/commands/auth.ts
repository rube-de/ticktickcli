import type { Command } from "commander"
import { AppError, isUserUnboundTokenSignature } from "../api/errors"
import { V2Client } from "../api/v2/client"
import { saveConfig } from "../config"
import { readSecretFromStdin, removeCredentials, saveCredential } from "../platform/credentials"
import { executeCommand } from "./runtime"

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage headless credentials")

  auth
    .command("token")
    .description("Save a v1 personal API token")
    .option("--stdin", "read the token from standard input")
    .option("--dry-run", "validate input without saving")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        if (!command.opts().stdin)
          throw new AppError("invalid_input", "auth token requires --stdin")
        const value = await readSecretFromStdin()
        if (command.opts().dryRun) {
          return {
            data: { dryRun: true, valid: true, wouldSave: "v1" },
            meta: context.metadata("local"),
          }
        }
        await saveCredential({
          profile: context.profile.name,
          host: context.profile.host,
          kind: "v1",
          value,
          credentialsFile: context.paths.credentialsFile,
        })
        context.repositories.invalidateAllFreshness()
        return {
          data: { saved: "v1", profile: context.profile.name, host: context.profile.host },
          meta: context.metadata("local"),
        }
      })
    })

  auth
    .command("session")
    .description("Validate and save a v2 session token or cookie")
    .option("--stdin", "read the session from standard input")
    .option("--cookie", "input is a full Cookie header")
    .option("--dry-run", "validate input and session without saving")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        if (!command.opts().stdin)
          throw new AppError("invalid_input", "auth session requires --stdin")
        context.assertOnline()
        const value = await readSecretFromStdin()
        const isCookie = command.opts().cookie === true || /(?:^|;\s*)t=/.test(value)
        const client = new V2Client({
          host: context.profile.host,
          ...(isCookie ? { sessionCookie: value } : { sessionToken: value }),
          timeoutMs: context.config.http.timeoutMs,
          maxReadRetries: context.config.http.maximumReadRetries,
        })
        const [status, profile] = await Promise.all([
          client.request("/user/status"),
          client.request("/user/profile"),
        ])
        const identity = accountIdentity(profile) ?? accountIdentity(status)
        if (
          identity &&
          context.profile.accountIdentity &&
          identity !== context.profile.accountIdentity
        ) {
          throw new AppError(
            "credential_account_mismatch",
            "The session belongs to another account",
          )
        }
        if (command.opts().dryRun) {
          return {
            data: {
              dryRun: true,
              valid: true,
              wouldSave: isCookie ? "session_cookie" : "session_token",
              accountMatch: identity ? "verified" : "unknown",
            },
            meta: context.metadata("local"),
          }
        }
        await saveCredential({
          profile: context.profile.name,
          host: context.profile.host,
          kind: isCookie ? "session_cookie" : "session_token",
          value,
          credentialsFile: context.paths.credentialsFile,
        })
        if (
          identity &&
          context.config.profiles[context.profile.name]?.host === context.profile.host
        ) {
          await saveConfig(
            {
              ...context.config,
              profiles: {
                ...context.config.profiles,
                [context.profile.name]: {
                  ...context.config.profiles[context.profile.name],
                  host: context.profile.host,
                  accountIdentity: identity,
                },
              },
            },
            context.paths.configFile,
          )
        }
        context.repositories.invalidateAllFreshness()
        return {
          data: {
            saved: isCookie ? "session_cookie" : "session_token",
            profile: context.profile.name,
            host: context.profile.host,
            verified: true,
            accountMatch: identity ? "verified" : "unknown",
          },
          meta: context.metadata("local"),
        }
      })
    })

  auth
    .command("status")
    .description("Show credential readiness without revealing secrets")
    .option("--verify", "make low-risk verification requests")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        const data: Record<string, unknown> = {
          mode: context.credentials.mode,
          fullCoverage: context.credentials.fullCoverage,
          accountMatch: context.credentials.mode === "hybrid" ? "unknown" : "not_applicable",
          v1: {
            configured: Boolean(context.credentials.v1.value),
            source: context.credentials.v1.source,
          },
          session: {
            configured: Boolean(context.credentials.session.value),
            source: context.credentials.session.source,
            kind: context.credentials.session.kind,
          },
        }
        if (command.opts().verify) {
          context.assertOnline()
          const verification: Record<string, unknown> = {}
          if (context.v1) {
            try {
              await context.v1.listProjects()
              verification.v1 = { valid: true }
            } catch (error) {
              if (isUserUnboundTokenSignature(error)) {
                verification.v1 = { valid: false, code: "token_not_user_bound" }
              } else throw error
            }
          }
          if (context.v2) {
            const [status, profile] = await Promise.all([
              context.v2.request("/user/status"),
              context.v2.request("/user/profile"),
            ])
            verification.session = {
              valid: true,
              identity: safeIdentity(profile),
              premium: premiumState(status),
            }
          }
          data.verification = verification
        }
        return { data, meta: context.metadata("local") }
      })
    })

  auth
    .command("logout")
    .description("Remove saved credentials without deleting cached account data")
    .option("--v1", "remove the v1 credential")
    .option("--session", "remove session credentials")
    .option("--all", "remove every credential")
    .option("--dry-run", "show which saved credentials would be removed")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        const options = command.opts()
        const scope = options.all
          ? "all"
          : options.v1
            ? "v1"
            : options.session
              ? "session"
              : undefined
        if (!scope) {
          throw new AppError("invalid_input", "auth logout requires --v1, --session, or --all")
        }
        if (command.opts().dryRun) {
          return {
            data: { dryRun: true, scope, cacheRetained: true },
            meta: context.metadata("local"),
          }
        }
        const removed = await removeCredentials({
          profile: context.profile.name,
          host: context.profile.host,
          scope,
          credentialsFile: context.paths.credentialsFile,
        })
        return {
          data: { removed, cacheRetained: true, cacheFile: context.paths.cacheFile },
          meta: context.metadata("local"),
        }
      })
    })
}

function safeIdentity(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of ["id", "userId"] as const) {
    const candidate = record[key]
    if (typeof candidate === "string" || typeof candidate === "number") result[key] = candidate
  }
  return Object.keys(result).length ? result : undefined
}

function accountIdentity(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const key of ["id", "userId"] as const) {
    const candidate = record[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate)
  }
  return undefined
}

function premiumState(value: unknown): boolean | "unknown" {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown"
  const record = value as Record<string, unknown>
  for (const key of ["pro", "premium", "isPremium"] as const) {
    if (typeof record[key] === "boolean") return record[key]
  }
  return "unknown"
}
