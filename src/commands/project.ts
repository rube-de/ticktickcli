import type { Command } from "commander"
import { AppError, reconcileAfterWrite } from "../api/errors"
import { mapV1Project } from "../api/v1/mapper"
import type { V1Project } from "../api/v1/schemas"
import type { AppContext } from "../app/context"
import { cachedProjectToDomain, ensureCoreState, resolveProject } from "../app/state"
import type { ProjectInput } from "../domain/inputs"
import type { DomainProject } from "../domain/models"
import { dryRunResult, requireConfirmation } from "./common"
import { addWriteOptions, executeCommand } from "./runtime"

export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("Manage projects")

  project.command("list").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      const state = await ensureCoreState(context)
      return {
        data: context.repositories.listProjects().map(cachedProjectToDomain).map(publicProject),
        meta: context.metadata(state.source, {
          fetchedAt: state.fetchedAt,
          stale: state.stale,
        }),
      }
    })
  })

  project
    .command("show")
    .argument("<id-or-name>")
    .action(async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        const resolved = await resolveProject(context, query)
        return {
          data: publicProject(cachedProjectToDomain(resolved)),
          meta: context.metadata("cache"),
        }
      })
    })

  addWriteOptions(
    project
      .command("add")
      .requiredOption("--name <name>")
      .option("--color <hex>")
      .option("--group <id>")
      .option("--view <mode>", "list, kanban, or timeline")
      .option("--kind <kind>", "task or note"),
  ).action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("project.add")
      const options = command.opts()
      const input = projectInput(options)
      if (options.dryRun)
        return { data: dryRunResult("project.add", input), meta: context.metadata("local") }
      assertOnlineV1(context)
      const before = new Set(context.repositories.listProjects().map(({ id }) => id))
      const response = await context.v1.createProject(input)
      const result = await reconcileCreatedProject(context, input, response, before)
      return {
        data: publicProject(result),
        meta: context.metadata("v1", { fetchedAt: result.fetchedAt }),
      }
    })
  })

  addWriteOptions(
    project
      .command("edit")
      .argument("<id-or-name>")
      .option("--name <name>")
      .option("--color <hex>")
      .option("--group <id>")
      .option("--clear-group")
      .option("--view <mode>")
      .option("--kind <kind>"),
  ).action(async (query: string, _options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("project.edit")
      const project = await resolveProject(context, query)
      const options = command.opts()
      const patch: Partial<ProjectInput> = {
        ...(options.name ? { name: options.name } : {}),
        ...(options.color ? { color: options.color } : {}),
        ...(options.group
          ? { groupId: options.group }
          : options.clearGroup
            ? { groupId: null }
            : {}),
        ...(options.view ? { viewMode: projectView(options.view) } : {}),
        ...(options.kind ? { kind: projectKind(options.kind) } : {}),
      }
      if (Object.keys(patch).length === 0)
        throw new AppError("invalid_input", "At least one edit option is required")
      if (options.dryRun)
        return {
          data: dryRunResult("project.edit", { id: project.id, patch }),
          meta: context.metadata("local"),
        }
      assertOnlineV1(context)
      const response = await context.v1.updateProject(project.id, patch)
      const wire =
        response ??
        (await reconcileAfterWrite("project.edit", { projectId: project.id }, () =>
          context.v1.getProject(project.id),
        ))
      context.repositories.upsertProjects([{ ...wire }], "v1")
      const result = mapV1Project(wire)
      return {
        data: publicProject(result),
        meta: context.metadata("v1", { fetchedAt: result.fetchedAt }),
      }
    })
  })

  addWriteOptions(project.command("delete").argument("<id-or-name>")).action(
    async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("project.delete")
        const project = await resolveProject(context, query)
        if (command.opts().dryRun)
          return {
            data: dryRunResult("project.delete", { id: project.id }),
            meta: context.metadata("local"),
          }
        requireConfirmation(command.opts(), "delete the project and its tasks")
        assertOnlineV1(context)
        await context.v1.deleteProject(project.id)
        context.store.transaction(() => {
          context.repositories.deleteProjects([project.id])
          context.repositories.deleteTasks(
            context.repositories
              .listTasks({ projectId: project.id, includeDeleted: true })
              .map(({ id }) => id),
          )
          context.repositories.invalidate("core")
        })
        return { data: { deleted: project.id }, meta: context.metadata("v1") }
      })
    },
  )

  registerArchive(project, false)
  registerArchive(project, true)
}

function registerArchive(parent: Command, unarchive: boolean): void {
  const verb = unarchive ? "unarchive" : "archive"
  addWriteOptions(parent.command(verb).argument("<id-or-name>")).action(
    async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability(`project.${verb}`)
        const project = await resolveProject(context, query)
        const request = { id: project.id, closed: !unarchive }
        if (command.opts().dryRun)
          return { data: dryRunResult(`project.${verb}`, request), meta: context.metadata("local") }
        context.assertOnline()
        if (!context.v2) throw new AppError("authentication_missing", "A v2 session is required")
        const result = await context.v2.setProjectArchived(project.id, !unarchive)
        context.repositories.invalidate("core")
        return { data: result, meta: context.metadata("v2") }
      })
    },
  )
}

async function reconcileCreatedProject(
  context: AppContext,
  input: ProjectInput,
  response: V1Project | undefined,
  before: ReadonlySet<string>,
): Promise<DomainProject> {
  const v1 = context.v1
  if (!v1) throw new AppError("authentication_missing", "A v1 token is required")
  if (response) {
    context.repositories.upsertProjects([{ ...response }], "v1")
    return mapV1Project(response)
  }
  const projects = await reconcileAfterWrite("project.add", { name: input.name }, () =>
    v1.listProjects(),
  )
  context.repositories.upsertProjects(
    projects.map((project) => ({ ...project })),
    "v1",
  )
  const candidates = projects.filter(
    (project) => !before.has(project.id) && project.name === input.name,
  )
  if (candidates.length !== 1) {
    throw new AppError(
      "write_outcome_unknown",
      "Project creation succeeded but readback was ambiguous",
      {
        details: { candidateIds: candidates.map(({ id }) => id) },
      },
    )
  }
  return mapV1Project(candidates[0] as V1Project)
}

function projectInput(options: Record<string, unknown>): ProjectInput {
  if (typeof options.name !== "string" || options.name.trim().length === 0) {
    throw new AppError("invalid_input", "Project name is required")
  }
  return {
    name: options.name,
    ...(typeof options.color === "string" ? { color: options.color } : {}),
    ...(typeof options.group === "string" ? { groupId: options.group } : {}),
    ...(typeof options.view === "string" ? { viewMode: projectView(options.view) } : {}),
    ...(typeof options.kind === "string" ? { kind: projectKind(options.kind) } : {}),
  }
}

function projectView(value: string): "list" | "kanban" | "timeline" {
  if (value === "list" || value === "kanban" || value === "timeline") return value
  throw new AppError("invalid_input", `Invalid project view: ${value}`)
}

function projectKind(value: string): "task" | "note" {
  if (value === "task" || value === "note") return value
  throw new AppError("invalid_input", `Invalid project kind: ${value}`)
}

function assertOnlineV1(
  context: AppContext,
): asserts context is AppContext & { v1: NonNullable<AppContext["v1"]> } {
  if (context.options.offline) throw new AppError("invalid_input", "Mutations are online-only")
  if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
}

function publicProject(project: DomainProject): Record<string, unknown> {
  const { raw: _raw, ...safe } = project
  return safe
}
