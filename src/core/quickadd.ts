import type { TaskPriority } from "../domain/models"
import { parseRecurrenceExpression } from "./recur"

export interface QuickAddOptions {
  keepText?: boolean
  literalTitle?: boolean
}

export interface QuickAddResult {
  title: string
  tags: readonly string[]
  priority?: TaskPriority
  project?: string
  dateExpression?: string
  recurrenceRule?: string
}

export class QuickAddSyntaxError extends Error {
  readonly token?: string

  constructor(message: string, token?: string) {
    super(message)
    this.name = "QuickAddSyntaxError"
    this.token = token
  }
}

interface Lexeme {
  value: string
  raw: string
  quoted: boolean
  escaped: boolean
}

function lex(input: string): Lexeme[] {
  const values: Lexeme[] = []
  let value = ""
  let raw = ""
  let quote: '"' | "'" | undefined
  let quoted = false
  let escaping = false
  let escaped = false

  const finish = () => {
    if (raw) values.push({ value, raw, quoted, escaped })
    value = ""
    raw = ""
    quote = undefined
    quoted = false
    escaping = false
    escaped = false
  }

  for (const character of input) {
    if (escaping) {
      raw += character
      value += character
      escaping = false
      continue
    }
    if (character === "\\") {
      raw += character
      escaping = true
      if (!value) escaped = true
      continue
    }
    if (quote) {
      raw += character
      if (character === quote) quote = undefined
      else value += character
      continue
    }
    if (character === '"' || character === "'") {
      raw += character
      quote = character
      quoted = true
      continue
    }
    if (/\s/.test(character)) {
      finish()
      continue
    }
    raw += character
    value += character
  }

  if (quote) throw new QuickAddSyntaxError("Unterminated quoted title")
  if (escaping) value += "\\"
  finish()
  return values
}

function priorityFor(token: string): TaskPriority {
  switch (token.toLowerCase()) {
    case "none":
      return 0
    case "low":
      return 1
    case "medium":
      return 3
    case "high":
      return 5
    default:
      throw new QuickAddSyntaxError(`Unsupported priority: ${token}`, `!${token}`)
  }
}

function isSigil(lexeme: Lexeme): boolean {
  return !lexeme.quoted && !lexeme.escaped && /^[#!~^*]/.test(lexeme.value)
}

export function parseQuickAdd(input: string, options: QuickAddOptions = {}): QuickAddResult {
  const trimmed = input.trim()
  if (!trimmed) throw new QuickAddSyntaxError("Task title cannot be empty")
  if (options.literalTitle) return { title: trimmed, tags: [] }

  const lexemes = lex(input)
  const title: string[] = []
  const tags: string[] = []
  let priority: TaskPriority | undefined
  let project: string | undefined
  let dateExpression: string | undefined
  let recurrenceRule: string | undefined

  for (let index = 0; index < lexemes.length; index += 1) {
    const lexeme = lexemes[index]
    if (!lexeme) continue
    const token = lexeme.value

    if (!isSigil(lexeme)) {
      title.push(options.keepText ? lexeme.raw : token)
      continue
    }
    if (token.startsWith("#")) {
      const tag = token.slice(1)
      if (!tag) throw new QuickAddSyntaxError("Tag cannot be empty", token)
      if (!tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag)
      if (options.keepText) title.push(lexeme.raw)
      continue
    }
    if (token.startsWith("!")) {
      if (priority !== undefined)
        throw new QuickAddSyntaxError("Priority may be specified only once", token)
      priority = priorityFor(token.slice(1))
      if (options.keepText) title.push(lexeme.raw)
      continue
    }
    if (token.startsWith("~") || token.startsWith("^")) {
      if (project !== undefined)
        throw new QuickAddSyntaxError("Project may be specified only once", token)
      project = token.slice(1)
      if (!project) throw new QuickAddSyntaxError("Project cannot be empty", token)
      if (options.keepText) title.push(lexeme.raw)
      continue
    }
    if (token.startsWith("*")) {
      if (dateExpression || recurrenceRule) {
        throw new QuickAddSyntaxError("Date or recurrence may be specified only once", token)
      }
      const parts = [token.slice(1)]
      if (parts[0]?.toLowerCase() === "every") {
        while (index + 1 < lexemes.length && !isSigil(lexemes[index + 1] as Lexeme)) {
          index += 1
          parts.push((lexemes[index] as Lexeme).value)
        }
      }
      const expression = parts.join(" ").trim()
      if (!expression) throw new QuickAddSyntaxError("Date expression cannot be empty", token)
      if (
        /^(?:every\b|daily$|weekly$|monthly$|yearly$|annually$|weekdays$|RRULE:)/i.test(expression)
      ) {
        recurrenceRule = parseRecurrenceExpression(expression).rule
      } else {
        dateExpression = expression
      }
      if (options.keepText) title.push(`*${expression}`)
    }
  }

  const parsedTitle = title.join(" ").trim().replace(/\s+/g, " ")
  if (!parsedTitle) throw new QuickAddSyntaxError("Task title cannot be empty after parsing")

  return {
    title: parsedTitle,
    tags,
    ...(priority !== undefined ? { priority } : {}),
    ...(project ? { project } : {}),
    ...(dateExpression ? { dateExpression } : {}),
    ...(recurrenceRule ? { recurrenceRule } : {}),
  }
}
