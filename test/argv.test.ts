import { expect, test } from "bun:test"
import { hoistGlobalOptions } from "../src/app/argv"

test("hoists global options from any command position", () => {
  expect(hoistGlobalOptions(["bun", "tt", "task", "list", "--profile", "work", "--json"])).toEqual([
    "bun",
    "tt",
    "--profile",
    "work",
    "--json",
    "task",
    "list",
  ])
})

test("does not interpret values after the literal separator", () => {
  expect(hoistGlobalOptions(["bun", "tt", "add", "--", "--json"])).toEqual([
    "bun",
    "tt",
    "add",
    "--",
    "--json",
  ])
})

test("preserves profile-add host and timezone options as local options", () => {
  expect(
    hoistGlobalOptions([
      "bun",
      "tt",
      "profile",
      "add",
      "work",
      "--host",
      "dida365.com",
      "--timezone=Europe/London",
      "--json",
    ]),
  ).toEqual([
    "bun",
    "tt",
    "--json",
    "profile",
    "add",
    "work",
    "--profile-add-host",
    "dida365.com",
    "--profile-add-timezone=Europe/London",
  ])
})
