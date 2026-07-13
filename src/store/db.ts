import { Database } from "bun:sqlite"
import { chmodSync, mkdirSync, renameSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { migrations } from "./migrations"

export class StoreDatabase {
  readonly db: Database

  private constructor(
    readonly path: string,
    db: Database,
  ) {
    this.db = db
    this.configure()
    this.migrate()
  }

  static open(path: string): StoreDatabase {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    try {
      const store = new StoreDatabase(path, new Database(path, { create: true }))
      try {
        chmodSync(path, 0o600)
      } catch {
        // Permission bits are advisory on platforms without POSIX modes.
      }
      return store
    } catch (error) {
      if (!isCorruptDatabaseError(error)) throw error
      const quarantine = `${path}.corrupt-${Date.now()}`
      try {
        renameSync(path, quarantine)
      } catch {
        rmSync(path, { force: true })
      }
      return new StoreDatabase(path, new Database(path, { create: true }))
    }
  }

  private configure(): void {
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this.db.exec("PRAGMA busy_timeout = 5000")
    this.db.exec("PRAGMA synchronous = NORMAL")
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)
    const applied = new Set(
      this.db
        .query<{ version: number }, []>("SELECT version FROM schema_migrations")
        .all()
        .map((row) => row.version),
    )
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      this.transaction(() => {
        this.db.exec(migration.sql)
        this.db
          .query("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, new Date().toISOString())
      })
    }
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  integrityCheck(): boolean {
    const row = this.db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()
    return row?.integrity_check === "ok"
  }

  close(): void {
    this.db.close()
  }
}

function isCorruptDatabaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /malformed|not a database|SQLITE_CORRUPT/i.test(message)
}
