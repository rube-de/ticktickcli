import type { Command } from "commander"
import { AppError } from "../api/errors"
import type { AppContext } from "../app/context"
import { resolveProject, resolveTask } from "../app/state"
import { ResolutionError, requireResolved } from "../core/resolve"
import { dryRunResult, parseJsonObject, requireConfirmation } from "./common"
import { addWriteOptions, executeCommand } from "./runtime"

export function registerOrganizationCommands(program: Command): void {
  registerComments(program)
  registerGroups(program)
  registerColumns(program)
  registerTags(program)
  registerFilters(program)
  registerCountdown(program)
}

function registerComments(program: Command): void {
  const comment = program.command("comment").description("Manage task comments")
  comment
    .command("list")
    .argument("<task>")
    .action(async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("comment.list")
        const task = await resolveTask(context, query)
        const v1 = requireV1(context)
        return {
          data: await v1.listComments(task.projectId, task.id),
          meta: context.metadata("v1", { fetchedAt: new Date().toISOString() }),
        }
      })
    })
  addWriteOptions(comment.command("add").argument("<task>").argument("<text>")).action(
    async (query: string, text: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("comment.add")
        const task = await resolveTask(context, query)
        const request = { projectId: task.projectId, taskId: task.id, title: text }
        if (command.opts().dryRun)
          return { data: dryRunResult("comment.add", request), meta: context.metadata("local") }
        return {
          data: await requireV1(context).addComment(task.projectId, task.id, text),
          meta: context.metadata("v1"),
        }
      })
    },
  )
  addWriteOptions(comment.command("delete").argument("<task>").argument("<comment-id>")).action(
    async (query: string, commentId: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("comment.delete")
        const task = await resolveTask(context, query)
        const request = { projectId: task.projectId, taskId: task.id, commentId }
        if (command.opts().dryRun)
          return { data: dryRunResult("comment.delete", request), meta: context.metadata("local") }
        requireConfirmation(command.opts(), "delete the comment")
        await requireV1(context).deleteComment(task.projectId, task.id, commentId)
        return { data: { deleted: commentId }, meta: context.metadata("v1") }
      })
    },
  )
}

function registerGroups(program: Command): void {
  const group = program.command("group").description("Manage project groups")
  group.command("list").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("group.list")
      return { data: await requireV1(context).listGroups(), meta: context.metadata("v1") }
    })
  })
  addWriteOptions(group.command("add").argument("<name>")).action(
    async (name: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("group.add")
        if (command.opts().dryRun)
          return { data: dryRunResult("group.add", { name }), meta: context.metadata("local") }
        const result = await requireV1(context).createGroup(name)
        invalidateCore(context)
        return { data: result, meta: context.metadata("v1") }
      })
    },
  )
  addWriteOptions(group.command("rename").argument("<id-or-name>").argument("<name>")).action(
    async (query: string, name: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("group.edit")
        const v1 = requireV1(context)
        const current = resolveSimple(query, await v1.listGroups())
        if (command.opts().dryRun)
          return {
            data: dryRunResult("group.rename", { id: current.id, name }),
            meta: context.metadata("local"),
          }
        const result = await v1.updateGroup(current.id, name)
        invalidateCore(context)
        return { data: result, meta: context.metadata("v1") }
      })
    },
  )
  addWriteOptions(group.command("delete").argument("<id-or-name>")).action(
    async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("group.delete")
        const v1 = requireV1(context)
        const current = resolveSimple(query, await v1.listGroups())
        if (command.opts().dryRun)
          return {
            data: dryRunResult("group.delete", { id: current.id }),
            meta: context.metadata("local"),
          }
        requireConfirmation(command.opts(), "delete the project group")
        await v1.deleteGroup(current.id)
        invalidateCore(context)
        return { data: { deleted: current.id }, meta: context.metadata("v1") }
      })
    },
  )
}

function registerColumns(program: Command): void {
  const column = program.command("column").description("Manage project kanban columns")
  column
    .command("list")
    .argument("<project>")
    .action(async (projectQuery: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("column.list")
        const project = await resolveProject(context, projectQuery)
        return {
          data: await requireV1(context).listColumns(project.id),
          meta: context.metadata("v1"),
        }
      })
    })
  addWriteOptions(column.command("add").argument("<project>").argument("<name>")).action(
    async (projectQuery: string, name: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("column.add")
        const project = await resolveProject(context, projectQuery)
        if (command.opts().dryRun)
          return {
            data: dryRunResult("column.add", { projectId: project.id, name }),
            meta: context.metadata("local"),
          }
        const result = await requireV1(context).createColumn(project.id, name)
        invalidateCore(context)
        return { data: result, meta: context.metadata("v1") }
      })
    },
  )
  addWriteOptions(
    column
      .command("edit")
      .argument("<project>")
      .argument("<column>")
      .requiredOption("--name <name>"),
  ).action(async (projectQuery: string, columnQuery: string, _options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("column.edit")
      const project = await resolveProject(context, projectQuery)
      const v1 = requireV1(context)
      const current = resolveSimple(columnQuery, await v1.listColumns(project.id))
      if (command.opts().dryRun)
        return {
          data: dryRunResult("column.edit", {
            projectId: project.id,
            columnId: current.id,
            name: command.opts().name,
          }),
          meta: context.metadata("local"),
        }
      const result = await v1.updateColumn(project.id, current.id, command.opts().name)
      invalidateCore(context)
      return { data: result, meta: context.metadata("v1") }
    })
  })
  addWriteOptions(column.command("delete").argument("<project>").argument("<column>")).action(
    async (projectQuery: string, columnQuery: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("column.delete")
        const project = await resolveProject(context, projectQuery)
        const current = context.v1
          ? resolveSimple(columnQuery, await context.v1.listColumns(project.id))
          : { id: columnQuery, name: columnQuery }
        const request = { projectId: project.id, columnId: current.id }
        if (command.opts().dryRun)
          return { data: dryRunResult("column.delete", request), meta: context.metadata("local") }
        requireConfirmation(command.opts(), "delete the column")
        const v2 = requireV2(context)
        await v2.deleteColumn(project.id, current.id)
        invalidateCore(context)
        return { data: { deleted: current.id }, meta: context.metadata("v2") }
      })
    },
  )
}

function registerTags(program: Command): void {
  const tag = program.command("tag").description("Manage task tags")
  tag.command("list").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("tag.list")
      return { data: await requireV1(context).listTags(), meta: context.metadata("v1") }
    })
  })
  addWriteOptions(tag.command("add").argument("<name>").option("--label <label>")).action(
    async (name: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("tag.add")
        const request = { name, label: command.opts().label ?? name }
        if (command.opts().dryRun)
          return { data: dryRunResult("tag.add", request), meta: context.metadata("local") }
        const result = await requireV1(context).createTag(name, request.label)
        invalidateCore(context)
        return { data: result, meta: context.metadata("v1") }
      })
    },
  )
  addWriteOptions(tag.command("rename").argument("<name>").argument("<new-name>")).action(
    async (name: string, newName: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("tag.rename")
        if (command.opts().dryRun)
          return {
            data: dryRunResult("tag.rename", { name, newName }),
            meta: context.metadata("local"),
          }
        await requireV2(context).renameTag(name, newName)
        invalidateCore(context)
        return { data: { name, newName }, meta: context.metadata("v2") }
      })
    },
  )
  addWriteOptions(tag.command("merge").argument("<source>").argument("<target>")).action(
    async (source: string, target: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("tag.merge")
        if (command.opts().dryRun)
          return {
            data: dryRunResult("tag.merge", { name: source, newName: target }),
            meta: context.metadata("local"),
          }
        requireConfirmation(command.opts(), "merge and remove the source tag")
        await requireV2(context).mergeTags(source, target)
        invalidateCore(context)
        return { data: { merged: source, into: target }, meta: context.metadata("v2") }
      })
    },
  )
  addWriteOptions(tag.command("delete").argument("<name>")).action(
    async (name: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("tag.delete")
        if (command.opts().dryRun)
          return { data: dryRunResult("tag.delete", { name }), meta: context.metadata("local") }
        requireConfirmation(command.opts(), "delete the tag")
        await requireV2(context).deleteTag(name)
        invalidateCore(context)
        return { data: { deleted: name }, meta: context.metadata("v2") }
      })
    },
  )
}

function registerFilters(program: Command): void {
  const filter = program.command("filter").description("Manage verified v2 saved filters")
  filter.command("list").action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("filter.list")
      const filters = (await requireV2(context).batchCheck("0")).filters ?? []
      return { data: filters.map(filterOutput), meta: context.metadata("v2") }
    })
  })
  filter
    .command("show")
    .argument("<id-or-name>")
    .action(async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("filter.list")
        const filters = (await requireV2(context).batchCheck("0")).filters ?? []
        return { data: filterOutput(resolveSimple(query, filters)), meta: context.metadata("v2") }
      })
    })
  addWriteOptions(
    filter
      .command("add")
      .requiredOption("--name <name>")
      .requiredOption("--rule <json>")
      .option("--sort-order <number>", "sort order", Number, 0),
  ).action(async (_options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("filter.add")
      const rule = parseJsonObject(command.opts().rule, "filter rule")
      const request = { name: command.opts().name, rule, sortOrder: command.opts().sortOrder }
      if (command.opts().dryRun)
        return {
          data: {
            ...dryRunResult("filter.add", request),
            ruleCoverage: "remote_rule_retained_not_locally_interpreted",
          },
          meta: context.metadata("local"),
        }
      const result = await requireV2(context).createFilter(request.name, rule, request.sortOrder)
      invalidateCore(context)
      return {
        data: { result, ruleCoverage: "remote_rule_retained_not_locally_interpreted" },
        meta: context.metadata("v2"),
      }
    })
  })
  addWriteOptions(
    filter
      .command("edit")
      .argument("<id-or-name>")
      .option("--name <name>")
      .option("--rule <json>")
      .option("--sort-order <number>", "sort order", Number),
  ).action(async (query: string, _options, command: Command) => {
    await executeCommand(command, async (context) => {
      context.capability("filter.edit")
      const v2 = requireV2(context)
      const current = resolveSimple(query, (await v2.batchCheck("0")).filters ?? [])
      const options = command.opts()
      const update = {
        id: current.id,
        name: options.name ?? current.name,
        rule: options.rule
          ? JSON.stringify(parseJsonObject(options.rule, "filter rule"))
          : String(current.rule),
        sortOrder: options.sortOrder ?? current.sortOrder ?? 0,
      }
      if (!options.name && !options.rule && options.sortOrder === undefined) {
        throw new AppError("invalid_input", "At least one filter edit is required")
      }
      if (options.dryRun)
        return { data: dryRunResult("filter.edit", update), meta: context.metadata("local") }
      const result = await v2.batchFilters({ update: [update] })
      invalidateCore(context)
      return { data: result, meta: context.metadata("v2") }
    })
  })
  addWriteOptions(filter.command("delete").argument("<id-or-name>")).action(
    async (query: string, _options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("filter.delete")
        const v2 = requireV2(context)
        const current = resolveSimple(query, (await v2.batchCheck("0")).filters ?? [])
        if (command.opts().dryRun)
          return {
            data: dryRunResult("filter.delete", { id: current.id }),
            meta: context.metadata("local"),
          }
        requireConfirmation(command.opts(), "delete the saved filter")
        const result = await v2.batchFilters({ delete: [current.id] })
        invalidateCore(context)
        return { data: { deleted: current.id, result }, meta: context.metadata("v2") }
      })
    },
  )
}

function registerCountdown(program: Command): void {
  program
    .command("countdown")
    .command("list")
    .action(async (_options, command: Command) => {
      await executeCommand(command, async (context) => {
        context.capability("countdown.list")
        return { data: await requireV1(context).listCountdowns(), meta: context.metadata("v1") }
      })
    })
}

function resolveSimple<T extends { id: string; name: string }>(
  query: string,
  values: readonly T[],
): T {
  try {
    return requireResolved(query, values).value
  } catch (error) {
    if (error instanceof ResolutionError) {
      throw new AppError(error.code === "ambiguous" ? "ambiguous" : "not_found", error.message, {
        details: { candidates: error.candidates.map(({ id, name }) => ({ id, name })) },
      })
    }
    throw error
  }
}

function requireV1(context: AppContext): NonNullable<AppContext["v1"]> {
  if (context.options.offline) throw new AppError("invalid_input", "Network access is disabled")
  if (!context.v1) throw new AppError("authentication_missing", "A v1 token is required")
  return context.v1
}

function requireV2(context: AppContext): NonNullable<AppContext["v2"]> {
  if (context.options.offline) throw new AppError("invalid_input", "Network access is disabled")
  if (!context.v2) throw new AppError("authentication_missing", "A v2 session is required")
  return context.v2
}

function invalidateCore(context: AppContext): void {
  context.repositories.invalidate("core")
}

function filterOutput(filter: Record<string, unknown>): Record<string, unknown> {
  return {
    ...filter,
    ruleCoverage: "remote_rule_retained_not_locally_interpreted",
  }
}
