import { Temporal } from "@js-temporal/polyfill"

import type { DomainTask, TaskPriority, TaskStatus } from "../domain/models"
import {
  type RelativeDateKeyword,
  dateInProfileTimeZone,
  normalizeDateTime,
  resolveDateExpression,
} from "./dates"

export type FilterDateExpression = RelativeDateKeyword | string

export type FilterPredicate =
  | { kind: "project"; value: string }
  | { kind: "tag"; value: string; include: boolean }
  | { kind: "priority"; value: TaskPriority }
  | { kind: "due_on"; value: FilterDateExpression }
  | { kind: "due_before"; value: FilterDateExpression }
  | { kind: "start_after"; value: FilterDateExpression }
  | { kind: "text_contains"; value: string }
  | { kind: "title_contains"; value: string }
  | { kind: "status"; value: TaskStatus }

export interface FilterAst {
  kind: "and"
  terms: readonly FilterPredicate[]
}

export class FilterSyntaxError extends Error {
  readonly token?: string

  constructor(message: string, token?: string) {
    super(message)
    this.name = "FilterSyntaxError"
    this.token = token
  }
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let token = ""
  let quote: '"' | "'" | undefined
  let escaping = false

  const finish = () => {
    if (token) tokens.push(token)
    token = ""
  }

  for (const character of input) {
    if (escaping) {
      token += character
      escaping = false
      continue
    }
    if (character === "\\") {
      escaping = true
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else token += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) finish()
    else token += character
  }

  if (escaping) token += "\\"
  if (quote) throw new FilterSyntaxError("Unterminated quoted filter value")
  finish()
  return tokens
}

function requiredValue(token: string, value: string | undefined): string {
  if (!value) throw new FilterSyntaxError(`Filter clause requires a value: ${token}`, token)
  return value
}

function parsePriority(value: string, token: string): TaskPriority {
  switch (value.toLowerCase()) {
    case "none":
      return 0
    case "low":
      return 1
    case "medium":
      return 3
    case "high":
      return 5
    default:
      throw new FilterSyntaxError(`Unsupported priority: ${value}`, token)
  }
}

function parseStatus(value: string, token: string): TaskStatus {
  switch (value.toLowerCase()) {
    case "open":
      return "open"
    case "done":
    case "completed":
      return "completed"
    case "wontdo":
    case "wont_do":
    case "abandoned":
      return "wont_do"
    default:
      throw new FilterSyntaxError(`Unsupported task status: ${value}`, token)
  }
}

export function parseFilter(input: string | readonly string[]): FilterAst {
  const tokens = typeof input === "string" ? tokenize(input) : [...input]
  const terms: FilterPredicate[] = []

  for (const token of tokens) {
    if (!token) continue
    if (token.includes("(") || token.includes(")") || token === "OR" || token === "or") {
      throw new FilterSyntaxError(
        "OR and parentheses are not supported by the initial grammar",
        token,
      )
    }

    if (token.startsWith("project:")) {
      terms.push({ kind: "project", value: requiredValue(token, token.slice("project:".length)) })
      continue
    }
    if (token.startsWith("due.before:")) {
      terms.push({
        kind: "due_before",
        value: requiredValue(token, token.slice("due.before:".length)),
      })
      continue
    }
    if (token.startsWith("due:")) {
      terms.push({ kind: "due_on", value: requiredValue(token, token.slice("due:".length)) })
      continue
    }
    if (token.startsWith("start.after:")) {
      terms.push({
        kind: "start_after",
        value: requiredValue(token, token.slice("start.after:".length)),
      })
      continue
    }
    if (token.startsWith("status:")) {
      const value = requiredValue(token, token.slice("status:".length))
      terms.push({ kind: "status", value: parseStatus(value, token) })
      continue
    }
    if (token.startsWith("text~")) {
      terms.push({
        kind: "text_contains",
        value: requiredValue(token, token.slice("text~".length)),
      })
      continue
    }
    if (token.startsWith("+")) {
      terms.push({ kind: "tag", value: requiredValue(token, token.slice(1)), include: true })
      continue
    }
    if (token.startsWith("-")) {
      terms.push({ kind: "tag", value: requiredValue(token, token.slice(1)), include: false })
      continue
    }
    if (token.startsWith("!")) {
      const value = requiredValue(token, token.slice(1))
      terms.push({ kind: "priority", value: parsePriority(value, token) })
      continue
    }
    if (/^[a-z][a-z0-9_.-]*[:~]/i.test(token)) {
      throw new FilterSyntaxError(`Unsupported filter clause: ${token}`, token)
    }

    terms.push({ kind: "title_contains", value: token })
  }

  return { kind: "and", terms }
}

export type FilterPredicateKind = FilterPredicate["kind"]

export interface FilterPartition {
  remote: FilterAst
  local: FilterAst
}

/**
 * Compilation is conservative by default. Callers must explicitly supply the
 * predicate kinds whose remote semantics were verified for the selected API.
 */
export function partitionFilter(
  ast: FilterAst,
  verifiedRemoteKinds: ReadonlySet<FilterPredicateKind> = new Set(),
): FilterPartition {
  const remote: FilterPredicate[] = []
  const local: FilterPredicate[] = []
  for (const predicate of ast.terms) {
    ;(verifiedRemoteKinds.has(predicate.kind) ? remote : local).push(predicate)
  }
  return {
    remote: { kind: "and", terms: remote },
    local: { kind: "and", terms: local },
  }
}

export interface FilterEvaluationContext {
  timeZone: string
  now?: Temporal.Instant | string
  projectNames?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase()
}

function projectName(context: FilterEvaluationContext, projectId: string): string | undefined {
  const names = context.projectNames
  if (!names) return undefined
  if ("get" in names && typeof names.get === "function") return names.get(projectId)
  return (names as Readonly<Record<string, string>>)[projectId]
}

function taskDate(
  task: DomainTask,
  value: string | undefined,
  context: FilterEvaluationContext,
): Temporal.PlainDate | undefined {
  if (!value) return undefined
  try {
    const normalized = normalizeDateTime(value, {
      timeZone: task.timeZone ?? context.timeZone,
      isAllDay: task.isAllDay,
      isFloating: task.isFloating,
    })
    return Temporal.PlainDate.from(dateInProfileTimeZone(normalized, context.timeZone))
  } catch {
    return undefined
  }
}

function evaluatePredicate(
  predicate: FilterPredicate,
  task: DomainTask,
  context: FilterEvaluationContext,
): boolean {
  switch (predicate.kind) {
    case "project": {
      const wanted = normalizeText(predicate.value)
      return (
        normalizeText(task.projectId) === wanted ||
        normalizeText(projectName(context, task.projectId) ?? "") === wanted
      )
    }
    case "tag": {
      const wanted = normalizeText(predicate.value)
      const present = task.tags.some((tag) => normalizeText(tag) === wanted)
      return predicate.include ? present : !present
    }
    case "priority":
      return task.priority === predicate.value
    case "status":
      return task.status === predicate.value
    case "title_contains":
      return normalizeText(task.title).includes(normalizeText(predicate.value))
    case "text_contains": {
      const haystack = normalizeText(
        [task.title, task.content ?? "", task.description ?? ""].join("\n"),
      )
      return haystack.includes(normalizeText(predicate.value))
    }
    case "due_on": {
      const due = taskDate(task, task.dueDate, context)
      const wanted = resolveDateExpression(predicate.value, context.timeZone, context.now)
      return due !== undefined && Temporal.PlainDate.compare(due, wanted) === 0
    }
    case "due_before": {
      const due = taskDate(task, task.dueDate, context)
      const wanted = resolveDateExpression(predicate.value, context.timeZone, context.now)
      return due !== undefined && Temporal.PlainDate.compare(due, wanted) < 0
    }
    case "start_after": {
      const start = taskDate(task, task.startDate, context)
      const wanted = resolveDateExpression(predicate.value, context.timeZone, context.now)
      return start !== undefined && Temporal.PlainDate.compare(start, wanted) > 0
    }
  }
}

export function evaluateFilter(
  ast: FilterAst,
  task: DomainTask,
  context: FilterEvaluationContext,
): boolean {
  return ast.terms.every((predicate) => evaluatePredicate(predicate, task, context))
}
