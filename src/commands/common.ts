import { randomBytes } from "node:crypto"
import { AppError } from "../api/errors"
import type { TaskPriority } from "../domain/models"

export interface WriteOptions {
  dryRun?: boolean
  yes?: boolean
  noInput?: boolean
  json?: boolean
}

export function requireConfirmation(options: WriteOptions, subject: string): void {
  if (options.yes) return
  // Stable commands never guess or prompt in the execution layer. Interactive
  // frontends can rerun with --yes after presenting their own confirmation.
  throw new AppError("invalid_input", `Confirmation is required to ${subject}`, {
    details: { requiredFlag: "--yes" },
  })
}

export function splitCommaValues(values: readonly string[] | string | undefined): string[] {
  if (values === undefined) return []
  const source = typeof values === "string" ? [values] : values
  return source
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
}

export function parsePriority(value: string | number | undefined): TaskPriority | undefined {
  if (value === undefined) return undefined
  const normalized = String(value).toLowerCase()
  const priorities: Readonly<Record<string, TaskPriority>> = {
    none: 0,
    "0": 0,
    low: 1,
    "1": 1,
    medium: 3,
    normal: 3,
    "3": 3,
    high: 5,
    "5": 5,
  }
  const priority = priorities[normalized]
  if (priority === undefined) {
    throw new AppError("invalid_input", `Invalid priority: ${value}`, {
      details: { accepted: ["none", "low", "medium", "high"] },
    })
  }
  return priority
}

export function parseDuration(value: string): number {
  const normalized = value.trim().toLowerCase()
  const match =
    /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/.exec(
      normalized,
    )
  if (!match?.[1]) throw new AppError("invalid_input", `Invalid duration: ${value}`)
  const amount = Number(match[1])
  const unit = match[2] ?? "m"
  const seconds = unit.startsWith("h") ? amount * 3600 : unit.startsWith("s") ? amount : amount * 60
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new AppError("invalid_input", "Duration must be positive")
  }
  return Math.round(seconds)
}

export function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (cause) {
    throw new AppError("invalid_input", `${label} must be valid JSON`, { cause })
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("invalid_input", `${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function generatedId(): string {
  return randomBytes(12).toString("hex")
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : []
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("invalid_input", `${label} is required`)
  }
  return value.trim()
}

export function dryRunResult(operation: string, request: unknown): Record<string, unknown> {
  return { dryRun: true, operation, request }
}
