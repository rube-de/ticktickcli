import type { OutputEnvelope } from "./contract"
import { selectEnvelopeFields, serializeJson } from "./json"

export type OutputMode = "json" | "human" | "plain" | "csv"

export interface RenderOutputOptions {
  mode?: OutputMode
  fields?: string | readonly string[]
  prettyJson?: boolean
}

/** Render untrusted remote text without allowing terminal escape/control injection. */
export function neutralizeTerminalText(value: string): string {
  let result = ""
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number
    if (character === "\n") result += "\\n"
    else if (character === "\r") result += "\\r"
    else if (character === "\t") result += "\\t"
    else if (
      codePoint < 0x20 ||
      codePoint === 0x7f ||
      (codePoint >= 0x80 && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      result += `\\u${codePoint.toString(16).padStart(4, "0")}`
    } else result += character
  }
  return result
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return neutralizeTerminalText(value)
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? "" : neutralizeTerminalText(serialized)
  } catch {
    return "[unrenderable]"
  }
}

function fieldNames(data: unknown, fields?: string | readonly string[]): string[] {
  if (fields) {
    return (typeof fields === "string" ? fields.split(",") : [...fields])
      .map((field) => field.trim())
      .filter(Boolean)
  }
  const rows = Array.isArray(data) ? data : [data]
  const names = new Set<string>()
  for (const row of rows) {
    if (typeof row === "object" && row !== null && !Array.isArray(row)) {
      for (const key of Object.keys(row)) names.add(key)
    }
  }
  return [...names]
}

function getField(row: unknown, field: string): unknown {
  let value = row
  for (const component of field.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[component]
  }
  return value
}

export function renderPlain(data: unknown, fields?: string | readonly string[]): string {
  const rows = Array.isArray(data) ? data : [data]
  const names = fieldNames(data, fields)
  if (names.length === 0) return `${scalar(data)}\n`
  return `${rows.map((row) => names.map((name) => scalar(getField(row, name))).join("\t")).join("\n")}\n`
}

function csvCell(value: unknown): string {
  const text = scalar(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function renderCsv(data: unknown, fields?: string | readonly string[]): string {
  const rows = Array.isArray(data) ? data : [data]
  const names = fieldNames(data, fields)
  if (names.length === 0) return `${csvCell(data)}\r\n`
  const lines = [
    names.map(csvCell).join(","),
    ...rows.map((row) => names.map((name) => csvCell(getField(row, name))).join(",")),
  ]
  return `${lines.join("\r\n")}\r\n`
}

export function renderHuman(data: unknown, fields?: string | readonly string[]): string {
  const rows = Array.isArray(data) ? data : [data]
  const names = fieldNames(data, fields)
  if (names.length === 0) return `${scalar(data)}\n`

  const cells = rows.map((row) => names.map((name) => scalar(getField(row, name))))
  const widths = names.map((name, index) =>
    Math.max(name.length, ...cells.map((row) => row[index]?.length ?? 0)),
  )
  const renderRow = (row: readonly string[]) =>
    row
      .map((value, index) => value.padEnd(widths[index] ?? value.length))
      .join("  ")
      .trimEnd()
  return `${[renderRow(names), ...cells.map(renderRow)].join("\n")}\n`
}

export function renderOutput(envelope: OutputEnvelope, options: RenderOutputOptions = {}): string {
  const mode = options.mode ?? "human"
  if (mode === "json") {
    return serializeJson(selectEnvelopeFields(envelope, options.fields), options.prettyJson)
  }
  if (!envelope.ok) {
    return `${neutralizeTerminalText(envelope.error.message)}\n`
  }
  if (mode === "csv") return renderCsv(envelope.data, options.fields)
  if (mode === "plain") return renderPlain(envelope.data, options.fields)
  return renderHuman(envelope.data, options.fields)
}
