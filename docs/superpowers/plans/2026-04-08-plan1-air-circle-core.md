# Plan 1: Core Pipeline — air + circle + DB v4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure CLI from monolithic gather to 3-phase pipeline (`air` → `circle` → out), with DB v4 schema supporting date-based gather, report finalization, and change detection.

**Architecture:** `air` replaces the default gather command with date-grouped upsert and checkpoint-based backfill. `circle` chains `air` internally and outputs JSON for SKILL.md to feed LLM summaries back via `circle --save`. Old commands (`log`, `report`, `email`, `save-daily`) are removed; `config` and `schedule` remain.

**Tech Stack:** TypeScript ESM, commander, sql.js (WASM SQLite), vitest

**Spec:** `docs/superpowers/specs/2026-04-08-cli-restructure-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/storage/adapter.ts` | Add `GatherReportV2`, `VacationRecord` interfaces; add `status`/`data_hash` to `DailyReport`; add new adapter methods |
| Modify | `src/storage/sqljs-adapter.ts` | v3→v4 migration (3 ALTERs, 2 CREATEs); implement new methods |
| Modify | `src/core/gatherer.ts` | Add `gatherByDate()` — date-grouped gather with backfill |
| Create | `src/core/air.ts` | `air` orchestrator: checkpoint → range → gatherByDate → report |
| Create | `src/core/circle.ts` | `circle` orchestrator: air → finalize → change-detect → output JSON / save |
| Modify | `src/cli.ts` | Replace commands: remove default/log/report/email/save-daily; add air/circle; keep config/schedule |
| Modify | `src/report/terminal.ts` | Remove `formatLogReport`; add `formatAirReport` (date-grouped output) |
| Create | `tests/air.test.ts` | air orchestrator tests |
| Create | `tests/circle.test.ts` | circle orchestrator tests |
| Create | `tests/migration-v4.test.ts` | DB v4 migration tests |

---

### Task 1: DB v4 Schema Migration

**Files:**
- Modify: `src/storage/adapter.ts`
- Modify: `src/storage/sqljs-adapter.ts`
- Create: `tests/migration-v4.test.ts`

- [ ] **Step 1: Write migration test**

```typescript
// tests/migration-v4.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

describe("DB v4 migration", () => {
  let tmpDir: string;
  let adapter: SqlJsAdapter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sincenety-test-"));
    adapter = new SqlJsAdapter({
      dbPath: join(tmpDir, "test.db"),
    });
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should create email_logs table", async () => {
    // email_logs should exist after initialization
    const result = await adapter.getEmailLogs(5);
    expect(result).toEqual([]);
  });

  it("should create vacations table", async () => {
    const result = await adapter.getVacationsByRange("2026-01-01", "2026-12-31");
    expect(result).toEqual([]);
  });

  it("should add status column to daily_reports", async () => {
    const id = await adapter.saveDailyReport({
      reportDate: "2026-04-08",
      reportType: "daily",
      periodFrom: Date.now(),
      periodTo: Date.now(),
      sessionCount: 0,
      totalMessages: 0,
      totalTokens: 0,
      summaryJson: "[]",
      overview: null,
      reportMarkdown: null,
      createdAt: Date.now(),
      emailedAt: null,
      emailTo: null,
      status: "in_progress",
      progressLabel: null,
      dataHash: null,
    });
    const report = await adapter.getDailyReport("2026-04-08");
    expect(report?.status).toBe("in_progress");
  });

  it("should add report_date to gather_reports with upsert by date", async () => {
    const report1 = {
      gatheredAt: Date.now(),
      fromTimestamp: Date.now() - 86400000,
      toTimestamp: Date.now(),
      sessionCount: 2,
      totalMessages: 100,
      totalInputTokens: 1000,
      totalOutputTokens: 2000,
      reportMarkdown: "# test",
      reportJson: "[]",
      emailedAt: null,
      emailTo: null,
      reportDate: "2026-04-08",
      dataHash: "abc123",
      updatedAt: Date.now(),
    };
    await adapter.saveGatherReport(report1);

    // Upsert same date — should overwrite
    const report2 = { ...report1, sessionCount: 3, dataHash: "def456" };
    await adapter.saveGatherReport(report2);

    const result = await adapter.getGatherReportByDate("2026-04-08");
    expect(result?.sessionCount).toBe(3);
    expect(result?.dataHash).toBe("def456");
  });

  it("should save and retrieve vacation records", async () => {
    await adapter.saveVacation({
      date: "2026-04-10",
      type: "vacation",
      source: "manual",
      label: "연차",
      createdAt: Date.now(),
    });
    const vacations = await adapter.getVacationsByRange("2026-04-01", "2026-04-30");
    expect(vacations).toHaveLength(1);
    expect(vacations[0].type).toBe("vacation");
  });

  it("should save and retrieve email logs", async () => {
    await adapter.saveEmailLog({
      sentAt: Date.now(),
      reportType: "daily",
      reportDate: "2026-04-08",
      periodFrom: "2026-04-08",
      periodTo: "2026-04-08",
      recipient: "test@test.com",
      subject: "test",
      bodyHtml: "<p>test</p>",
      bodyText: "test",
      provider: "gmail_smtp",
      status: "sent",
      errorMessage: null,
    });
    const logs = await adapter.getEmailLogs(10);
    expect(logs).toHaveLength(1);
    expect(logs[0].provider).toBe("gmail_smtp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/migration-v4.test.ts`
Expected: FAIL — methods don't exist yet

- [ ] **Step 3: Update adapter.ts interfaces**

```typescript
// Add to src/storage/adapter.ts — after DailyReport interface

// Extend DailyReport with v4 fields
export interface DailyReport {
  id?: number;
  reportDate: string;
  reportType: "daily" | "weekly" | "monthly";
  periodFrom: number;
  periodTo: number;
  sessionCount: number;
  totalMessages: number;
  totalTokens: number;
  summaryJson: string;
  overview: string | null;
  reportMarkdown: string | null;
  createdAt: number;
  emailedAt: number | null;
  emailTo: string | null;
  // v4
  status: string | null;         // "in_progress" | "finalized"
  progressLabel: string | null;   // "진행중 — 3/7일"
  dataHash: string | null;        // gather data hash for change detection
}

// Extend GatherReport with v4 fields
export interface GatherReport {
  id?: number;
  gatheredAt: number;
  fromTimestamp: number;
  toTimestamp: number;
  sessionCount: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  reportMarkdown: string;
  reportJson: string;
  emailedAt: number | null;
  emailTo: string | null;
  // v4
  reportDate: string | null;    // YYYY-MM-DD for date-based upsert
  dataHash: string | null;
  updatedAt: number | null;
}

export interface VacationRecord {
  id?: number;
  date: string;           // YYYY-MM-DD
  type: string;           // vacation | sick | holiday | half | other
  source: string;         // manual | gcal_auto
  label: string | null;
  createdAt: number;
}

export interface EmailLog {
  id?: number;
  sentAt: number;
  reportType: string;     // daily | weekly | monthly
  reportDate: string;
  periodFrom: string;
  periodTo: string;
  recipient: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  provider: string;       // gmail_mcp | resend | gmail_smtp | custom_smtp
  status: string;         // sent | failed | draft
  errorMessage: string | null;
}

// Add to StorageAdapter interface:
export interface StorageAdapter {
  // ... existing methods ...

  // v4: gather reports by date
  getGatherReportByDate(date: string): Promise<GatherReport | null>;

  // v4: vacations
  saveVacation(vacation: VacationRecord): Promise<void>;
  getVacationsByRange(from: string, to: string): Promise<VacationRecord[]>;
  deleteVacation(date: string): Promise<void>;

  // v4: email logs
  saveEmailLog(log: EmailLog): Promise<void>;
  getEmailLogs(limit: number): Promise<EmailLog[]>;

  // v4: daily report status
  updateDailyReportStatus(reportDate: string, reportType: string, status: string, progressLabel?: string): Promise<void>;
}
```

- [ ] **Step 4: Add v4 migration SQL to sqljs-adapter.ts**

Add after `SCHEMA_V3` constant (around line 95):

```typescript
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
CREATE INDEX IF NOT EXISTS idx_email_logs_date ON email_logs(report_date);

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

const MIGRATION_V3_TO_V4 = [
  "ALTER TABLE gather_reports ADD COLUMN report_date TEXT",
  "ALTER TABLE gather_reports ADD COLUMN data_hash TEXT",
  "ALTER TABLE gather_reports ADD COLUMN updated_at INTEGER",
  "ALTER TABLE daily_reports ADD COLUMN status TEXT DEFAULT 'in_progress'",
  "ALTER TABLE daily_reports ADD COLUMN progress_label TEXT",
  "ALTER TABLE daily_reports ADD COLUMN data_hash TEXT",
];
```

- [ ] **Step 5: Add v4 migration to applySchema()**

In `applySchema()`, after the v3 block (around line 211), add:

```typescript
    // v4: email_logs, vacations, gather_reports date columns
    if (version < 4) {
      for (const sql of MIGRATION_V3_TO_V4) {
        try {
          this.db!.run(sql);
        } catch {
          // Column already exists — ignore
        }
      }
      this.db!.run(SCHEMA_V4);

      // Create unique index for gather_reports by date (for upsert)
      try {
        this.db!.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_gather_report_date ON gather_reports(report_date)");
      } catch {
        // Already exists
      }

      this.db!.run(
        `INSERT OR REPLACE INTO config (key, value, updated_at)
         VALUES ('schema_version', '4', ?)`,
        [Date.now()]
      );
    }
```

- [ ] **Step 6: Implement new adapter methods in SqlJsAdapter**

Add these methods to `SqlJsAdapter` class:

```typescript
  // ── v4: gather report by date ──

  async getGatherReportByDate(date: string): Promise<GatherReport | null> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      "SELECT * FROM gather_reports WHERE report_date = ? LIMIT 1"
    );
    stmt.bind([date]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToGatherReport(row);
    }
    stmt.free();
    return null;
  }

  // ── v4: vacations ──

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
      "SELECT * FROM vacations WHERE date >= ? AND date <= ? ORDER BY date ASC"
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

  // ── v4: email logs ──

  async saveEmailLog(log: EmailLog): Promise<void> {
    this.ensureDb();
    this.db!.run(
      `INSERT INTO email_logs (
        sent_at, report_type, report_date, period_from, period_to,
        recipient, subject, body_html, body_text, provider, status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        log.sentAt, log.reportType, log.reportDate,
        log.periodFrom, log.periodTo, log.recipient,
        log.subject, log.bodyHtml, log.bodyText,
        log.provider, log.status, log.errorMessage,
      ]
    );
    await this.save();
  }

  async getEmailLogs(limit: number): Promise<EmailLog[]> {
    this.ensureDb();
    const stmt = this.db!.prepare(
      "SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT ?"
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

  // ── v4: daily report status ──

  async updateDailyReportStatus(
    reportDate: string, reportType: string, status: string, progressLabel?: string
  ): Promise<void> {
    this.ensureDb();
    this.db!.run(
      `UPDATE daily_reports SET status = ?, progress_label = ?
       WHERE report_date = ? AND report_type = ?`,
      [status, progressLabel ?? null, reportDate, reportType]
    );
    await this.save();
  }
```

- [ ] **Step 7: Update rowToGatherReport and rowToDailyReport for v4 fields**

Update `rowToGatherReport`:
```typescript
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
      // v4
      reportDate: (row.report_date as string) ?? null,
      dataHash: (row.data_hash as string) ?? null,
      updatedAt: (row.updated_at as number) ?? null,
    };
  }
```

Update `rowToDailyReport`:
```typescript
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
      // v4
      status: (row.status as string) ?? null,
      progressLabel: (row.progress_label as string) ?? null,
      dataHash: (row.data_hash as string) ?? null,
    };
  }
```

- [ ] **Step 8: Update saveGatherReport for date-based upsert**

Replace `saveGatherReport` in `SqlJsAdapter`:

```typescript
  async saveGatherReport(report: GatherReport): Promise<number> {
    this.ensureDb();
    if (report.reportDate) {
      // v4: upsert by report_date
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
          data_hash = excluded.data_hash,
          updated_at = excluded.updated_at`,
        [
          report.gatheredAt, report.fromTimestamp, report.toTimestamp,
          report.sessionCount, report.totalMessages,
          report.totalInputTokens, report.totalOutputTokens,
          report.reportMarkdown, report.reportJson,
          report.emailedAt, report.emailTo,
          report.reportDate, report.dataHash, report.updatedAt ?? Date.now(),
        ]
      );
    } else {
      // Legacy: no report_date (v3 compat)
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
    const stmt = this.db!.prepare("SELECT last_insert_rowid() as id");
    stmt.step();
    const id = (stmt.getAsObject() as Record<string, unknown>).id as number;
    stmt.free();
    await this.save();
    return id;
  }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/migration-v4.test.ts`
Expected: ALL PASS

- [ ] **Step 10: Commit**

```bash
git add src/storage/adapter.ts src/storage/sqljs-adapter.ts tests/migration-v4.test.ts
git commit -m "feat: DB v4 schema — email_logs, vacations, status/hash columns"
```

---

### Task 2: `air` Core — Date-Grouped Gather with Backfill

**Files:**
- Create: `src/core/air.ts`
- Modify: `src/core/gatherer.ts` (add `gatherByDate` helper)
- Create: `tests/air.test.ts`

- [ ] **Step 1: Write air test**

```typescript
// tests/air.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

describe("air command", () => {
  let tmpDir: string;
  let adapter: SqlJsAdapter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sincenety-air-"));
    adapter = new SqlJsAdapter({ dbPath: join(tmpDir, "test.db") });
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should group sessions by calendar date", async () => {
    const { groupSessionsByDate } = await import("../src/core/air.js");

    const sessions = [
      { startedAt: new Date("2026-04-07T10:00:00").getTime(), sessionId: "s1", projectName: "proj1" },
      { startedAt: new Date("2026-04-07T15:00:00").getTime(), sessionId: "s2", projectName: "proj1" },
      { startedAt: new Date("2026-04-08T09:00:00").getTime(), sessionId: "s3", projectName: "proj2" },
    ];

    const grouped = groupSessionsByDate(sessions as any);
    expect(Object.keys(grouped)).toEqual(["2026-04-07", "2026-04-08"]);
    expect(grouped["2026-04-07"]).toHaveLength(2);
    expect(grouped["2026-04-08"]).toHaveLength(1);
  });

  it("should compute data hash for change detection", async () => {
    const { computeDataHash } = await import("../src/core/air.js");

    const hash1 = computeDataHash([{ sessionId: "s1", messageCount: 10 }] as any);
    const hash2 = computeDataHash([{ sessionId: "s1", messageCount: 10 }] as any);
    const hash3 = computeDataHash([{ sessionId: "s1", messageCount: 11 }] as any);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  it("should detect backfill range from checkpoint", async () => {
    const { determineRange } = await import("../src/core/air.js");

    // No checkpoint = first run
    const range1 = await determineRange(adapter);
    expect(range1.isFirstRun).toBe(true);

    // After checkpoint
    const threeDaysAgo = Date.now() - 3 * 86400000;
    await adapter.saveCheckpoint(threeDaysAgo);
    const range2 = await determineRange(adapter);
    expect(range2.isFirstRun).toBe(false);
    // From should be the checkpoint date's 00:00
    const checkpointDate = new Date(threeDaysAgo);
    checkpointDate.setHours(0, 0, 0, 0);
    expect(range2.from).toBe(checkpointDate.getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/air.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Create air.ts**

```typescript
// src/core/air.ts
/**
 * air — 환기: 기록 수집/저장 (날짜별 upsert, 자동 백필)
 */

import { createHash } from "node:crypto";
import { parseHistory, getDefaultHistoryPath } from "../parser/history.js";
import { groupFromStream, type SessionGroup } from "../grouper/session.js";
import type { StorageAdapter, GatherReport } from "../storage/adapter.js";

export interface AirResult {
  dates: string[];             // 처리된 날짜 목록
  totalSessions: number;
  isFirstRun: boolean;
  backfillDays: number;        // 백필 일수
  changedDates: string[];      // 데이터 해시가 변경된 날짜
}

/** 세션 목록을 startedAt 기준 날짜별로 그룹핑 */
export function groupSessionsByDate(
  sessions: SessionGroup[],
): Record<string, SessionGroup[]> {
  const grouped: Record<string, SessionGroup[]> = {};
  for (const s of sessions) {
    const date = new Date(s.startedAt).toISOString().slice(0, 10);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(s);
  }
  return grouped;
}

/** 세션 목록의 변경 감지용 해시 계산 */
export function computeDataHash(sessions: SessionGroup[]): string {
  const payload = sessions.map((s) => `${s.sessionId}:${s.messageCount}`).sort().join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** checkpoint 기반으로 gather 범위를 자동 판단 */
export async function determineRange(
  storage: StorageAdapter,
): Promise<{ from: number; to: number; isFirstRun: boolean }> {
  const now = Date.now();
  const lastCheckpoint = await storage.getLastCheckpoint();

  if (lastCheckpoint == null) {
    // 첫 실행: 가능한 한 전체 백필 (90일 전부터)
    const ninetyDaysAgo = now - 90 * 86400000;
    return { from: ninetyDaysAgo, to: now, isFirstRun: true };
  }

  // 마지막 checkpoint 날짜의 00:00부터
  const fromDate = new Date(lastCheckpoint);
  fromDate.setHours(0, 0, 0, 0);
  return { from: fromDate.getTime(), to: now, isFirstRun: false };
}

/** air 메인 실행 */
export async function runAir(
  storage: StorageAdapter,
  options: { historyPath?: string; json?: boolean } = {},
): Promise<AirResult> {
  const historyPath = options.historyPath ?? getDefaultHistoryPath();
  const { from, to, isFirstRun } = await determineRange(storage);

  // 백필 일수 계산
  const backfillDays = Math.ceil((to - from) / 86400000);
  if (isFirstRun) {
    console.log(`  첫 실행 — 최대 ${backfillDays}일분 백필합니다`);
  } else if (backfillDays > 1) {
    console.log(`  ${backfillDays}일분 미수집 발견, 백필합니다`);
  }

  // 파싱 + 그룹핑
  const { enrichSessionsFromJsonl } = await import("../parser/session-jsonl.js");
  const entries = parseHistory({ historyPath, sinceTimestamp: from });
  const baseSessions = await groupFromStream(entries);
  const details = await enrichSessionsFromJsonl(baseSessions);
  const sessions: SessionGroup[] = details.map((d) => ({ ...d, messages: [], tags: [] }));

  // 날짜별 그룹핑
  const byDate = groupSessionsByDate(sessions);
  const dates = Object.keys(byDate).sort();
  const changedDates: string[] = [];

  // 빈 날짜도 포함 (연속성 보장)
  const allDates = generateDateRange(
    new Date(from).toISOString().slice(0, 10),
    new Date(to).toISOString().slice(0, 10),
  );

  for (const date of allDates) {
    const daySessions = byDate[date] ?? [];
    const hash = computeDataHash(daySessions);

    // 기존 리포트의 해시와 비교
    const existing = await storage.getGatherReportByDate(date);
    if (existing?.dataHash === hash) {
      continue; // 변경 없음 — 스킵
    }

    changedDates.push(date);

    // 세션 레코드 upsert
    if (daySessions.length > 0) {
      const { sessionGroupToRecord } = await import("./gatherer.js");
      const records = daySessions.map(sessionGroupToRecord);
      await storage.upsertSessions(records);
    }

    // gather_report 날짜별 upsert
    const dayStart = new Date(date + "T00:00:00").getTime();
    const dayEnd = dayStart + 86400000;
    const totalMessages = daySessions.reduce((s, g) => s + g.messageCount, 0);
    const totalIn = daySessions.reduce((s, g) => s + (g.inputTokens ?? 0), 0);
    const totalOut = daySessions.reduce((s, g) => s + (g.outputTokens ?? 0), 0);

    const { generateMarkdownReport } = await import("../report/markdown.js");
    const markdown = daySessions.length > 0
      ? generateMarkdownReport(daySessions, dayStart, dayEnd)
      : `# ${date}\n\n활동 없음`;

    const report: GatherReport = {
      gatheredAt: Date.now(),
      fromTimestamp: dayStart,
      toTimestamp: dayEnd,
      sessionCount: daySessions.length,
      totalMessages,
      totalInputTokens: totalIn,
      totalOutputTokens: totalOut,
      reportMarkdown: markdown,
      reportJson: JSON.stringify(daySessions.map((s) => ({
        sessionId: s.sessionId,
        projectName: s.projectName,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMinutes: s.durationMinutes ?? 0,
        messageCount: s.messageCount,
        userMessageCount: s.userMessageCount ?? 0,
        assistantMessageCount: s.assistantMessageCount ?? 0,
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        totalTokens: (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
        model: s.model ?? "",
        title: s.title ?? s.summary,
        description: s.description ?? "",
        conversationTurns: (s.conversationTurns ?? []).map((t) => ({
          timestamp: t.timestamp,
          userInput: t.userInput,
          assistantOutput: t.assistantOutput,
        })),
      }))),
      emailedAt: null,
      emailTo: null,
      reportDate: date,
      dataHash: hash,
      updatedAt: Date.now(),
    };

    await storage.saveGatherReport(report);
  }

  await storage.saveCheckpoint(to);

  return {
    dates: allDates,
    totalSessions: sessions.length,
    isFirstRun,
    backfillDays,
    changedDates,
  };
}

/** 두 날짜 사이의 모든 날짜 생성 (주말 포함) */
function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from);
  const end = new Date(to);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
```

- [ ] **Step 4: Export sessionGroupToRecord from gatherer.ts**

In `src/core/gatherer.ts`, change `function sessionGroupToRecord` to:

```typescript
export function sessionGroupToRecord(group: SessionGroup): SessionRecord {
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/air.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/air.ts src/core/gatherer.ts tests/air.test.ts
git commit -m "feat: air command — date-grouped gather with backfill and change detection"
```

---

### Task 3: `circle` Core — Finalization + JSON Output + Save

**Files:**
- Create: `src/core/circle.ts`
- Create: `tests/circle.test.ts`

- [ ] **Step 1: Write circle test**

```typescript
// tests/circle.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

describe("circle command", () => {
  let tmpDir: string;
  let adapter: SqlJsAdapter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sincenety-circle-"));
    adapter = new SqlJsAdapter({ dbPath: join(tmpDir, "test.db") });
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should finalize previous day report", async () => {
    const { finalizePreviousReports } = await import("../src/core/circle.js");

    // Create yesterday's daily report as in_progress
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);

    await adapter.saveDailyReport({
      reportDate: yStr,
      reportType: "daily",
      periodFrom: yesterday.getTime(),
      periodTo: yesterday.getTime() + 86400000,
      sessionCount: 2,
      totalMessages: 100,
      totalTokens: 5000,
      summaryJson: "[]",
      overview: "test",
      reportMarkdown: null,
      createdAt: Date.now(),
      emailedAt: null,
      emailTo: null,
      status: "in_progress",
      progressLabel: null,
      dataHash: null,
    });

    await finalizePreviousReports(adapter, new Date());
    const report = await adapter.getDailyReport(yStr);
    expect(report?.status).toBe("finalized");
  });

  it("should calculate week boundaries correctly", async () => {
    const { getWeekBoundary } = await import("../src/core/circle.js");

    // 2026-04-08 is Wednesday
    const wed = new Date("2026-04-08T12:00:00");
    const { monday, sunday } = getWeekBoundary(wed);
    expect(monday).toBe("2026-04-06");
    expect(sunday).toBe("2026-04-12");
  });

  it("should calculate progress label", async () => {
    const { getProgressLabel } = await import("../src/core/circle.js");

    // Wednesday = 3rd day of Mon-Sun week
    const label = getProgressLabel("weekly", new Date("2026-04-08"), 3, 7);
    expect(label).toBe("진행중 — 3/7일");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/circle.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Create circle.ts**

```typescript
// src/core/circle.ts
/**
 * circle — 순환 정화: air 실행 → 자동 완료 처리 → 변경 감지 → JSON 출력 / 저장
 */

import type { StorageAdapter, DailyReport } from "../storage/adapter.js";
import { runAir } from "./air.js";

export interface CircleResult {
  airResult: Awaited<ReturnType<typeof runAir>>;
  finalized: string[];     // finalized된 보고 목록
  needsSummary: string[];  // 요약 필요한 날짜 (변경 감지 기준)
}

/** 월~일 주 경계 계산 */
export function getWeekBoundary(date: Date): { monday: string; sunday: string } {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    monday: monday.toISOString().slice(0, 10),
    sunday: sunday.toISOString().slice(0, 10),
  };
}

/** 진행 중 라벨 생성 */
export function getProgressLabel(
  type: string, _date: Date, completed: number, total: number,
): string {
  return `진행중 — ${completed}/${total}일`;
}

/** 이전 일/주/월 보고를 finalized로 전환 */
export async function finalizePreviousReports(
  storage: StorageAdapter,
  today: Date,
): Promise<string[]> {
  const finalized: string[] = [];
  const todayStr = today.toISOString().slice(0, 10);

  // 어제 일일보고 finalize
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);
  const yReport = await storage.getDailyReport(yStr, "daily");
  if (yReport && yReport.status !== "finalized") {
    await storage.updateDailyReportStatus(yStr, "daily", "finalized");
    finalized.push(`일일: ${yStr}`);
  }

  // 월요일이면 직전 주 주간보고 finalize
  if (today.getDay() === 1) {
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - 1);
    const lastWeek = getWeekBoundary(lastSunday);
    const wReport = await storage.getDailyReport(lastWeek.monday, "weekly");
    if (wReport && wReport.status !== "finalized") {
      await storage.updateDailyReportStatus(lastWeek.monday, "weekly", "finalized");
      finalized.push(`주간: ${lastWeek.monday}~${lastWeek.sunday}`);
    }
  }

  // 1일이면 직전 월 월간보고 finalize
  if (today.getDate() === 1) {
    const lastMonth = new Date(today);
    lastMonth.setMonth(today.getMonth() - 1);
    const mStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`;
    const mReport = await storage.getDailyReport(mStr, "monthly");
    if (mReport && mReport.status !== "finalized") {
      await storage.updateDailyReportStatus(mStr, "monthly", "finalized");
      finalized.push(`월간: ${mStr}`);
    }
  }

  return finalized;
}

/** circle --json: 요약 필요한 데이터 출력 */
export async function circleJson(
  storage: StorageAdapter,
  options: { historyPath?: string } = {},
): Promise<{ dates: string[]; sessions: Record<string, unknown[]> }> {
  // air 먼저 실행
  const airResult = await runAir(storage, { historyPath: options.historyPath });

  // finalize
  await finalizePreviousReports(storage, new Date());

  // 변경된 날짜의 gather_reports에서 세션 데이터 추출
  const sessions: Record<string, unknown[]> = {};
  for (const date of airResult.changedDates) {
    const report = await storage.getGatherReportByDate(date);
    if (report) {
      try {
        sessions[date] = JSON.parse(report.reportJson || "[]");
      } catch {
        sessions[date] = [];
      }
    }
  }

  return { dates: airResult.changedDates, sessions };
}

/** circle --save: stdin JSON을 daily_reports에 저장 */
export async function circleSave(
  storage: StorageAdapter,
  input: {
    date: string;
    type?: "daily" | "weekly" | "monthly";
    overview?: string;
    sessions: Array<{
      sessionId: string;
      projectName?: string;
      topic?: string;
      outcome?: string;
      flow?: string;
      significance?: string;
      nextSteps?: string;
    }>;
  },
): Promise<void> {
  const type = input.type ?? "daily";

  // DB에서 해당 날짜 세션 통계 가져오기
  const dbSessions = await storage.getSessionsByDate(input.date);
  let totalMessages = 0;
  let totalTokens = 0;

  for (const summary of input.sessions) {
    const dbSession = dbSessions.find((s) => s.id === summary.sessionId);
    if (dbSession) {
      summary.projectName ??= dbSession.projectName;
      totalMessages += dbSession.messageCount;
      totalTokens += dbSession.totalTokens;
    }
  }

  const dateObj = new Date(input.date);
  const periodFrom = dateObj.getTime();
  const periodTo = periodFrom + 86400000;

  // 진행 상태 판단
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const isToday = input.date === todayStr;
  const status = isToday ? "in_progress" : "finalized";

  await storage.saveDailyReport({
    reportDate: input.date,
    reportType: type,
    periodFrom,
    periodTo,
    sessionCount: input.sessions.length,
    totalMessages,
    totalTokens,
    summaryJson: JSON.stringify(input.sessions),
    overview: input.overview ?? null,
    reportMarkdown: null,
    createdAt: Date.now(),
    emailedAt: null,
    emailTo: null,
    status,
    progressLabel: isToday ? getProgressLabel("daily", today, 1, 1) : null,
    dataHash: null,
  });
}

/** circle 메인 실행 (SKILL.md 외부에서 CLI로 직접 실행 시) */
export async function runCircle(
  storage: StorageAdapter,
  options: { historyPath?: string; json?: boolean; save?: boolean } = {},
): Promise<CircleResult> {
  const airResult = await runAir(storage, { historyPath: options.historyPath });
  const finalized = await finalizePreviousReports(storage, new Date());

  if (finalized.length > 0) {
    console.log(`  확정: ${finalized.join(", ")}`);
  }

  return {
    airResult,
    finalized,
    needsSummary: airResult.changedDates,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/circle.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/circle.ts tests/circle.test.ts
git commit -m "feat: circle command — finalization, change detection, JSON output/save"
```

---

### Task 4: CLI Restructure — Replace Commands

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/report/terminal.ts`

- [ ] **Step 1: Write new cli.ts**

Replace the entire `src/cli.ts` with the new command structure. Key changes:
- Remove: default action, `log`, `report`, `email`, `save-daily`
- Add: `air`, `circle` (with `--json` and `--save`)
- Keep: `config`, `schedule`

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { SqlJsAdapter } from "./storage/sqljs-adapter.js";
import { runAir } from "./core/air.js";
import { runCircle, circleJson, circleSave } from "./core/circle.js";
import {
  installSchedule,
  uninstallSchedule,
  getScheduleStatus,
} from "./scheduler/install.js";

const program = new Command();

program
  .name("sincenety")
  .description("Claude Code 작업 갈무리 도구 — air · circle · out")
  .version("0.3.0");

// ── air: 환기 — 기록 수집/저장 ──
program
  .command("air")
  .description("환기 — 기록 수집/저장 (날짜별 upsert, 자동 백필)")
  .option("--history <path>", "history.jsonl 경로")
  .option("--json", "날짜별 JSON 출력")
  .action(async (options) => {
    let historyPath: string | undefined;
    if (options.history) {
      historyPath = resolve(options.history);
      if (!existsSync(historyPath)) {
        console.error(`  ❌ history 파일을 찾을 수 없습니다: ${historyPath}`);
        process.exit(1);
      }
    }

    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      await showSetupReminder(storage);

      const result = await runAir(storage, { historyPath, json: options.json });

      if (options.json) {
        // 날짜별 gather_reports JSON 출력
        const output: Record<string, unknown> = {};
        for (const date of result.changedDates) {
          const report = await storage.getGatherReportByDate(date);
          if (report) {
            try { output[date] = JSON.parse(report.reportJson || "[]"); } catch { output[date] = []; }
          }
        }
        console.log(JSON.stringify({ dates: result.dates, changed: result.changedDates, sessions: output }));
      } else {
        console.log(`\n  ✅ air 완료 — ${result.dates.length}일, ${result.totalSessions}세션`);
        if (result.changedDates.length > 0) {
          console.log(`  갱신: ${result.changedDates.join(", ")}`);
        }
        if (result.backfillDays > 1) {
          console.log(`  백필: ${result.backfillDays}일`);
        }
        console.log("");
      }
    } catch (err) {
      console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// ── circle: 순환 정화 — LLM 요약 ──
program
  .command("circle")
  .description("순환 정화 — air 실행 후 요약 필요 데이터 출력/저장")
  .option("--json", "요약 필요 세션 데이터 JSON 출력 (SKILL.md 연동)")
  .option("--save", "stdin JSON을 daily_reports에 저장")
  .option("--type <type>", "보고 유형: daily | weekly | monthly", "daily")
  .option("--history <path>", "history.jsonl 경로")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();

      if (options.save) {
        // stdin에서 JSON 읽기
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        const input = Buffer.concat(chunks).toString("utf-8").trim();
        if (!input) {
          console.error("  ❌ 입력 데이터가 없습니다. stdin으로 JSON을 전달해 주세요.");
          process.exit(1);
        }
        let data: any;
        try {
          data = JSON.parse(input);
          if (!data.date || !Array.isArray(data.sessions)) {
            throw new Error("date와 sessions 필드가 필요합니다");
          }
        } catch (err) {
          console.error(`  ❌ JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        data.type = options.type;
        await circleSave(storage, data);
        const typeLabel = options.type === "daily" ? "일일" : options.type === "weekly" ? "주간" : "월간";
        console.log(`  ✅ ${typeLabel}보고 저장 완료: ${data.date} (${data.sessions.length}세션)`);
        return;
      }

      if (options.json) {
        const result = await circleJson(storage, { historyPath: options.history });
        console.log(JSON.stringify(result));
        return;
      }

      // 기본: air 실행 + finalize + 상태 출력
      const result = await runCircle(storage, { historyPath: options.history });
      console.log(`\n  ✅ circle 완료`);
      console.log(`  처리: ${result.airResult.dates.length}일, ${result.airResult.totalSessions}세션`);
      if (result.needsSummary.length > 0) {
        console.log(`  요약 필요: ${result.needsSummary.join(", ")}`);
      }
      if (result.finalized.length > 0) {
        console.log(`  확정: ${result.finalized.join(", ")}`);
      }
      console.log("");
    } catch (err) {
      console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// ── config: 설정 관리 ──
program
  .command("config")
  .description("설정 관리")
  .option("--setup", "대화형 이메일 설정 위저드")
  .option("--email <address>", "수신 이메일 주소 설정")
  .option("--smtp-host <host>", "SMTP 호스트 (기본: smtp.gmail.com)")
  .option("--smtp-port <port>", "SMTP 포트 (기본: 587)")
  .option("--smtp-user <user>", "SMTP 사용자 (발신 이메일)")
  .option("--smtp-pass [pass]", "SMTP 앱 비밀번호")
  .option("--resend-key <key>", "Resend API 키")
  .option("--provider <provider>", "발송 방식: gmail | resend | smtp")
  .option("--vacation <dates...>", "휴가 등록 (YYYY-MM-DD)")
  .option("--vacation-list", "등록된 휴가 조회")
  .option("--vacation-clear <date>", "휴가 삭제")
  .option("--vacation-type <type>", "휴가 유형: vacation | sick | holiday | half", "vacation")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      let changed = false;

      // 인자 없이 실행: 현재 상태 표시
      if (!options.setup && !options.email && !options.smtpHost && !options.smtpPort &&
          !options.smtpUser && options.smtpPass === undefined && !options.resendKey &&
          !options.provider && !options.vacation && !options.vacationList && !options.vacationClear) {
        await showConfigStatus(storage);
        return;
      }

      if (options.setup) {
        console.log("  setup 위저드는 Plan 3에서 구현됩니다. 개별 옵션을 사용해 주세요.");
        return;
      }

      if (options.email) {
        await storage.setConfig("email", options.email);
        console.log(`  email = ${options.email}`);
        changed = true;
      }
      if (options.smtpHost) {
        await storage.setConfig("smtp_host", options.smtpHost);
        console.log(`  smtp_host = ${options.smtpHost}`);
        changed = true;
      }
      if (options.smtpPort) {
        await storage.setConfig("smtp_port", options.smtpPort);
        console.log(`  smtp_port = ${options.smtpPort}`);
        changed = true;
      }
      if (options.smtpUser) {
        await storage.setConfig("smtp_user", options.smtpUser);
        console.log(`  smtp_user = ${options.smtpUser}`);
        changed = true;
      }
      if (options.smtpPass !== undefined) {
        const password = typeof options.smtpPass === "string"
          ? options.smtpPass
          : await promptPassword("  SMTP 앱 비밀번호: ");
        if (password) {
          await storage.setConfig("smtp_pass", password);
          console.log("  smtp_pass = ********");
          changed = true;
        }
      }
      if (options.resendKey) {
        await storage.setConfig("resend_key", options.resendKey);
        await storage.setConfig("provider", "resend");
        console.log(`  resend_key = ${options.resendKey.slice(0, 6)}...`);
        changed = true;
      }
      if (options.provider) {
        await storage.setConfig("provider", options.provider);
        console.log(`  provider = ${options.provider}`);
        changed = true;
      }

      // 휴가 관리
      if (options.vacation) {
        for (const date of options.vacation) {
          await storage.saveVacation({
            date,
            type: options.vacationType,
            source: "manual",
            label: null,
            createdAt: Date.now(),
          });
          console.log(`  휴가 등록: ${date} (${options.vacationType})`);
        }
        changed = true;
      }
      if (options.vacationList) {
        const now = new Date();
        const from = `${now.getFullYear()}-01-01`;
        const to = `${now.getFullYear()}-12-31`;
        const vacations = await storage.getVacationsByRange(from, to);
        if (vacations.length === 0) {
          console.log("  등록된 휴가가 없습니다.");
        } else {
          console.log(`  등록된 휴가 (${vacations.length}건):`);
          for (const v of vacations) {
            console.log(`    ${v.date} — ${v.type}${v.label ? ` (${v.label})` : ""} [${v.source}]`);
          }
        }
        return;
      }
      if (options.vacationClear) {
        await storage.deleteVacation(options.vacationClear);
        console.log(`  휴가 삭제: ${options.vacationClear}`);
        changed = true;
      }

      if (changed) console.log("  설정이 저장되었습니다.");
    } finally {
      await storage.close();
    }
  });

// ── schedule: 자동 스케줄 (향후 변경 예정) ──
program
  .command("schedule")
  .description("자동 갈무리 스케줄 관리")
  .option("--install", "스케줄 설치 (기본 18:00)")
  .option("--uninstall", "스케줄 해제")
  .option("--status", "스케줄 상태 확인")
  .option("--time <time>", "실행 시간 (예: 19:00)", "18:00")
  .action(async (options) => {
    try {
      if (options.uninstall) {
        await uninstallSchedule();
      } else if (options.status) {
        const status = await getScheduleStatus();
        console.log(`  스케줄 상태: ${status}`);
      } else if (options.install) {
        await installSchedule({ time: options.time });
      } else {
        console.log("  사용법:");
        console.log("    sincenety schedule --install");
        console.log("    sincenety schedule --uninstall");
        console.log("    sincenety schedule --status");
      }
    } catch (err) {
      console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ── 유틸 ──

async function showConfigStatus(storage: StorageAdapter): Promise<void> {
  const [email, smtpUser, smtpPass, smtpHost, smtpPort, provider, resendKey] = await Promise.all([
    storage.getConfig("email"),
    storage.getConfig("smtp_user"),
    storage.getConfig("smtp_pass"),
    storage.getConfig("smtp_host"),
    storage.getConfig("smtp_port"),
    storage.getConfig("provider"),
    storage.getConfig("resend_key"),
  ]);

  const now = new Date();
  const vacations = await storage.getVacationsByRange(`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`);

  console.log("\n  sincenety 설정 상태");
  console.log("  ┌──────────────┬──────────────────────┬────────────┐");
  console.log("  │ 항목         │ 값                   │ 상태       │");
  console.log("  ├──────────────┼──────────────────────┼────────────┤");
  console.log(`  │ provider     │ ${(provider ?? "gmail").padEnd(20)} │ ${provider ? "✅ 설정됨" : "✅ 기본값"}  │`);
  console.log(`  │ email        │ ${(email ?? "(미설정)").padEnd(20)} │ ${email ? "✅ 설정됨" : "❌ 필요  "}  │`);
  console.log(`  │ smtp_host    │ ${(smtpHost ?? "smtp.gmail.com").padEnd(20)} │ ${smtpHost ? "✅ 설정됨" : "✅ 기본값"}  │`);
  console.log(`  │ smtp_port    │ ${(smtpPort ?? "587").padEnd(20)} │ ${smtpPort ? "✅ 설정됨" : "✅ 기본값"}  │`);
  console.log(`  │ smtp_user    │ ${(smtpUser ?? "(미설정)").padEnd(20)} │ ${smtpUser ? "✅ 설정됨" : "❌ 필요  "}  │`);
  console.log(`  │ smtp_pass    │ ${smtpPass ? "********".padEnd(20) : "(미설정)".padEnd(20)} │ ${smtpPass ? "✅ 설정됨" : "❌ 필요  "}  │`);
  console.log(`  │ resend_key   │ ${resendKey ? (resendKey.slice(0, 6) + "...").padEnd(20) : "(미설정)".padEnd(20)} │ — 선택사항  │`);
  console.log(`  │ 휴가 등록    │ ${String(vacations.length + "건").padEnd(20)} │ ✅         │`);
  console.log("  └──────────────┴──────────────────────┴────────────┘");

  if (!email || !smtpPass) {
    console.log("\n  📋 설정: sincenety config --setup");
    console.log("  💡 Claude Code 안에서는 Gmail MCP로 자동 발송 가능");
    console.log("  ⏩ 이메일 없이 air, circle은 정상 동작합니다\n");
  } else {
    console.log("");
  }
}

async function showSetupReminder(storage: StorageAdapter): Promise<void> {
  const email = await storage.getConfig("email");
  const pass = await storage.getConfig("smtp_pass");
  const count = parseInt(await storage.getConfig("setup_shown_count") ?? "0", 10);

  if (email && pass) return; // 설정 완료
  if (count > 0 && count % 5 !== 0) {
    // 5회에 1번만 표시
    await storage.setConfig("setup_shown_count", String(count + 1));
    return;
  }

  console.log("  ┌──────────────────────────────────────────────────┐");
  console.log("  │ 📋 설정: sincenety config --setup                │");
  console.log("  │ 💡 Claude Code 안에서는 설정 없이 Gmail MCP 사용 │");
  console.log("  │ ⏩ 이메일 없이 계속 진행합니다...                │");
  console.log("  └──────────────────────────────────────────────────┘");

  await storage.setConfig("setup_shown_count", String(count + 1));
}

import type { StorageAdapter } from "./storage/adapter.js";

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      let password = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString("utf8");
        if (c === "\n" || c === "\r") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(password);
        } else if (c === "\u0003") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          rl.close();
          process.exit(0);
        } else if (c === "\u007f" || c === "\b") {
          if (password.length > 0) password = password.slice(0, -1);
        } else {
          password += c;
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
    }
  });
}

program.parse();
```

- [ ] **Step 2: Remove formatLogReport from terminal.ts**

In `src/report/terminal.ts`, find and remove the `formatLogReport` function export and its implementation. Keep `formatGatherReport`.

- [ ] **Step 3: Update package.json version**

Change `"version": "0.2.1"` to `"version": "0.3.0"`.

- [ ] **Step 4: Build and verify**

Run: `npm run build`
Expected: Compilation succeeds with no errors

- [ ] **Step 5: Smoke test**

Run:
```bash
node dist/cli.js air --help
node dist/cli.js circle --help
node dist/cli.js config
```
Expected: Help text and config status table shown correctly

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/report/terminal.ts package.json
git commit -m "feat: CLI restructure — air/circle commands, remove log/report/email/save-daily"
```

---

### Task 5: Update SKILL.md for New Commands

**Files:**
- Modify: `src/skill/SKILL.md`

- [ ] **Step 1: Update SKILL.md**

Replace the workflow section to use `circle --json` and `circle --save` instead of `--json` and `save-daily`. Update CLI paths to use `air`/`circle`/`out`.

Key changes:
- Step 1: `sincenety circle --json` (internally runs air)
- Step 3: `echo '...' | sincenety circle --save`
- Step 5: `sincenety out` (placeholder until Plan 2)

- [ ] **Step 2: Commit**

```bash
git add src/skill/SKILL.md
git commit -m "docs: update SKILL.md for air/circle/out pipeline"
```

---

### Task 6: Integration Test + Final Build

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass including new migration, air, circle tests

- [ ] **Step 2: Full build**

```bash
npm run build
```

Expected: Clean compilation

- [ ] **Step 3: End-to-end smoke test**

```bash
# air: 데이터 수집
node dist/cli.js air

# circle --json: 요약 필요 데이터 출력
node dist/cli.js circle --json | head -20

# circle --save: 테스트 저장
echo '{"date":"2026-04-08","overview":"테스트","sessions":[]}' | node dist/cli.js circle --save

# config: 상태 확인
node dist/cli.js config
```

Expected: All commands run without errors

- [ ] **Step 4: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: sincenety v0.3.0 — air/circle pipeline complete (Plan 1)"
```

---

## Plan Summary

| Task | Description | Est. Steps |
|------|-------------|------------|
| 1 | DB v4 schema migration | 10 |
| 2 | `air` core — date-grouped gather with backfill | 6 |
| 3 | `circle` core — finalization, change detection, JSON/save | 5 |
| 4 | CLI restructure — new commands | 6 |
| 5 | SKILL.md update | 2 |
| 6 | Integration test + final build | 4 |
| **Total** | | **33 steps** |

**Next:** Plan 2 (email provider + out commands) builds on this foundation.
