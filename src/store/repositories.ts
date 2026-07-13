import type { Database } from "bun:sqlite"
import type { StoreDatabase } from "./db"

export type WireRecord = Record<string, unknown>

export interface FreshnessRecord {
  resource: string
  fetchedAt: string
  source: string
  checkpoint?: string
  accountFingerprint?: string
}

export interface CachedTask extends WireRecord {
  id: string
  projectId: string
  title: string
  content?: string
  description?: string
  startDate?: string
  dueDate?: string
  timeZone?: string
  isAllDay: boolean
  priority: number
  status: number
  tags: string[]
  parentId?: string
  columnId?: string
  pinnedTime?: string
  completedTime?: string
  deleted: boolean
  etag?: string
  source: string
  fetchedAt: string
  raw: WireRecord
}

export interface CachedProject extends WireRecord {
  id: string
  name: string
  color?: string
  kind?: string
  groupId?: string
  closed: boolean
  etag?: string
  source: string
  fetchedAt: string
  raw: WireRecord
}

export interface TaskQuery {
  projectId?: string
  statuses?: number[]
  includeDeleted?: boolean
  from?: string
  to?: string
  limit?: number
}

export class Repositories {
  private readonly db: Database

  constructor(store: StoreDatabase) {
    this.db = store.db
  }

  setMetadata(key: string, value: string): void {
    this.db
      .query(
        `INSERT INTO metadata(key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString())
  }

  getMetadata(key: string): string | undefined {
    return this.db
      .query<{ value: string }, [string]>("SELECT value FROM metadata WHERE key = ?")
      .get(key)?.value
  }

  setFreshness(record: FreshnessRecord): void {
    this.db
      .query(
        `INSERT INTO freshness(resource, fetched_at, source, checkpoint, account_fingerprint)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(resource) DO UPDATE SET
           fetched_at=excluded.fetched_at,
           source=excluded.source,
           checkpoint=excluded.checkpoint,
           account_fingerprint=excluded.account_fingerprint`,
      )
      .run(
        record.resource,
        record.fetchedAt,
        record.source,
        record.checkpoint ?? null,
        record.accountFingerprint ?? null,
      )
  }

  getFreshness(resource: string): FreshnessRecord | undefined {
    const row = this.db
      .query<
        {
          resource: string
          fetched_at: string
          source: string
          checkpoint: string | null
          account_fingerprint: string | null
        },
        [string]
      >("SELECT * FROM freshness WHERE resource = ?")
      .get(resource)
    if (!row) return undefined
    return {
      resource: row.resource,
      fetchedAt: row.fetched_at,
      source: row.source,
      ...(row.checkpoint ? { checkpoint: row.checkpoint } : {}),
      ...(row.account_fingerprint ? { accountFingerprint: row.account_fingerprint } : {}),
    }
  }

  upsertProjects(records: readonly WireRecord[], source: string, fetchedAt = now()): void {
    const statement = this.db.query(`
      INSERT INTO projects(id,name,color,kind,group_id,closed,sort_order,etag,source,fetched_at,raw_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,color=excluded.color,kind=excluded.kind,group_id=excluded.group_id,
        closed=excluded.closed,sort_order=excluded.sort_order,etag=excluded.etag,
        source=excluded.source,fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
    `)
    for (const record of records) {
      const id = requiredString(record, "id")
      const name = stringValue(record.name ?? record.title) ?? id
      statement.run(
        id,
        name,
        nullableString(record.color),
        nullableString(record.kind),
        nullableString(record.groupId),
        truthyInt(record.closed),
        nullableNumber(record.sortOrder),
        nullableString(record.etag),
        source,
        fetchedAt,
        JSON.stringify(record),
      )
    }
  }

  upsertTasks(records: readonly WireRecord[], source: string, fetchedAt = now()): void {
    const statement = this.db.query(`
      INSERT INTO tasks(
        id,project_id,title,content,description,start_date,due_date,time_zone,is_all_day,
        priority,status,tags_json,parent_id,column_id,pinned_time,completed_time,deleted,
        sort_order,etag,source,fetched_at,raw_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id,title=excluded.title,content=excluded.content,
        description=excluded.description,start_date=excluded.start_date,due_date=excluded.due_date,
        time_zone=excluded.time_zone,is_all_day=excluded.is_all_day,priority=excluded.priority,
        status=excluded.status,tags_json=excluded.tags_json,parent_id=excluded.parent_id,
        column_id=excluded.column_id,pinned_time=excluded.pinned_time,
        completed_time=excluded.completed_time,deleted=excluded.deleted,
        sort_order=excluded.sort_order,etag=excluded.etag,source=excluded.source,
        fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
    `)
    for (const record of records) {
      const id = requiredString(record, "id")
      const projectId = requiredString(record, "projectId")
      statement.run(
        id,
        projectId,
        stringValue(record.title) ?? "",
        nullableString(record.content),
        nullableString(record.description ?? record.desc),
        nullableString(record.startDate),
        nullableString(record.dueDate),
        nullableString(record.timeZone ?? record.timezone),
        truthyInt(record.isAllDay ?? record.allDay),
        numberValue(record.priority) ?? 0,
        numberValue(record.status) ?? 0,
        JSON.stringify(stringArray(record.tags)),
        nullableString(record.parentId),
        nullableString(record.columnId),
        nullableString(record.pinnedTime),
        nullableString(record.completedTime),
        truthyInt(record.deleted),
        nullableNumber(record.sortOrder),
        nullableString(record.etag),
        source,
        fetchedAt,
        JSON.stringify(record),
      )
    }
  }

  upsertGroups(records: readonly WireRecord[], source: string, fetchedAt = now()): void {
    const statement = this.db.query(`
      INSERT INTO project_groups(id,name,sort_order,etag,source,fetched_at,raw_json)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,
        etag=excluded.etag,source=excluded.source,fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
    `)
    for (const record of records) {
      const id = requiredString(record, "id")
      statement.run(
        id,
        stringValue(record.name) ?? id,
        nullableNumber(record.sortOrder),
        nullableString(record.etag),
        source,
        fetchedAt,
        JSON.stringify(record),
      )
    }
  }

  upsertColumns(records: readonly WireRecord[], source: string, fetchedAt = now()): void {
    const statement = this.db.query(`
      INSERT INTO columns(id,project_id,name,sort_order,etag,source,fetched_at,raw_json)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,name=excluded.name,
        sort_order=excluded.sort_order,etag=excluded.etag,source=excluded.source,
        fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
    `)
    for (const record of records) {
      const id = requiredString(record, "id")
      statement.run(
        id,
        requiredString(record, "projectId"),
        stringValue(record.name) ?? id,
        nullableNumber(record.sortOrder),
        nullableString(record.etag),
        source,
        fetchedAt,
        JSON.stringify(record),
      )
    }
  }

  upsertTags(records: readonly WireRecord[], source: string, fetchedAt = now()): void {
    const statement = this.db.query(`
      INSERT INTO tags(name,label,color,sort_order,etag,source,fetched_at,raw_json)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET label=excluded.label,color=excluded.color,
        sort_order=excluded.sort_order,etag=excluded.etag,source=excluded.source,
        fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
    `)
    for (const record of records) {
      const name = requiredString(record, "name")
      statement.run(
        name,
        nullableString(record.label),
        nullableString(record.color),
        nullableNumber(record.sortOrder),
        nullableString(record.etag),
        source,
        fetchedAt,
        JSON.stringify(record),
      )
    }
  }

  upsertFilters(records: readonly WireRecord[], source: string, fetchedAt = now()): void {
    const statement = this.db.query(`
      INSERT INTO filters(id,name,rule,sort_order,etag,source,fetched_at,raw_json)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,rule=excluded.rule,
        sort_order=excluded.sort_order,etag=excluded.etag,source=excluded.source,
        fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
    `)
    for (const record of records) {
      const id = requiredString(record, "id")
      const rule = typeof record.rule === "string" ? record.rule : JSON.stringify(record.rule ?? {})
      statement.run(
        id,
        stringValue(record.name) ?? id,
        rule,
        nullableNumber(record.sortOrder),
        nullableString(record.etag),
        source,
        fetchedAt,
        JSON.stringify(record),
      )
    }
  }

  upsertHabits(records: readonly WireRecord[], source: string, fetchedAt = now()): void {
    const statement = this.db.query(`
      INSERT INTO habits(id,name,status,goal,unit,repeat_rule,section_id,sort_order,etag,source,fetched_at,raw_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,goal=excluded.goal,
        unit=excluded.unit,repeat_rule=excluded.repeat_rule,section_id=excluded.section_id,
        sort_order=excluded.sort_order,etag=excluded.etag,source=excluded.source,
        fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
    `)
    for (const record of records) {
      const id = requiredString(record, "id")
      statement.run(
        id,
        stringValue(record.name) ?? stringValue(record.title) ?? id,
        nullableNumber(record.status),
        nullableNumber(record.goal),
        nullableString(record.unit),
        nullableString(record.repeatRule ?? record.repeat),
        nullableString(record.sectionId),
        nullableNumber(record.sortOrder),
        nullableString(record.etag),
        source,
        fetchedAt,
        JSON.stringify(record),
      )
    }
  }

  upsertRawResource(
    table: "checkins" | "focus_records" | "events",
    records: readonly WireRecord[],
    source: string,
    fetchedAt = now(),
  ): void {
    if (table === "checkins") {
      const statement = this.db.query(`
        INSERT INTO checkins(id,habit_id,checkin_date,value,status,etag,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET habit_id=excluded.habit_id,checkin_date=excluded.checkin_date,
          value=excluded.value,status=excluded.status,etag=excluded.etag,source=excluded.source,
          fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
      `)
      for (const record of records) {
        statement.run(
          requiredString(record, "id"),
          requiredString(record, "habitId"),
          requiredString(record, "checkinDate"),
          nullableNumber(record.value),
          nullableNumber(record.status),
          nullableString(record.etag),
          source,
          fetchedAt,
          JSON.stringify(record),
        )
      }
      return
    }
    if (table === "focus_records") {
      const statement = this.db.query(`
        INSERT INTO focus_records(id,task_id,habit_id,focus_type,start_time,end_time,duration,note,etag,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id,habit_id=excluded.habit_id,
          focus_type=excluded.focus_type,start_time=excluded.start_time,end_time=excluded.end_time,
          duration=excluded.duration,note=excluded.note,etag=excluded.etag,source=excluded.source,
          fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
      `)
      for (const record of records) {
        statement.run(
          requiredString(record, "id"),
          nullableString(record.taskId),
          nullableString(record.habitId),
          nullableNumber(record.type ?? record.focusType),
          requiredString(record, "startTime"),
          nullableString(record.endTime),
          nullableNumber(record.duration),
          nullableString(record.note),
          nullableString(record.etag),
          source,
          fetchedAt,
          JSON.stringify(record),
        )
      }
      return
    }
    const statement = this.db.query(`
      INSERT INTO events(id,account_id,calendar_id,title,start_date,end_date,time_zone,is_all_day,etag,source,fetched_at,raw_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,calendar_id=excluded.calendar_id,
        title=excluded.title,start_date=excluded.start_date,end_date=excluded.end_date,
        time_zone=excluded.time_zone,is_all_day=excluded.is_all_day,etag=excluded.etag,
        source=excluded.source,fetched_at=excluded.fetched_at,raw_json=excluded.raw_json
    `)
    for (const record of records) {
      statement.run(
        requiredString(record, "id"),
        nullableString(record.accountId),
        nullableString(record.calendarId),
        stringValue(record.title) ?? "",
        nullableString(record.startDate ?? record.start),
        nullableString(record.endDate ?? record.end),
        nullableString(record.timeZone),
        truthyInt(record.isAllDay ?? record.allDay),
        nullableString(record.etag),
        source,
        fetchedAt,
        JSON.stringify(record),
      )
    }
  }

  deleteProjects(ids: readonly string[]): void {
    const statement = this.db.query("DELETE FROM projects WHERE id = ?")
    for (const id of ids) statement.run(id)
  }

  deleteTasks(ids: readonly string[]): void {
    const statement = this.db.query("DELETE FROM tasks WHERE id = ?")
    for (const id of ids) statement.run(id)
  }

  reconcileIds(table: "projects" | "tasks", authoritativeIds: ReadonlySet<string>): void {
    const rows = this.db.query<{ id: string }, []>(`SELECT id FROM ${table}`).all()
    const remove = this.db.query(`DELETE FROM ${table} WHERE id = ?`)
    for (const { id } of rows) if (!authoritativeIds.has(id)) remove.run(id)
  }

  reconcileResource(
    table: "project_groups" | "columns" | "filters" | "habits",
    authoritativeIds: ReadonlySet<string>,
  ): void {
    const rows = this.db.query<{ id: string }, []>(`SELECT id FROM ${table}`).all()
    const remove = this.db.query(`DELETE FROM ${table} WHERE id = ?`)
    for (const { id } of rows) if (!authoritativeIds.has(id)) remove.run(id)
  }

  reconcileTags(authoritativeNames: ReadonlySet<string>): void {
    const rows = this.db.query<{ name: string }, []>("SELECT name FROM tags").all()
    const remove = this.db.query("DELETE FROM tags WHERE name = ?")
    const normalized = new Set([...authoritativeNames].map((name) => name.toLocaleLowerCase()))
    for (const { name } of rows) if (!normalized.has(name.toLocaleLowerCase())) remove.run(name)
  }

  getProject(id: string): CachedProject | undefined {
    const row = this.db.query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?").get(id)
    return row ? projectFromRow(row) : undefined
  }

  listProjects(): CachedProject[] {
    return this.db
      .query<ProjectRow, []>(
        "SELECT * FROM projects ORDER BY COALESCE(sort_order, 0), name COLLATE NOCASE",
      )
      .all()
      .map(projectFromRow)
  }

  listRawResource(
    table:
      | "project_groups"
      | "columns"
      | "tags"
      | "filters"
      | "habits"
      | "checkins"
      | "focus_records"
      | "events",
    where?: { column: "project_id" | "habit_id"; value: string },
  ): WireRecord[] {
    const sql = where
      ? `SELECT raw_json FROM ${table} WHERE ${where.column} = ? ORDER BY rowid`
      : `SELECT raw_json FROM ${table} ORDER BY rowid`
    const rows = where
      ? this.db.query<{ raw_json: string }, [string]>(sql).all(where.value)
      : this.db.query<{ raw_json: string }, []>(sql).all()
    return rows.map((row) => parseRaw(row.raw_json))
  }

  getTask(id: string): CachedTask | undefined {
    const row = this.db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE id = ?").get(id)
    return row ? taskFromRow(row) : undefined
  }

  listTasks(query: TaskQuery = {}): CachedTask[] {
    const clauses: string[] = []
    const values: Array<string | number> = []
    if (query.projectId) {
      clauses.push("project_id = ?")
      values.push(query.projectId)
    }
    if (!query.includeDeleted) clauses.push("deleted = 0")
    if (query.statuses?.length) {
      clauses.push(`status IN (${query.statuses.map(() => "?").join(",")})`)
      values.push(...query.statuses)
    }
    if (query.from) {
      clauses.push("COALESCE(due_date, start_date) >= ?")
      values.push(query.from)
    }
    if (query.to) {
      clauses.push("COALESCE(due_date, start_date) < ?")
      values.push(query.to)
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""
    const limit = Math.max(1, Math.min(query.limit ?? 10_000, 100_000))
    return this.db
      .query<TaskRow, Array<string | number>>(
        `SELECT * FROM tasks${where} ORDER BY COALESCE(due_date,start_date,'9999'), priority DESC, title COLLATE NOCASE LIMIT ${limit}`,
      )
      .all(...values)
      .map(taskFromRow)
  }

  searchTasks(text: string, limit = 50): CachedTask[] {
    const pattern = `%${escapeLike(text.toLocaleLowerCase())}%`
    return this.db
      .query<TaskRow, [string, string, number]>(
        `SELECT * FROM tasks
         WHERE deleted = 0 AND (lower(title) LIKE ? ESCAPE '\\' OR lower(COALESCE(content,'')) LIKE ? ESCAPE '\\')
         ORDER BY status, COALESCE(due_date,start_date,'9999'), title COLLATE NOCASE LIMIT ?`,
      )
      .all(pattern, pattern, limit)
      .map(taskFromRow)
  }

  invalidate(resource: string): void {
    this.db.query("DELETE FROM freshness WHERE resource = ?").run(resource)
  }

  invalidateAllFreshness(): void {
    this.db.run("DELETE FROM freshness")
  }

  clearAll(): void {
    for (const table of [
      "events",
      "focus_records",
      "checkins",
      "habits",
      "filters",
      "tags",
      "columns",
      "project_groups",
      "tasks",
      "projects",
      "freshness",
      "metadata",
    ]) {
      this.db.exec(`DELETE FROM ${table}`)
    }
  }

  status(): { integrity: boolean; counts: Record<string, number>; freshness: FreshnessRecord[] } {
    const counts: Record<string, number> = {}
    for (const table of [
      "projects",
      "tasks",
      "project_groups",
      "columns",
      "tags",
      "filters",
      "habits",
      "checkins",
      "focus_records",
      "events",
    ]) {
      counts[table] =
        this.db.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()
          ?.count ?? 0
    }
    const freshness = this.db
      .query<
        {
          resource: string
          fetched_at: string
          source: string
          checkpoint: string | null
          account_fingerprint: string | null
        },
        []
      >("SELECT * FROM freshness ORDER BY resource")
      .all()
      .map((row) => ({
        resource: row.resource,
        fetchedAt: row.fetched_at,
        source: row.source,
        ...(row.checkpoint ? { checkpoint: row.checkpoint } : {}),
        ...(row.account_fingerprint ? { accountFingerprint: row.account_fingerprint } : {}),
      }))
    const integrity =
      this.db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get()
        ?.integrity_check === "ok"
    return { integrity, counts, freshness }
  }
}

interface ProjectRow {
  id: string
  name: string
  color: string | null
  kind: string | null
  group_id: string | null
  closed: number
  etag: string | null
  source: string
  fetched_at: string
  raw_json: string
}

interface TaskRow {
  id: string
  project_id: string
  title: string
  content: string | null
  description: string | null
  start_date: string | null
  due_date: string | null
  time_zone: string | null
  is_all_day: number
  priority: number
  status: number
  tags_json: string
  parent_id: string | null
  column_id: string | null
  pinned_time: string | null
  completed_time: string | null
  deleted: number
  etag: string | null
  source: string
  fetched_at: string
  raw_json: string
}

function projectFromRow(row: ProjectRow): CachedProject {
  return {
    id: row.id,
    name: row.name,
    closed: row.closed !== 0,
    source: row.source,
    fetchedAt: row.fetched_at,
    raw: parseRaw(row.raw_json),
    ...(row.color ? { color: row.color } : {}),
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.group_id ? { groupId: row.group_id } : {}),
    ...(row.etag ? { etag: row.etag } : {}),
  }
}

function taskFromRow(row: TaskRow): CachedTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    isAllDay: row.is_all_day !== 0,
    priority: row.priority,
    status: row.status,
    tags: parseStringArray(row.tags_json),
    deleted: row.deleted !== 0,
    source: row.source,
    fetchedAt: row.fetched_at,
    raw: parseRaw(row.raw_json),
    ...(row.content ? { content: row.content } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.start_date ? { startDate: row.start_date } : {}),
    ...(row.due_date ? { dueDate: row.due_date } : {}),
    ...(row.time_zone ? { timeZone: row.time_zone } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    ...(row.column_id ? { columnId: row.column_id } : {}),
    ...(row.pinned_time ? { pinnedTime: row.pinned_time } : {}),
    ...(row.completed_time ? { completedTime: row.completed_time } : {}),
    ...(row.etag ? { etag: row.etag } : {}),
  }
}

function parseRaw(value: string): WireRecord {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as WireRecord)
      : {}
  } catch {
    return {}
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return stringArray(parsed)
  } catch {
    return []
  }
}

function requiredString(record: WireRecord, key: string): string {
  const value = stringValue(record[key])
  if (!value) throw new TypeError(`Missing required ${key}`)
  return value
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function nullableString(value: unknown): string | null {
  return stringValue(value) ?? null
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nullableNumber(value: unknown): number | null {
  return numberValue(value) ?? null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function truthyInt(value: unknown): number {
  return value === true || value === 1 ? 1 : 0
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&")
}

function now(): string {
  return new Date().toISOString()
}
