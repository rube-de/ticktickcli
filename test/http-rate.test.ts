import { expect, test } from "bun:test"
import { ApiHttpClient } from "../src/api/http"

test("read limiter spaces concurrent requests while leaving writes unqueued", async () => {
  let now = 0
  const sleeps: number[] = []
  const client = new ApiHttpClient({
    baseUrl: "https://api.example.test/v1",
    readsPerSecond: 2,
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      now += milliseconds
    },
    fetch: async () => Response.json({ ok: true }),
  })
  await Promise.all([client.request("/one"), client.request("/two")])
  expect(sleeps).toEqual([500])
  await client.request("/write", { method: "POST", json: {}, retry: "never" })
  expect(sleeps).toEqual([500])
})
