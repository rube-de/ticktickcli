const GLOBAL_BOOLEAN_OPTIONS = new Set([
  "--json",
  "--plain",
  "--csv",
  "--fresh",
  "--stale-ok",
  "--offline",
  "--no-input",
  "--verbose",
  "--no-color",
])

const GLOBAL_VALUE_OPTIONS = new Set(["--fields", "--profile", "--host", "--timezone"])

export type AliasDefinitions = Readonly<Record<string, readonly string[]>>

export interface AliasExpansionOptions {
  /** Node/Bun process argv has two launcher entries. Command-only arrays use zero. */
  prefixLength?: number
  maximumDepth?: number
  maximumTokens?: number
}

export type AliasExpansionErrorCode =
  | "invalid_alias_name"
  | "alias_cycle"
  | "alias_recursion_limit"
  | "alias_too_large"

export class AliasExpansionError extends Error {
  readonly code: AliasExpansionErrorCode
  readonly aliases: readonly string[]

  constructor(code: AliasExpansionErrorCode, message: string, aliases: readonly string[] = []) {
    super(message)
    this.name = "AliasExpansionError"
    this.code = code
    this.aliases = aliases
  }
}

export function normalizeAliasName(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized) || normalized.includes("..")) {
    throw new AliasExpansionError(
      "invalid_alias_name",
      "Alias names must be 1-64 ASCII letters, numbers, dots, underscores, or hyphens",
    )
  }
  return normalized
}

function aliasKeyForToken(value: string): string | undefined {
  try {
    return normalizeAliasName(value)
  } catch {
    return undefined
  }
}

function commandIndex(argv: readonly string[], prefixLength: number): number | undefined {
  for (let index = prefixLength; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) continue
    if (token === "--") return undefined

    const [name] = token.split("=", 1)
    if (name && GLOBAL_BOOLEAN_OPTIONS.has(name)) continue
    if (name && GLOBAL_VALUE_OPTIONS.has(name)) {
      if (!token.includes("=")) index += 1
      continue
    }
    // Unknown options belong to the real command parser; aliases never reinterpret them.
    if (token.startsWith("-")) return undefined
    return index
  }
  return undefined
}

export function expandAliases(
  argvValue: readonly string[],
  aliases: AliasDefinitions,
  options: AliasExpansionOptions = {},
): string[] {
  const prefixLength = options.prefixLength ?? 0
  const maximumDepth = options.maximumDepth ?? 32
  const maximumTokens = options.maximumTokens ?? 1_024
  if (prefixLength < 0 || prefixLength > argvValue.length) return [...argvValue]

  const argv = [...argvValue]
  const expanded: string[] = []

  for (let depth = 0; depth <= maximumDepth; depth += 1) {
    const index = commandIndex(argv, prefixLength)
    if (index === undefined) return argv
    const token = argv[index] as string
    const name = aliasKeyForToken(token)
    const replacement = name ? aliases[name] : undefined
    if (!name || !replacement) return argv

    if (expanded.includes(name)) {
      throw new AliasExpansionError(
        "alias_cycle",
        `Alias cycle detected: ${[...expanded, name].join(" -> ")}`,
        [...expanded, name],
      )
    }
    if (depth === maximumDepth) {
      throw new AliasExpansionError(
        "alias_recursion_limit",
        `Alias expansion exceeds the maximum depth of ${maximumDepth}`,
        expanded,
      )
    }

    expanded.push(name)
    argv.splice(index, 1, ...replacement)
    if (argv.length > maximumTokens) {
      throw new AliasExpansionError(
        "alias_too_large",
        `Alias expansion exceeds the maximum of ${maximumTokens} tokens`,
        expanded,
      )
    }
  }

  return argv
}

/** Expand a full Bun/Node argv while preserving its launcher and script entries. */
export function expandAliasArgv(
  argv: readonly string[],
  aliases: AliasDefinitions,
  options: Omit<AliasExpansionOptions, "prefixLength"> = {},
): string[] {
  return expandAliases(argv, aliases, { ...options, prefixLength: 2 })
}

export function validateAliasDefinitions(aliases: AliasDefinitions): void {
  for (const name of Object.keys(aliases)) expandAliases([name], aliases)
}
