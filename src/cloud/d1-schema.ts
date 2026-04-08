/**
 * D1 중앙 DB 스키마 — 로컬 테이블 미러 + machine_id, synced_at
 */

import type { D1Client } from "./d1-client.js";

const SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT NOT NULL,
  project TEXT NOT NULL,
  project_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_minutes REAL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  user_message_count INTEGER DEFAULT 0,
  assistant_message_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  title TEXT,
  summary TEXT,
  description TEXT,
  category TEXT,
  tags TEXT,
  model TEXT,
  created_at INTEGER NOT NULL,
  machine_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  UNIQUE(machine_id, id, project)
);
`;

const GATHER_REPORTS_TABLE = `
CREATE TABLE IF NOT EXISTS gather_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gathered_at INTEGER NOT NULL,
  from_timestamp INTEGER NOT NULL,
  to_timestamp INTEGER NOT NULL,
  session_count INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  report_markdown TEXT,
  report_json TEXT,
  emailed_at INTEGER,
  email_to TEXT,
  report_date TEXT,
  data_hash TEXT,
  updated_at INTEGER,
  machine_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL
);
`;

const GATHER_REPORTS_UNIQUE_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_gather_reports_machine_date
  ON gather_reports(machine_id, report_date)
  WHERE report_date IS NOT NULL;
`;

const DAILY_REPORTS_TABLE = `
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'daily',
  period_from INTEGER NOT NULL,
  period_to INTEGER NOT NULL,
  session_count INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  summary_json TEXT NOT NULL,
  overview TEXT,
  report_markdown TEXT,
  created_at INTEGER NOT NULL,
  emailed_at INTEGER,
  email_to TEXT,
  status TEXT DEFAULT 'in_progress',
  progress_label TEXT,
  data_hash TEXT,
  machine_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  UNIQUE(machine_id, report_date, report_type)
);
`;

const EMAIL_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at INTEGER NOT NULL,
  report_type TEXT NOT NULL,
  report_date TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT,
  body_text TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  error_message TEXT,
  machine_id TEXT NOT NULL,
  synced_at INTEGER NOT NULL
);
`;

const VACATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS vacations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'vacation',
  source TEXT NOT NULL DEFAULT 'manual',
  label TEXT,
  created_at INTEGER NOT NULL,
  synced_by TEXT
);
`;

const MACHINES_TABLE = `
CREATE TABLE IF NOT EXISTS machines (
  machine_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  hostname TEXT,
  label TEXT,
  first_seen_at INTEGER NOT NULL,
  last_sync_at INTEGER
);
`;

const SHARED_CONFIG_TABLE = `
CREATE TABLE IF NOT EXISTS shared_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
`;

const SYNC_META_TABLE = `
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);",
  "CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);",
  "CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine_id);",
  "CREATE INDEX IF NOT EXISTS idx_gather_reports_gathered ON gather_reports(gathered_at);",
  "CREATE INDEX IF NOT EXISTS idx_gather_reports_machine ON gather_reports(machine_id);",
  "CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_reports(report_date);",
  "CREATE INDEX IF NOT EXISTS idx_daily_type ON daily_reports(report_type);",
  "CREATE INDEX IF NOT EXISTS idx_daily_machine ON daily_reports(machine_id);",
  "CREATE INDEX IF NOT EXISTS idx_email_logs_sent ON email_logs(sent_at);",
  "CREATE INDEX IF NOT EXISTS idx_email_logs_machine ON email_logs(machine_id);",
  "CREATE INDEX IF NOT EXISTS idx_vacations_date ON vacations(date);",
];

/**
 * D1 중앙 DB에 스키마를 생성하거나 이미 존재하면 건너뜀.
 * 모든 테이블은 CREATE TABLE IF NOT EXISTS를 사용.
 */
export async function ensureD1Schema(client: D1Client): Promise<void> {
  // 테이블 생성
  const tables = [
    SESSIONS_TABLE,
    GATHER_REPORTS_TABLE,
    DAILY_REPORTS_TABLE,
    EMAIL_LOGS_TABLE,
    VACATIONS_TABLE,
    MACHINES_TABLE,
    SHARED_CONFIG_TABLE,
    SYNC_META_TABLE,
  ];

  for (const ddl of tables) {
    await client.query(ddl);
  }

  // 유니크 인덱스 (partial index)
  await client.query(GATHER_REPORTS_UNIQUE_INDEX);

  // 일반 인덱스
  for (const idx of INDEXES) {
    await client.query(idx);
  }

  // 스키마 버전 설정
  await client.query(
    `INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('schema_version', '1')`,
  );
}
