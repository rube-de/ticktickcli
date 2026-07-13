import { commandPrefixes, nextCommands, topLevelCommands } from "./metadata"

export type CompletionShell = "bash" | "zsh" | "fish"

export function generateCompletion(shell: CompletionShell): string {
  const top = topLevelCommands().join(" ")
  switch (shell) {
    case "bash":
      return `# bash completion for tt
_tt_complete() {
  local cur path
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W '${top}' -- "$cur") )
    return
  fi
  path="\${COMP_WORDS[*]:1:COMP_CWORD-1}"
  case "$path" in
${bashCases()}
  esac
}
complete -F _tt_complete tt
`
    case "zsh":
      return `#compdef tt
_tt() {
  local -a commands
  local path
  commands=(${top})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  path="\${(j: :)words[2,CURRENT-1]}"
  case "$path" in
${zshCases()}
  esac
}
_tt "$@"
`
    case "fish":
      return `# fish completion for tt
complete -c tt -f
${topLevelCommands()
  .map((command) => `complete -c tt -n '__fish_use_subcommand' -a '${command}'`)
  .join("\n")}
${fishChildren()}
`
  }
}

function bashCases(): string {
  return commandPrefixes()
    .map((path) => {
      const children = nextCommands(path)
      return `    '${path.join(" ")}') COMPREPLY=( $(compgen -W '${children.join(" ")}' -- "$cur") ) ;;`
    })
    .join("\n")
}

function zshCases(): string {
  return commandPrefixes()
    .map((path) => {
      const children = nextCommands(path)
      return `    '${path.join(" ")}') _values 'command' ${children.join(" ")} ;;`
    })
    .join("\n")
}

function fishChildren(): string {
  return commandPrefixes()
    .map((path) => {
      const children = nextCommands(path)
      const seen = path.map((part) => `__fish_seen_subcommand_from ${part}`).join("; and ")
      const unseen = `not __fish_seen_subcommand_from ${children.join(" ")}`
      return `complete -c tt -n '${seen}; and ${unseen}' -a '${children.join(" ")}'`
    })
    .join("\n")
}
