export interface CommandDescriptor {
  path: readonly string[]
  summary: string
  stable?: boolean
}

/** Shared by completion/docs tooling. Source-only mutations are intentionally absent. */
export const COMMAND_METADATA: readonly CommandDescriptor[] = [
  { path: ["task", "add"], summary: "Create a task" },
  { path: ["task", "list"], summary: "List active tasks" },
  { path: ["task", "show"], summary: "Show one task" },
  { path: ["task", "edit"], summary: "Edit a task" },
  { path: ["task", "complete"], summary: "Complete tasks" },
  { path: ["task", "delete"], summary: "Delete tasks" },
  { path: ["task", "move"], summary: "Move a task" },
  { path: ["task", "reopen"], summary: "Reopen a task" },
  { path: ["task", "completed"], summary: "List completed tasks" },
  { path: ["task", "pin"], summary: "Pin a task" },
  { path: ["task", "unpin"], summary: "Unpin a task" },
  { path: ["task", "checklist", "add"], summary: "Add a checklist item" },
  { path: ["task", "checklist", "complete"], summary: "Complete a checklist item" },
  { path: ["task", "checklist", "delete"], summary: "Delete a checklist item" },
  { path: ["comment", "list"], summary: "List task comments" },
  { path: ["comment", "add"], summary: "Add a task comment" },
  { path: ["comment", "delete"], summary: "Delete a task comment" },
  { path: ["project", "list"], summary: "List projects" },
  { path: ["project", "show"], summary: "Show a project" },
  { path: ["project", "add"], summary: "Create a project" },
  { path: ["project", "edit"], summary: "Edit a project" },
  { path: ["project", "delete"], summary: "Delete a project" },
  { path: ["project", "archive"], summary: "Archive a project" },
  { path: ["project", "unarchive"], summary: "Unarchive a project" },
  { path: ["group", "list"], summary: "List project groups" },
  { path: ["group", "add"], summary: "Create a project group" },
  { path: ["group", "rename"], summary: "Rename a project group" },
  { path: ["group", "delete"], summary: "Delete a project group" },
  { path: ["column", "list"], summary: "List project columns" },
  { path: ["column", "add"], summary: "Create a project column" },
  { path: ["column", "edit"], summary: "Edit a project column" },
  { path: ["column", "delete"], summary: "Delete a project column" },
  { path: ["tag", "list"], summary: "List tags" },
  { path: ["tag", "add"], summary: "Create a tag" },
  { path: ["tag", "rename"], summary: "Rename a tag" },
  { path: ["tag", "merge"], summary: "Merge tags" },
  { path: ["tag", "delete"], summary: "Delete a tag" },
  { path: ["filter", "list"], summary: "List saved filters" },
  { path: ["filter", "show"], summary: "Show a saved filter" },
  { path: ["filter", "add"], summary: "Create a saved filter" },
  { path: ["filter", "edit"], summary: "Edit a saved filter" },
  { path: ["filter", "delete"], summary: "Delete a saved filter" },
  { path: ["habit", "list"], summary: "List habits" },
  { path: ["habit", "show"], summary: "Show a habit" },
  { path: ["habit", "checkin"], summary: "Check in habits" },
  { path: ["habit", "log"], summary: "List habit check-ins" },
  { path: ["habit", "add"], summary: "Create a habit" },
  { path: ["habit", "edit"], summary: "Edit a habit" },
  { path: ["habit", "stats"], summary: "Show habit statistics" },
  { path: ["focus", "list"], summary: "List focus records" },
  { path: ["focus", "log"], summary: "Log focus time" },
  { path: ["focus", "delete"], summary: "Delete a focus record" },
  { path: ["focus", "stats"], summary: "Show focus statistics" },
  { path: ["focus", "heatmap"], summary: "Show a focus heatmap" },
  { path: ["calendar", "accounts"], summary: "List calendar accounts" },
  { path: ["calendar", "subscriptions"], summary: "List calendar subscriptions" },
  { path: ["calendar", "events"], summary: "List calendar events" },
  { path: ["trash", "list"], summary: "List trashed tasks" },
  { path: ["trash", "restore"], summary: "Restore a trashed task" },
  { path: ["auth", "token"], summary: "Save a v1 API token" },
  { path: ["auth", "session"], summary: "Save a v2 session" },
  { path: ["auth", "status"], summary: "Show credential status" },
  { path: ["auth", "logout"], summary: "Remove credentials" },
  { path: ["profile", "list"], summary: "List profiles" },
  { path: ["profile", "add"], summary: "Add a profile" },
  { path: ["profile", "remove"], summary: "Remove a profile" },
  { path: ["profile", "use"], summary: "Select a profile" },
  { path: ["cache", "status"], summary: "Show cache status" },
  { path: ["cache", "clear"], summary: "Clear cached account data" },
  { path: ["context", "list"], summary: "List saved contexts" },
  { path: ["context", "use"], summary: "Select a context" },
  { path: ["context", "off"], summary: "Disable the active context" },
  { path: ["alias", "list"], summary: "List aliases" },
  { path: ["alias", "set"], summary: "Set an argument alias" },
  { path: ["alias", "remove"], summary: "Remove an alias" },
  { path: ["config", "get"], summary: "Read configuration" },
  { path: ["config", "set"], summary: "Set configuration" },
  { path: ["completion", "bash"], summary: "Print Bash completion" },
  { path: ["completion", "zsh"], summary: "Print Zsh completion" },
  { path: ["completion", "fish"], summary: "Print Fish completion" },
  { path: ["api", "get"], summary: "Perform a read-only relative API request" },
  { path: ["export", "ics"], summary: "Export tasks as RFC 5545 calendar data" },
  { path: ["sync"], summary: "Synchronize local state" },
  { path: ["doctor"], summary: "Diagnose configuration and credentials" },
  { path: ["search"], summary: "Search tasks" },
  { path: ["stats"], summary: "Show account statistics" },
  { path: ["countdown", "list"], summary: "List countdowns" },
  { path: ["today"], summary: "Show today's tasks" },
  { path: ["tomorrow"], summary: "Show tomorrow's tasks" },
  { path: ["week"], summary: "Show this week's tasks" },
  { path: ["inbox"], summary: "Show inbox tasks" },
  { path: ["overdue"], summary: "Show overdue tasks" },
  { path: ["upcoming"], summary: "Show upcoming tasks" },
  { path: ["all"], summary: "Show all active tasks" },
  { path: ["next"], summary: "Show the next recommended task" },
  { path: ["agenda"], summary: "Show a date agenda" },
  { path: ["add"], summary: "Quick-add a task" },
] as const

export function topLevelCommands(): string[] {
  return [
    ...new Set(
      COMMAND_METADATA.map((descriptor) => descriptor.path[0]).filter(Boolean) as string[],
    ),
  ].sort()
}

export function childCommands(parent: string): string[] {
  return nextCommands([parent])
}

export function nextCommands(path: readonly string[]): string[] {
  return [
    ...new Set(
      COMMAND_METADATA.filter(
        (descriptor) =>
          descriptor.path.length > path.length &&
          path.every((part, index) => descriptor.path[index] === part),
      )
        .map((descriptor) => descriptor.path[path.length])
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort()
}

export function commandPrefixes(): string[][] {
  const prefixes = new Map<string, string[]>()
  for (const descriptor of COMMAND_METADATA) {
    for (let length = 1; length < descriptor.path.length; length += 1) {
      const prefix = descriptor.path.slice(0, length) as string[]
      prefixes.set(prefix.join("\u0000"), prefix)
    }
  }
  return [...prefixes.values()].sort(
    (left, right) => right.length - left.length || left.join(" ").localeCompare(right.join(" ")),
  )
}
