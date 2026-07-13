import { describe, expect, test } from "bun:test"
import { V1Client } from "../../src/api/v1/client"

const enabled = process.env.TICKTICK_LIVE === "1"

describe.skipIf(!enabled)("disposable-account live workflow", () => {
  test("creates, reads, completes, and deletes a uniquely named task", async () => {
    const token = requiredEnvironment("TT_ACCESS_TOKEN")
    const projectId = requiredEnvironment("TICKTICK_LIVE_PROJECT_ID")
    const host = process.env.TT_HOST === "dida365.com" ? "dida365.com" : "ticktick.com"
    const client = new V1Client({ accessToken: token, host })
    const title = `tt-live-${Date.now()}-${crypto.randomUUID()}`
    let taskId: string | undefined
    try {
      const created = await client.createTask({ title, projectId })
      if (created) taskId = created.id
      else {
        const data = await client.getProjectData(projectId)
        const candidates = data.tasks.filter((task) => task.title === title)
        expect(candidates).toHaveLength(1)
        taskId = candidates[0]?.id
      }
      if (!taskId) throw new Error("Live create could not be reconciled")
      expect((await client.getTask(projectId, taskId)).title).toBe(title)
      await client.completeTask(projectId, taskId)
      await client.deleteTask(projectId, taskId)
      taskId = undefined
    } finally {
      if (taskId) await client.deleteTask(projectId, taskId).catch(() => undefined)
    }
  })
})

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required when TICKTICK_LIVE=1`)
  return value
}
