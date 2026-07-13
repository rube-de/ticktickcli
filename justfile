set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default: check

install:
    bun install --frozen-lockfile

typecheck:
    bun run typecheck

lint:
    bun run lint

format:
    bun run format

docs:
    bun run docs:generate

docs-check:
    bun run docs:check

test:
    bun test

package-smoke:
    bun run test:package

check: typecheck lint docs-check test package-smoke

link:
    bun link
