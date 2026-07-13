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

/** Commander normally requires global flags before subcommands; the stable tt contract does not. */
export function hoistGlobalOptions(argv: readonly string[]): string[] {
  if (argv.length < 2) return [...argv]
  const prefix = argv.slice(0, 2)
  const global: string[] = []
  const rest: string[] = []
  const profileAddCommandEnd = findProfileAddCommandEnd(argv)
  let literal = false

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) continue
    if (literal) {
      rest.push(token)
      continue
    }
    if (token === "--") {
      literal = true
      rest.push(token)
      continue
    }
    const [name] = token.split("=", 1)
    if (name && GLOBAL_BOOLEAN_OPTIONS.has(name)) {
      global.push(token)
      continue
    }
    if (name && GLOBAL_VALUE_OPTIONS.has(name)) {
      if (
        profileAddCommandEnd !== undefined &&
        index > profileAddCommandEnd &&
        (name === "--host" || name === "--timezone")
      ) {
        const localName = name === "--host" ? "--profile-add-host" : "--profile-add-timezone"
        rest.push(token.replace(name, localName))
        if (!token.includes("=")) {
          const value = argv[index + 1]
          if (value !== undefined) {
            rest.push(value)
            index += 1
          }
        }
        continue
      }
      global.push(token)
      if (!token.includes("=")) {
        const value = argv[index + 1]
        if (value !== undefined) {
          global.push(value)
          index += 1
        }
      }
      continue
    }
    rest.push(token)
  }
  return [...prefix, ...global, ...rest]
}

function findProfileAddCommandEnd(argv: readonly string[]): number | undefined {
  const commands: Array<{ token: string; index: number }> = []
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined || token === "--") break
    const [name] = token.split("=", 1)
    if (name && GLOBAL_BOOLEAN_OPTIONS.has(name)) continue
    if (name && GLOBAL_VALUE_OPTIONS.has(name)) {
      if (!token.includes("=")) index += 1
      continue
    }
    if (token.startsWith("-")) continue
    commands.push({ token, index })
    if (commands.length === 1 && token !== "profile") return undefined
    if (commands.length === 2) {
      return commands[0]?.token === "profile" && token === "add" ? index : undefined
    }
  }
  return undefined
}

export function isMachineInvocation(
  options: { json?: boolean; noInput?: boolean },
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    options.json === true ||
    options.noInput === true ||
    environment.CI === "true" ||
    environment.CI === "1" ||
    process.stdin.isTTY !== true
  )
}
