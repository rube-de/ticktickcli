import { CliError, type OutputEnvelope } from "./contract"

function parseFields(fields: string | readonly string[]): string[][] {
  const values = typeof fields === "string" ? fields.split(",") : fields
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.split("."))
}

function getPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const component of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[component]
  }
  return current
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const [head, ...tail] = path
  if (!head) return
  if (tail.length === 0) {
    target[head] = value
    return
  }
  const child = target[head]
  const next = typeof child === "object" && child !== null && !Array.isArray(child) ? child : {}
  target[head] = next
  setPath(next as Record<string, unknown>, tail, value)
}

function pickObject(value: unknown, paths: readonly string[][]): unknown {
  if (Array.isArray(value)) return value.map((item) => pickObject(item, paths))
  if (typeof value !== "object" || value === null) return value
  const result: Record<string, unknown> = {}
  for (const path of paths) {
    const selected = getPath(value, path)
    if (selected !== undefined) setPath(result, path, selected)
  }
  return result
}

/** `--fields` applies only to successful envelope data, never to envelope metadata or errors. */
export function selectEnvelopeFields<T>(
  envelope: OutputEnvelope<T>,
  fields?: string | readonly string[],
): OutputEnvelope<unknown> {
  if (!fields || !envelope.ok) return envelope
  const paths = parseFields(fields)
  return paths.length === 0 ? envelope : { ...envelope, data: pickObject(envelope.data, paths) }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number" && !Number.isFinite(value)) return null
  return value
}

export function serializeJson(envelope: OutputEnvelope, pretty = false): string {
  try {
    return `${JSON.stringify(envelope, jsonReplacer, pretty ? 2 : undefined)}\n`
  } catch (cause) {
    throw new CliError("protocol_error", "Output could not be serialized as JSON", {}, { cause })
  }
}
