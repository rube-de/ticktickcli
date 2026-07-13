export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial-cache",
    sql: `
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS freshness (
        resource TEXT PRIMARY KEY,
        fetched_at TEXT NOT NULL,
        source TEXT NOT NULL,
        checkpoint TEXT,
        account_fingerprint TEXT
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        kind TEXT,
        group_id TEXT,
        closed INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        description TEXT,
        start_date TEXT,
        due_date TEXT,
        time_zone TEXT,
        is_all_day INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        status INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]',
        parent_id TEXT,
        column_id TEXT,
        pinned_time TEXT,
        completed_time TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status, deleted);
      CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks(parent_id);

      CREATE TABLE IF NOT EXISTS project_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS columns (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS columns_project_idx ON columns(project_id);

      CREATE TABLE IF NOT EXISTS tags (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        label TEXT,
        color TEXT,
        sort_order INTEGER,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS filters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rule TEXT NOT NULL,
        sort_order INTEGER,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status INTEGER,
        goal REAL,
        unit TEXT,
        repeat_rule TEXT,
        section_id TEXT,
        sort_order INTEGER,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkins (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL,
        checkin_date TEXT NOT NULL,
        value REAL,
        status INTEGER,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS checkins_habit_date_idx ON checkins(habit_id, checkin_date);

      CREATE TABLE IF NOT EXISTS focus_records (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        habit_id TEXT,
        focus_type INTEGER,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration INTEGER,
        note TEXT,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS focus_start_idx ON focus_records(start_time);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        calendar_id TEXT,
        title TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        time_zone TEXT,
        is_all_day INTEGER NOT NULL DEFAULT 0,
        etag TEXT,
        source TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_start_idx ON events(start_date);
    `,
  },
]
