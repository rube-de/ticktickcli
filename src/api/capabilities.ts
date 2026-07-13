import { CapabilityError } from "./errors"
import type { ResponseMode, RetryMode } from "./http"

export const API_HOSTS = ["ticktick.com", "dida365.com"] as const
export type ApiHost = (typeof API_HOSTS)[number]

export type ApiVersion = "v1" | "v2"
export type ApiTier = "DOCUMENTED_V1" | "OFFICIAL_CLIENT_V1" | "VERIFIED_V2" | "EXPERIMENTAL"
export type CredentialKind = "v1_token" | "v2_session"
export type VerificationState =
  | "DOCUMENTED"
  | "OFFICIAL_CLIENT"
  | "LIVE_VERIFIED"
  | "SOURCE_ONLY"
  | "UNVERIFIED"
export type PremiumRequirement = "not_required" | "required" | "unknown"
export type ReconciliationPolicy =
  | "none"
  | "readback_required"
  | "checkpoint_or_readback"
  | "outcome_unknown_on_transport_failure"
export type FallbackPolicy =
  | "none"
  | "known_unavailable_read_only"
  | "local_cache"
  | "v1_enumeration"

export interface CapabilityDefinition {
  id: string
  operation: string
  api: ApiVersion
  tier: ApiTier
  method: "GET" | "POST" | "PUT" | "DELETE"
  path: string
  hosts: readonly ApiHost[]
  credential: CredentialKind
  premium: PremiumRequirement
  verification: VerificationState
  verifiedAt?: string
  responseMode: ResponseMode
  retry: RetryMode
  reconciliation: ReconciliationPolicy
  destructive: boolean
  fallback: FallbackPolicy
  /** Stable help/selection may only use entries whose evidence gate is closed. */
  stable: boolean
}

const TICKTICK_ONLY = ["ticktick.com"] as const

const V1_READ = {
  api: "v1",
  tier: "DOCUMENTED_V1",
  // Dida365 resembles this API, but the plan's host verification gate is still open.
  hosts: TICKTICK_ONLY,
  credential: "v1_token",
  premium: "not_required",
  verification: "DOCUMENTED",
  responseMode: "JSON_REQUIRED",
  retry: "read",
  reconciliation: "none",
  destructive: false,
  fallback: "none",
  stable: true,
} as const

const V1_WRITE = {
  ...V1_READ,
  method: "POST",
  responseMode: "JSON_OPTIONAL",
  retry: "never",
  reconciliation: "outcome_unknown_on_transport_failure",
} as const

const V1_CLIENT_READ = {
  ...V1_READ,
  tier: "OFFICIAL_CLIENT_V1",
  hosts: TICKTICK_ONLY,
  verification: "OFFICIAL_CLIENT",
  verifiedAt: "2026-07-13",
} as const

const V1_CLIENT_WRITE = {
  ...V1_WRITE,
  tier: "OFFICIAL_CLIENT_V1",
  hosts: TICKTICK_ONLY,
  verification: "OFFICIAL_CLIENT",
  verifiedAt: "2026-07-13",
} as const

const V2_READ = {
  api: "v2",
  tier: "VERIFIED_V2",
  hosts: TICKTICK_ONLY,
  credential: "v2_session",
  premium: "unknown",
  verification: "LIVE_VERIFIED",
  verifiedAt: "2026-07-13",
  responseMode: "JSON_REQUIRED",
  retry: "read",
  reconciliation: "none",
  destructive: false,
  fallback: "none",
  stable: true,
} as const

const V2_WRITE = {
  ...V2_READ,
  method: "POST",
  retry: "reconcilable",
  reconciliation: "readback_required",
} as const

export const CAPABILITY_MANIFEST = [
  { ...V1_READ, id: "v1.project.list", operation: "project.list", method: "GET", path: "/project" },
  {
    ...V1_READ,
    id: "v1.project.show",
    operation: "project.show",
    method: "GET",
    path: "/project/{projectId}",
  },
  {
    ...V1_READ,
    id: "v1.project.data",
    operation: "project.data",
    method: "GET",
    path: "/project/{projectId}/data",
  },
  { ...V1_WRITE, id: "v1.project.add", operation: "project.add", path: "/project" },
  { ...V1_WRITE, id: "v1.project.edit", operation: "project.edit", path: "/project/{projectId}" },
  {
    ...V1_WRITE,
    id: "v1.project.delete",
    operation: "project.delete",
    method: "DELETE",
    path: "/project/{projectId}",
    responseMode: "NO_CONTENT",
    destructive: true,
  },

  {
    ...V1_READ,
    id: "v1.task.show",
    operation: "task.show",
    method: "GET",
    path: "/project/{projectId}/task/{taskId}",
  },
  { ...V1_WRITE, id: "v1.task.add", operation: "task.add", path: "/task" },
  { ...V1_WRITE, id: "v1.task.edit", operation: "task.edit", path: "/task/{taskId}" },
  {
    ...V1_WRITE,
    id: "v1.task.checklist",
    operation: "task.checklist.edit",
    path: "/task/{taskId}",
  },
  {
    ...V1_WRITE,
    id: "v1.task.reopen",
    operation: "task.reopen",
    path: "/task/{taskId}",
    verification: "LIVE_VERIFIED",
    verifiedAt: "2026-07-13",
  },
  {
    ...V1_WRITE,
    id: "v1.task.complete",
    operation: "task.complete",
    path: "/project/{projectId}/task/{taskId}/complete",
    responseMode: "NO_CONTENT",
  },
  {
    ...V1_WRITE,
    id: "v1.task.delete",
    operation: "task.delete",
    method: "DELETE",
    path: "/project/{projectId}/task/{taskId}",
    responseMode: "NO_CONTENT",
    destructive: true,
  },
  { ...V1_WRITE, id: "v1.task.move", operation: "task.move", path: "/task/move" },
  {
    ...V1_READ,
    id: "v1.task.completed",
    operation: "task.completed",
    method: "POST",
    path: "/task/completed",
    responseMode: "JSON_OPTIONAL",
  },
  {
    ...V1_READ,
    id: "v1.task.filter",
    operation: "task.filter",
    method: "POST",
    path: "/task/filter",
    responseMode: "JSON_OPTIONAL",
  },

  {
    ...V1_CLIENT_READ,
    id: "v1.inbox.data",
    operation: "inbox.data",
    method: "GET",
    path: "/project/inbox/data",
  },
  {
    ...V1_CLIENT_READ,
    id: "v1.comment.list",
    operation: "comment.list",
    method: "GET",
    path: "/project/{projectId}/task/{taskId}/comments",
  },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.comment.add",
    operation: "comment.add",
    path: "/project/{projectId}/task/{taskId}/comment",
    responseMode: "JSON_REQUIRED",
  },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.comment.delete",
    operation: "comment.delete",
    method: "DELETE",
    path: "/project/{projectId}/task/{taskId}/comment/{commentId}",
    responseMode: "NO_CONTENT",
    destructive: true,
  },
  {
    ...V1_CLIENT_READ,
    id: "v1.group.list",
    operation: "group.list",
    method: "GET",
    path: "/project/group",
  },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.group.add",
    operation: "group.add",
    path: "/project/group",
    responseMode: "JSON_REQUIRED",
  },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.group.edit",
    operation: "group.edit",
    path: "/project/group/{groupId}",
    responseMode: "JSON_REQUIRED",
  },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.group.delete",
    operation: "group.delete",
    method: "DELETE",
    path: "/project/group/{groupId}",
    responseMode: "NO_CONTENT",
    destructive: true,
  },
  {
    ...V1_CLIENT_READ,
    id: "v1.column.list",
    operation: "column.list",
    method: "GET",
    path: "/project/{projectId}/column",
  },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.column.add",
    operation: "column.add",
    path: "/project/{projectId}/column",
    responseMode: "JSON_REQUIRED",
  },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.column.edit",
    operation: "column.edit",
    path: "/project/{projectId}/column/{columnId}",
    responseMode: "JSON_REQUIRED",
  },
  { ...V1_CLIENT_READ, id: "v1.tag.list", operation: "tag.list", method: "GET", path: "/tag" },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.tag.add",
    operation: "tag.add",
    path: "/tag",
    responseMode: "JSON_REQUIRED",
  },
  {
    ...V1_CLIENT_READ,
    id: "v1.countdown.list",
    operation: "countdown.list",
    method: "GET",
    path: "/countdown",
  },

  { ...V1_READ, id: "v1.habit.list", operation: "habit.list", method: "GET", path: "/habit" },
  {
    ...V1_READ,
    id: "v1.habit.show",
    operation: "habit.show",
    method: "GET",
    path: "/habit/{habitId}",
  },
  { ...V1_WRITE, id: "v1.habit.add", operation: "habit.add", path: "/habit" },
  { ...V1_WRITE, id: "v1.habit.edit", operation: "habit.edit", path: "/habit/{habitId}" },
  {
    ...V1_WRITE,
    id: "v1.habit.checkin",
    operation: "habit.checkin",
    path: "/habit/{habitId}/checkin",
  },
  {
    ...V1_READ,
    id: "v1.habit.checkins",
    operation: "habit.log",
    method: "GET",
    path: "/habit/checkins",
  },
  {
    ...V1_READ,
    id: "v1.focus.show",
    operation: "focus.show",
    method: "GET",
    path: "/focus/{focusId}",
  },
  { ...V1_READ, id: "v1.focus.list", operation: "focus.list", method: "GET", path: "/focus" },
  {
    ...V1_CLIENT_WRITE,
    id: "v1.focus.log",
    operation: "focus.log",
    path: "/focus",
    responseMode: "JSON_REQUIRED",
  },
  {
    ...V1_WRITE,
    id: "v1.focus.delete",
    operation: "focus.delete",
    method: "DELETE",
    path: "/focus/{focusId}",
    responseMode: "JSON_REQUIRED",
    destructive: true,
  },

  {
    ...V2_READ,
    id: "v2.sync.full",
    operation: "sync.full",
    method: "GET",
    path: "/batch/check/0",
    fallback: "v1_enumeration",
  },
  {
    ...V2_READ,
    id: "v2.trash.list",
    operation: "trash.list",
    method: "GET",
    path: "/project/all/trash/pagination",
  },
  { ...V2_WRITE, id: "v2.trash.restore", operation: "trash.restore", path: "/trash/restore" },
  {
    ...V2_WRITE,
    id: "v2.task.add.column",
    operation: "task.add.column",
    path: "/batch/task",
  },
  {
    ...V2_WRITE,
    id: "v2.task.edit.column",
    operation: "task.edit.column",
    path: "/batch/task",
  },
  { ...V2_WRITE, id: "v2.task.pin", operation: "task.pin", path: "/batch/task" },
  { ...V2_WRITE, id: "v2.task.unpin", operation: "task.unpin", path: "/batch/task" },
  {
    ...V2_READ,
    id: "v2.task.completed",
    operation: "task.completed.v2",
    method: "GET",
    path: "/project/all/closed",
  },
  {
    ...V2_WRITE,
    id: "v2.tag.rename",
    operation: "tag.rename",
    method: "PUT",
    path: "/tag/rename",
    responseMode: "JSON_OPTIONAL",
  },
  {
    ...V2_WRITE,
    id: "v2.tag.merge",
    operation: "tag.merge",
    method: "PUT",
    path: "/tag/merge",
    responseMode: "JSON_OPTIONAL",
  },
  {
    ...V2_WRITE,
    id: "v2.tag.delete",
    operation: "tag.delete",
    method: "DELETE",
    path: "/tag",
    responseMode: "NO_CONTENT",
    destructive: true,
  },
  {
    ...V2_READ,
    id: "v2.filter.list",
    operation: "filter.list",
    method: "GET",
    path: "/batch/check/0",
  },
  { ...V2_WRITE, id: "v2.filter.add", operation: "filter.add", path: "/batch/filter" },
  { ...V2_WRITE, id: "v2.filter.edit", operation: "filter.edit", path: "/batch/filter" },
  {
    ...V2_WRITE,
    id: "v2.filter.delete",
    operation: "filter.delete",
    path: "/batch/filter",
    destructive: true,
  },
  {
    ...V2_WRITE,
    id: "v2.column.delete",
    operation: "column.delete",
    path: "/column",
    destructive: true,
  },
  { ...V2_WRITE, id: "v2.project.archive", operation: "project.archive", path: "/batch/project" },
  {
    ...V2_WRITE,
    id: "v2.project.unarchive",
    operation: "project.unarchive",
    path: "/batch/project",
  },
  {
    ...V2_READ,
    id: "v2.stats.general",
    operation: "stats.general",
    method: "GET",
    path: "/statistics/general",
  },
  {
    ...V2_READ,
    id: "v2.focus.heatmap",
    operation: "focus.heatmap",
    method: "GET",
    path: "/pomodoros/statistics/heatmap/{from}/{to}",
  },
  {
    ...V2_READ,
    id: "v2.focus.distribution",
    operation: "focus.stats",
    method: "GET",
    path: "/pomodoros/statistics/dist/{from}/{to}",
  },
  {
    ...V2_READ,
    id: "v2.calendar.accounts",
    operation: "calendar.accounts",
    method: "GET",
    path: "/calendar/third/accounts",
  },
  {
    ...V2_READ,
    id: "v2.calendar.subscriptions",
    operation: "calendar.subscriptions",
    method: "GET",
    path: "/calendar/subscription",
  },
  {
    ...V2_READ,
    id: "v2.calendar.events",
    operation: "calendar.events",
    method: "GET",
    path: "/calendar/bind/events/all",
  },
  {
    ...V2_READ,
    id: "v2.calendar.archived",
    operation: "calendar.archived",
    method: "GET",
    path: "/calendar/archivedEvent",
  },

  // Gated entries are available to diagnostics, never to stable capability selection.
  {
    ...V2_READ,
    id: "v2.sync.incremental",
    operation: "sync.incremental",
    method: "GET",
    path: "/batch/check/{checkpoint}",
    tier: "EXPERIMENTAL",
    verification: "UNVERIFIED",
    verifiedAt: undefined,
    stable: false,
  },
  {
    ...V2_READ,
    id: "v2.search.all",
    operation: "search.remote",
    method: "GET",
    path: "/search/all",
    tier: "EXPERIMENTAL",
    verification: "SOURCE_ONLY",
    verifiedAt: undefined,
    fallback: "local_cache",
    stable: false,
  },
  {
    ...V2_READ,
    id: "v2.task.abandoned",
    operation: "task.abandoned",
    method: "GET",
    path: "/project/all/closed",
    tier: "EXPERIMENTAL",
    verification: "SOURCE_ONLY",
    verifiedAt: undefined,
    stable: false,
  },
  {
    ...V2_WRITE,
    id: "v2.habit.archive",
    operation: "habit.archive",
    path: "/habits/batch",
    tier: "EXPERIMENTAL",
    verification: "UNVERIFIED",
    verifiedAt: undefined,
    stable: false,
  },
  {
    ...V2_WRITE,
    id: "v2.batch.tag",
    operation: "tag.batch",
    path: "/batch/tag",
    tier: "EXPERIMENTAL",
    verification: "SOURCE_ONLY",
    verifiedAt: undefined,
    stable: false,
  },
  {
    ...V2_WRITE,
    id: "v2.focus.remote",
    operation: "focus.remote.write",
    path: "/batch/focusOp",
    tier: "EXPERIMENTAL",
    verification: "UNVERIFIED",
    verifiedAt: undefined,
    stable: false,
  },
] as const satisfies readonly CapabilityDefinition[]

export type Capability = (typeof CAPABILITY_MANIFEST)[number]
export type CapabilityId = Capability["id"]
export type CapabilityOperation = Capability["operation"]

export interface CapabilityContext {
  host: ApiHost
  hasV1Token: boolean
  hasV2Session: boolean
  allowExperimental?: boolean
}

export function getCapability(id: CapabilityId | string): Capability | undefined {
  return CAPABILITY_MANIFEST.find((capability) => capability.id === id)
}

export function capabilitiesFor(operation: CapabilityOperation | string): readonly Capability[] {
  return CAPABILITY_MANIFEST.filter((capability) => capability.operation === operation)
}

export function lookupCapability(
  operation: CapabilityOperation | string,
  context: CapabilityContext,
): Capability | undefined {
  const allowed = capabilitiesFor(operation).filter((capability) => {
    if (!(capability.hosts as readonly ApiHost[]).includes(context.host)) return false
    if (!context.allowExperimental && !capability.stable) return false
    if (capability.credential === "v1_token" && !context.hasV1Token) return false
    if (capability.credential === "v2_session" && !context.hasV2Session) return false
    return true
  })
  return [...allowed].sort((left, right) => tierRank(left.tier) - tierRank(right.tier))[0]
}

export function assertCapability(
  operation: CapabilityOperation | string,
  context: CapabilityContext,
): Capability {
  const capability = lookupCapability(operation, context)
  if (capability) return capability

  const candidates = capabilitiesFor(operation).filter(
    (candidate) => context.allowExperimental || candidate.stable,
  )
  if (candidates.length === 0) {
    throw new CapabilityError("capability_missing", "The operation is not available", { operation })
  }
  if (
    !candidates.some((candidate) => (candidate.hosts as readonly ApiHost[]).includes(context.host))
  ) {
    throw new CapabilityError("host_unsupported", "The operation is not verified for this host", {
      operation,
      host: context.host,
    })
  }

  const required = candidates.map((candidate) => candidate.credential)
  throw new CapabilityError("authentication_missing", "The operation requires another credential", {
    operation,
    required: [...new Set(required)],
  })
}

export function validateCapabilityManifest(): readonly string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const capability of CAPABILITY_MANIFEST as readonly CapabilityDefinition[]) {
    if (ids.has(capability.id)) problems.push(`duplicate capability id: ${capability.id}`)
    ids.add(capability.id)
    if (
      capability.stable &&
      (capability.verification === "SOURCE_ONLY" || capability.verification === "UNVERIFIED")
    ) {
      problems.push(`unstable evidence exposed as stable: ${capability.id}`)
    }
    if (capability.destructive && capability.retry === "idempotent") {
      problems.push(`destructive capability auto-retries: ${capability.id}`)
    }
  }
  return problems
}

function tierRank(tier: ApiTier): number {
  return {
    DOCUMENTED_V1: 0,
    OFFICIAL_CLIENT_V1: 1,
    VERIFIED_V2: 2,
    EXPERIMENTAL: 3,
  }[tier]
}
