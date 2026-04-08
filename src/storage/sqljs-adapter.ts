import initSqlJs, { type Database } from "sql.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { encrypt, decrypt } from "../encryption/crypto.js";
import { deriveMachineKey } from "../encryption/key.js";
import type {
  SessionRecord,
  GatherReport,
  DailyReport,
  VacationRecord,
  EmailLog,
  StorageAdapter,
} from "./adapter.js";

const SCHEMA_V2 = `
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
  PRIMARY KEY (id, project)
);

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
  email_to TEXT
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_category ON sessions(category);
CREATE INDEX IF NOT EXISTS idx_reports_gathered ON gather_reports(gathered_at);
`;

const SCHEMA_V3 = `
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
  UNIQUE(report_date, report_type)
);
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_daily_type ON daily_reports(report_type);
`;

// v0.1 → v0.2 마이그레이션: 새 컬럼 추가
const MIGRATION_V1_TO_V2 = [
  "ALTER TABLE sessions ADD COLUMN duration_minutes REAL DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN user_message_count INTEGER DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN assistant_message_count INTEGER DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN tool_call_count INTEGER DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN input_tokens INTEGER DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN output_tokens INTEGER DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN cache_read_tokens INTEGER DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN total_tokens INTEGER DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN title TEXT",
  "ALTER TABLE sessions ADD COLUMN description TEXT",
  "ALTER TABLE sessions ADD COLUMN category TEXT",
  "ALTER TABLE sessions ADD COLUMN tags TEXT",
  "ALTER TABLE sessions ADD COLUMN model TEXT",
];

const SCHEMA_V4 = `
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
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent ON email_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_report ON email_logs(report_date, report_type);

CREATE TABLE IF NOT EXISTS vacations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'vacation',
  source TEXT NOT NULL DEFAULT 'manual',
  label TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vacations_date ON vacations(date);
`;

// v3 → v4 마이그레이션: 새 컬럼 추가
const MIGRATION_V3_TO_V4 = [
  "ALTER TABLE gather_reports ADD COLUMN report_date TEXT",
  "ALTER TABLE gather_reports ADD COLUMN data_hash TEXT",
  "ALTER TABLE gather_reports ADD COLUMN updated_at INTEGER",
  "ALTER TABLE daily_reports ADD COLUMN status TEXT DEFAULT 'in_progress'",
  "ALTER TABLE daily_reports ADD COLUMN progress_label TEXT",
  "ALTER TABLE daily_reports ADD COLUMN data_hash TEXT",
];

export class SqlJsAdapter implements StorageAdapter {
  private db: Database | null = null;
  private dbPath: string;
  private encryptionKey: Buffer;

  constructor(options?: { dbPath?: string; encryptionKey?: Buffer }) {
    const dataDir = join(homedir(), ".sincenety");
    this.dbPath = options?.dbPath ?? join(dataDir, "sincenety.db");
    this.encryptionKey = options?.encryptionKey ?? deriveMachineKey();
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    await mkdir(dirname(this.dbPath), { recursive: true, mode: 0o700 });

    if (existsSync(this.dbPath)) {
      const encryptedData = await readFile(this.dbPath);
      try {
        const decrypted = decrypt(encryptedData, this.encryptionKey);
        this.db = new SQL.Database(decrypted);
      } catch {
        throw new Error(
          "DB 복호화 실패 — 키가 변경되었거나 파일이 손상되었습니다.\n" +
            "  초기화하려면: rm ~/.sincenety/sincenety.db ~/.sincenety/sincenety.salt"
        );
      }
    } else {
      this.db = new SQL.Database();
    }

    this.applySchema();
  }

  private applySchema(): void {
    // 스키마 버전 확인
    let version = 0;
    try {
      const stmt = this.db!.prepare(
        "SELECT value FROM config WHERE key = 'schema_version'"
      );
      if (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        version = parseInt(row.value as string, 10) || 0;
      }
      stmt.free();
    } catch {
      // config 테이블이 없으면 v0 또는 v1
    }

    if (version < 2) {
      // v1 테이블이 있는지 확인 (마이그레이션 필요 여부)
      let hasV1Sessions = false;
      try {
        const stmt = this.db!.prepare(
          "SELECT COUNT(*) as cnt FROM sessions LIMIT 1"
        );
        if (stmt.step()) hasV1Sessions = true;
        stmt.free();
      } catch {
        // sessions 테이블 없음 → 새 DB
      }

      if (hasV1Sessions) {
        // v1 → v2 마이그레이션
        for (const sql of MIGRATION_V1_TO_V2) {
          try {
            this.db!.run(sql);
          } catch {
            // 이미 존재하는 컬럼은 무시
          }
        }
      }

      // v2 스키마 적용 (새 테이블 + 인덱스)
      this.db!.run(SCHEMA_V2);

      // 스키마 버전 저장
      this.db!.run(
        `INSERT OR REPLACE INTO config (key, value, updated_at)
         VALUES ('schema_version', '2', ?)`,
        [Date.now()]
      );
    }

    // v3: daily_reports 테이블 추가
    if (version < 3) {
      this.db!.run(SCHEMA_V3);
      this.db!.run(
        `INSERT OR REPLACE INTO config (key, value, updated_at)
         VALUES ('schema_version', '3', ?)`,
        [Date.now()]
      );
    } else {
      // 이미 v3 — 안전하게 CREATE IF NOT EXISTS 실행
      this.db!.run(SCHEMA_V3);
    }

    // v4: email_logs, vacations 테이블 + gather_reports/daily_reports 새 컬럼
    if (version < 4) {
      // 기존 테이블에 컬럼 추가
      for (const sql of MIGRATION_V3_TO_V4) {
        try {
          this.db!.run(sql);
        } catch {
          // 이미 존재하는 컬럼은 무시
        }
      }

      // 새 테이블 + 인덱스
      this.db!.run(SCHEMA_V4);

      // gather_reports의 report_date 유니크 인덱스
      // SQLite에서 UNIQUE 인덱스의 NULL은 항상 고유하므로 legacy(NULL) 레코드도 안전
      this.db!.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_gather_report_date
         ON gather_reports(report_date)`
      );

      this.db!.run(
        `INSERT OR REPLACE INTO config (key, value, updated_at)
         VALUES ('schema_version', '4', ?)`,
        [Date.now()]
      );
    } else {
      // 이미 v4 — 안전하게 CREATE IF NOT EXISTS 실행
      this.db!.run(SCHEMA_V4);
      this.db!.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_gather_report_date
         ON gather_reports(report_date)`
      );
    }
  }

  async close(): Promise<void> {
    if (!this.db) return;
    await this.save();
    this.db.close();
    this.db = null;
  }

  private async save(): Promise<void> {
    if (!this.db) return;
    const data = this.db.export();
    const encrypted = encrypt(Buffer.from(data), this.encryptionKey);
    await writeFile(this.dbPath, encrypted, { mode: 0o600 });
  }

  // ── 세션 ──

  async upsertSession(session: SessionRecord): Promise<void> {
    this.ensureDb();
    this.db!.run(
      `INSERT INTO sessions (
        id, project, project_name, started_at, ended_at, duration_minutes,
        message_count, user_message_count, assistant_message_count, tool_call_count,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens,
        title, summary, description, category, tags, model, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id, project) DO UPDATE SET
        ended_at = MAX(ended_at, excluded.ended_at),
        duration_minutes = excluded.duration_minutes,
        message_count = excluded.message_count,
        user_message_count = excluded.user_message_count,
        assistant_message_count = excluded.assistant_message_count,
        tool_call_count = excluded.tool_call_count,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        total_tokens = excluded.total_tokens,
        title = excluded.title,
        summary = excluded.summary,
        description = excluded.description,
        category = excluded.category,
        tags = excluded.tags,
        model = excluded.model`,
      [
        session.id, session.project, session.projectName,
        session.startedAt, session.endedAt, session.durationMinutes,
        session.messageCount, session.userMessageCount,
        session.assistantMessageCount, session.toolCallCount,
        session.inputTokens, session.outputTokens,
        session.cacheCreationTokens, session.cacheReadTokens, session.totalTokens,
        session.title, session.summary, session.description,
        session.category, session.tags, session.model, session.createdAt,
      ]
    );
  }

  async upsertSessions(sessions: SessionRecord[]): Promise<void> {
    for (const session of sessions) {
      await this.upsertSession(session);
    }
    await this.save();
  }

  async getSessionsByDate(dateStr: string): Promise<SessionRecord[]> {
    this.ensureDb();
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`유효하지 않은 날짜: ${dateStr}`);
    }
    const dayStart = new Date(
      date.getFullYear(), date.getMonth(), date.getDate()
    ).getTime();
    return this.getSessionsByRange(dayStart, dayStart + 86400000);
  }

  async getSessionsByRange(from: number, to: number): Promise<SessionRecord[]> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      `SELECT * FROM sessions
       WHERE started_at >= ? AND started_at < ?
       ORDER BY started_at ASC`
    );
    stmt.bind([from, to]);
    const results: SessionRecord[] = [];
    while (stmt.step()) {
      results.push(this.rowToSessionRecord(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  private rowToSessionRecord(row: Record<string, unknown>): SessionRecord {
    return {
      id: row.id as string,
      project: row.project as string,
      projectName: (row.project_name as string) ?? "",
      startedAt: row.started_at as number,
      endedAt: row.ended_at as number,
      durationMinutes: (row.duration_minutes as number) ?? 0,
      messageCount: (row.message_count as number) ?? 0,
      userMessageCount: (row.user_message_count as number) ?? 0,
      assistantMessageCount: (row.assistant_message_count as number) ?? 0,
      toolCallCount: (row.tool_call_count as number) ?? 0,
      inputTokens: (row.input_tokens as number) ?? 0,
      outputTokens: (row.output_tokens as number) ?? 0,
      cacheCreationTokens: (row.cache_creation_tokens as number) ?? 0,
      cacheReadTokens: (row.cache_read_tokens as number) ?? 0,
      totalTokens: (row.total_tokens as number) ?? 0,
      title: (row.title as string) ?? "",
      summary: (row.summary as string) ?? "",
      description: (row.description as string) ?? "",
      category: (row.category as string) ?? "",
      tags: (row.tags as string) ?? "",
      model: (row.model as string) ?? "",
      createdAt: row.created_at as number,
    };
  }

  // ── 갈무리 리포트 ──

  async saveGatherReport(report: GatherReport): Promise<number> {
    this.ensureDb();

    if (report.reportDate) {
      // v4: date-based upsert
      this.db!.run(
        `INSERT INTO gather_reports (
          gathered_at, from_timestamp, to_timestamp,
          session_count, total_messages, total_input_tokens, total_output_tokens,
          report_markdown, report_json, emailed_at, email_to,
          report_date, data_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(report_date) DO UPDATE SET
          gathered_at = excluded.gathered_at,
          from_timestamp = excluded.from_timestamp,
          to_timestamp = excluded.to_timestamp,
          session_count = excluded.session_count,
          total_messages = excluded.total_messages,
          total_input_tokens = excluded.total_input_tokens,
          total_output_tokens = excluded.total_output_tokens,
          report_markdown = excluded.report_markdown,
          report_json = excluded.report_json,
          emailed_at = excluded.emailed_at,
          email_to = excluded.email_to,
          data_hash = excluded.data_hash,
          updated_at = excluded.updated_at`,
        [
          report.gatheredAt, report.fromTimestamp, report.toTimestamp,
          report.sessionCount, report.totalMessages,
          report.totalInputTokens, report.totalOutputTokens,
          report.reportMarkdown, report.reportJson,
          report.emailedAt, report.emailTo,
          report.reportDate, report.dataHash, report.updatedAt,
        ]
      );
    } else {
      // legacy insert (v3 compat)
      this.db!.run(
        `INSERT INTO gather_reports (
          gathered_at, from_timestamp, to_timestamp,
          session_count, total_messages, total_input_tokens, total_output_tokens,
          report_markdown, report_json, emailed_at, email_to
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          report.gatheredAt, report.fromTimestamp, report.toTimestamp,
          report.sessionCount, report.totalMessages,
          report.totalInputTokens, report.totalOutputTokens,
          report.reportMarkdown, report.reportJson,
          report.emailedAt, report.emailTo,
        ]
      );
    }

    // ID 조회: date-based upsert 시 last_insert_rowid()가 부정확할 수 있음
    let id: number;
    if (report.reportDate) {
      const idStmt = this.db!.prepare("SELECT id FROM gather_reports WHERE report_date = ?");
      idStmt.bind([report.reportDate]);
      idStmt.step();
      id = (idStmt.getAsObject() as Record<string, unknown>).id as number;
      idStmt.free();
    } else {
      const idStmt = this.db!.prepare("SELECT last_insert_rowid() as id");
      idStmt.step();
      id = (idStmt.getAsObject() as Record<string, unknown>).id as number;
      idStmt.free();
    }
    await this.save();
    return id;
  }

  async getGatherReportsByDate(dateStr: string): Promise<GatherReport[]> {
    this.ensureDb();
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) throw new Error(`유효하지 않은 날짜: ${dateStr}`);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const dayEnd = dayStart + 86400000;

    const stmt = this.db!.prepare(
      `SELECT * FROM gather_reports
       WHERE gathered_at >= ? AND gathered_at < ?
       ORDER BY gathered_at DESC`
    );
    stmt.bind([dayStart, dayEnd]);
    const results: GatherReport[] = [];
    while (stmt.step()) {
      results.push(this.rowToGatherReport(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  async getLatestGatherReport(): Promise<GatherReport | null> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      "SELECT * FROM gather_reports ORDER BY id DESC LIMIT 1"
    );
    if (stmt.step()) {
      const report = this.rowToGatherReport(stmt.getAsObject());
      stmt.free();
      return report;
    }
    stmt.free();
    return null;
  }

  async updateReportEmail(reportId: number, emailedAt: number, emailTo: string): Promise<void> {
    this.ensureDb();
    this.db!.run(
      "UPDATE gather_reports SET emailed_at = ?, email_to = ? WHERE id = ?",
      [emailedAt, emailTo, reportId]
    );
    await this.save();
  }

  private rowToGatherReport(row: Record<string, unknown>): GatherReport {
    return {
      id: row.id as number,
      gatheredAt: row.gathered_at as number,
      fromTimestamp: row.from_timestamp as number,
      toTimestamp: row.to_timestamp as number,
      sessionCount: (row.session_count as number) ?? 0,
      totalMessages: (row.total_messages as number) ?? 0,
      totalInputTokens: (row.total_input_tokens as number) ?? 0,
      totalOutputTokens: (row.total_output_tokens as number) ?? 0,
      reportMarkdown: (row.report_markdown as string) ?? "",
      reportJson: (row.report_json as string) ?? "",
      emailedAt: (row.emailed_at as number) ?? null,
      emailTo: (row.email_to as string) ?? null,
      reportDate: (row.report_date as string) ?? null,
      dataHash: (row.data_hash as string) ?? null,
      updatedAt: (row.updated_at as number) ?? null,
    };
  }

  async getGatherReportByDate(date: string): Promise<GatherReport | null> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      "SELECT * FROM gather_reports WHERE report_date = ? LIMIT 1"
    );
    stmt.bind([date]);
    if (stmt.step()) {
      const report = this.rowToGatherReport(stmt.getAsObject());
      stmt.free();
      return report;
    }
    stmt.free();
    return null;
  }

  // ── 설정 ──

  async getConfig(key: string): Promise<string | null> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      "SELECT value FROM config WHERE key = ?"
    );
    stmt.bind([key]);
    if (stmt.step()) {
      const val = (stmt.getAsObject() as Record<string, unknown>).value as string;
      stmt.free();
      return val;
    }
    stmt.free();
    return null;
  }

  async setConfig(key: string, value: string): Promise<void> {
    this.ensureDb();
    this.db!.run(
      `INSERT OR REPLACE INTO config (key, value, updated_at)
       VALUES (?, ?, ?)`,
      [key, value, Date.now()]
    );
    await this.save();
  }

  // ── 체크포인트 ──

  async getLastCheckpoint(): Promise<number | null> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      "SELECT timestamp FROM checkpoints ORDER BY id DESC LIMIT 1"
    );
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return row.timestamp as number;
    }
    stmt.free();
    return null;
  }

  async saveCheckpoint(timestamp: number): Promise<void> {
    this.ensureDb();
    this.db!.run(
      "INSERT INTO checkpoints (timestamp, created_at) VALUES (?, ?)",
      [timestamp, Date.now()]
    );
    await this.save();
  }

  // ── 일일/주간/월간 보고 ──

  private rowToDailyReport(row: Record<string, unknown>): DailyReport {
    return {
      id: row.id as number,
      reportDate: row.report_date as string,
      reportType: row.report_type as DailyReport["reportType"],
      periodFrom: row.period_from as number,
      periodTo: row.period_to as number,
      sessionCount: (row.session_count as number) ?? 0,
      totalMessages: (row.total_messages as number) ?? 0,
      totalTokens: (row.total_tokens as number) ?? 0,
      summaryJson: (row.summary_json as string) ?? "[]",
      overview: (row.overview as string) ?? null,
      reportMarkdown: (row.report_markdown as string) ?? null,
      createdAt: row.created_at as number,
      emailedAt: (row.emailed_at as number) ?? null,
      emailTo: (row.email_to as string) ?? null,
      status: (row.status as string) ?? null,
      progressLabel: (row.progress_label as string) ?? null,
      dataHash: (row.data_hash as string) ?? null,
    };
  }

  async saveDailyReport(report: DailyReport): Promise<number> {
    this.ensureDb();
    // ON CONFLICT upsert: emailed_at/email_to를 보존 (INSERT OR REPLACE는 DELETE+INSERT로 기존 값 유실)
    this.db!.run(
      `INSERT INTO daily_reports
       (report_date, report_type, period_from, period_to,
        session_count, total_messages, total_tokens,
        summary_json, overview, report_markdown, created_at,
        status, progress_label, data_hash, emailed_at, email_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_date, report_type) DO UPDATE SET
        period_from = excluded.period_from,
        period_to = excluded.period_to,
        session_count = excluded.session_count,
        total_messages = excluded.total_messages,
        total_tokens = excluded.total_tokens,
        summary_json = excluded.summary_json,
        overview = excluded.overview,
        report_markdown = excluded.report_markdown,
        created_at = excluded.created_at,
        status = excluded.status,
        progress_label = excluded.progress_label,
        data_hash = excluded.data_hash`,
      [
        report.reportDate, report.reportType,
        report.periodFrom, report.periodTo,
        report.sessionCount, report.totalMessages, report.totalTokens,
        report.summaryJson, report.overview, report.reportMarkdown,
        report.createdAt,
        report.status ?? "in_progress", report.progressLabel ?? null, report.dataHash ?? null,
        report.emailedAt ?? null, report.emailTo ?? null,
      ]
    );
    // upsert 후 정확한 ID 조회
    const idStmt = this.db!.prepare(
      "SELECT id FROM daily_reports WHERE report_date = ? AND report_type = ?"
    );
    idStmt.bind([report.reportDate, report.reportType]);
    idStmt.step();
    const id = (idStmt.getAsObject() as Record<string, unknown>).id as number;
    idStmt.free();
    await this.save();
    return id;
  }

  async getDailyReport(date: string, type = "daily"): Promise<DailyReport | null> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      "SELECT * FROM daily_reports WHERE report_date = ? AND report_type = ? LIMIT 1"
    );
    stmt.bind([date, type]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return this.rowToDailyReport(row);
    }
    stmt.free();
    return null;
  }

  async getDailyReportsByRange(from: string, to: string, type = "daily"): Promise<DailyReport[]> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      `SELECT * FROM daily_reports
       WHERE report_date >= ? AND report_date <= ? AND report_type = ?
       ORDER BY report_date ASC`
    );
    stmt.bind([from, to, type]);
    const results: DailyReport[] = [];
    while (stmt.step()) {
      results.push(this.rowToDailyReport(stmt.getAsObject() as Record<string, unknown>));
    }
    stmt.free();
    return results;
  }

  async getLatestDailyReport(type = "daily"): Promise<DailyReport | null> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      "SELECT * FROM daily_reports WHERE report_type = ? ORDER BY report_date DESC LIMIT 1"
    );
    stmt.bind([type]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      stmt.free();
      return this.rowToDailyReport(row);
    }
    stmt.free();
    return null;
  }

  async updateDailyReportEmail(reportId: number, emailedAt: number, emailTo: string): Promise<void> {
    this.ensureDb();
    this.db!.run(
      "UPDATE daily_reports SET emailed_at = ?, email_to = ? WHERE id = ?",
      [emailedAt, emailTo, reportId]
    );
    await this.save();
  }

  async updateDailyReportStatus(
    reportDate: string,
    reportType: string,
    status: string,
    progressLabel?: string
  ): Promise<void> {
    this.ensureDb();
    this.db!.run(
      `UPDATE daily_reports SET status = ?, progress_label = ?
       WHERE report_date = ? AND report_type = ?`,
      [status, progressLabel ?? null, reportDate, reportType]
    );
    await this.save();
  }

  // ── 휴가 ──

  async saveVacation(vacation: VacationRecord): Promise<void> {
    this.ensureDb();
    this.db!.run(
      `INSERT OR REPLACE INTO vacations (date, type, source, label, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [vacation.date, vacation.type, vacation.source, vacation.label, vacation.createdAt]
    );
    await this.save();
  }

  async getVacationsByRange(from: string, to: string): Promise<VacationRecord[]> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      `SELECT * FROM vacations
       WHERE date >= ? AND date <= ?
       ORDER BY date ASC`
    );
    stmt.bind([from, to]);
    const results: VacationRecord[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push({
        id: row.id as number,
        date: row.date as string,
        type: row.type as string,
        source: row.source as string,
        label: (row.label as string) ?? null,
        createdAt: row.created_at as number,
      });
    }
    stmt.free();
    return results;
  }

  async deleteVacation(date: string): Promise<void> {
    this.ensureDb();
    this.db!.run("DELETE FROM vacations WHERE date = ?", [date]);
    await this.save();
  }

  // ── 이메일 로그 ──

  async saveEmailLog(log: EmailLog): Promise<void> {
    this.ensureDb();
    this.db!.run(
      `INSERT INTO email_logs (
        sent_at, report_type, report_date, period_from, period_to,
        recipient, subject, body_html, body_text,
        provider, status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        log.sentAt, log.reportType, log.reportDate,
        log.periodFrom, log.periodTo,
        log.recipient, log.subject, log.bodyHtml, log.bodyText,
        log.provider, log.status, log.errorMessage,
      ]
    );
    await this.save();
  }

  async getEmailLogs(limit: number): Promise<EmailLog[]> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      `SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT ?`
    );
    stmt.bind([limit]);
    const results: EmailLog[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      results.push({
        id: row.id as number,
        sentAt: row.sent_at as number,
        reportType: row.report_type as string,
        reportDate: row.report_date as string,
        periodFrom: row.period_from as string,
        periodTo: row.period_to as string,
        recipient: row.recipient as string,
        subject: row.subject as string,
        bodyHtml: (row.body_html as string) ?? "",
        bodyText: (row.body_text as string) ?? "",
        provider: row.provider as string,
        status: row.status as string,
        errorMessage: (row.error_message as string) ?? null,
      });
    }
    stmt.free();
    return results;
  }

  private ensureDb(): void {
    if (!this.db) {
      throw new Error("Database not initialized. Call initialize() first.");
    }
  }
}
