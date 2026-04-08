import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import {
  getWeekBoundary,
  getProgressLabel,
  finalizePreviousReports,
} from "../src/core/circle.js";
import type { DailyReport } from "../src/storage/adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let adapter: SqlJsAdapter;

async function createAdapter(): Promise<SqlJsAdapter> {
  tmpDir = mkdtempSync(join(tmpdir(), "sincenety-circle-test-"));
  adapter = new SqlJsAdapter({ dbPath: join(tmpDir, "test.db") });
  await adapter.initialize();
  return adapter;
}

afterEach(async () => {
  if (adapter) {
    await adapter.close();
  }
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getWeekBoundary", () => {
  it("Wednesday 2026-04-08 → monday=2026-04-06, sunday=2026-04-12", () => {
    const date = new Date(2026, 3, 8); // April 8, 2026 = Wednesday
    const { monday, sunday } = getWeekBoundary(date);
    expect(monday).toBe("2026-04-06");
    expect(sunday).toBe("2026-04-12");
  });

  it("Monday → same day as monday", () => {
    const date = new Date(2026, 3, 6); // April 6, 2026 = Monday
    const { monday, sunday } = getWeekBoundary(date);
    expect(monday).toBe("2026-04-06");
    expect(sunday).toBe("2026-04-12");
  });

  it("Sunday → previous monday to that sunday", () => {
    const date = new Date(2026, 3, 12); // April 12, 2026 = Sunday
    const { monday, sunday } = getWeekBoundary(date);
    expect(monday).toBe("2026-04-06");
    expect(sunday).toBe("2026-04-12");
  });
});

describe("getProgressLabel", () => {
  it("returns correct format", () => {
    const label = getProgressLabel("daily", new Date(), 3, 7);
    expect(label).toBe("진행중 — 3/7일");
  });

  it("handles zero values", () => {
    const label = getProgressLabel("weekly", new Date(), 0, 5);
    expect(label).toBe("진행중 — 0/5일");
  });
});

describe("finalizePreviousReports", () => {
  it("finalizes yesterday's daily report from in_progress", async () => {
    await createAdapter();

    // 어제 날짜로 in_progress daily report 생성
    const yesterday = new Date(2026, 3, 7); // April 7
    const today = new Date(2026, 3, 8);     // April 8

    const yesterdayStr = "2026-04-07";
    const dayStart = yesterday.getTime();

    const report: DailyReport = {
      reportDate: yesterdayStr,
      reportType: "daily",
      periodFrom: dayStart,
      periodTo: dayStart + 86400000 - 1,
      sessionCount: 2,
      totalMessages: 10,
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
    };

    await adapter.saveDailyReport(report);

    // finalize 실행
    const finalized = await finalizePreviousReports(adapter, today);

    expect(finalized).toContain(`daily:${yesterdayStr}`);

    // DB에서 확인
    const updated = await adapter.getDailyReport(yesterdayStr, "daily");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("finalized");
  });

  it("does not re-finalize already finalized report", async () => {
    await createAdapter();

    const yesterdayStr = "2026-04-07";
    const dayStart = new Date(2026, 3, 7).getTime();
    const today = new Date(2026, 3, 8);

    const report: DailyReport = {
      reportDate: yesterdayStr,
      reportType: "daily",
      periodFrom: dayStart,
      periodTo: dayStart + 86400000 - 1,
      sessionCount: 1,
      totalMessages: 5,
      totalTokens: 2000,
      summaryJson: "[]",
      overview: null,
      reportMarkdown: null,
      createdAt: Date.now(),
      emailedAt: null,
      emailTo: null,
      status: "finalized",
      progressLabel: null,
      dataHash: null,
    };

    await adapter.saveDailyReport(report);

    const finalized = await finalizePreviousReports(adapter, today);
    expect(finalized).toHaveLength(0);
  });

  it("returns empty when no yesterday report exists", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 8);
    const finalized = await finalizePreviousReports(adapter, today);
    expect(finalized).toHaveLength(0);
  });

  it("finalizes weekly on Monday", async () => {
    await createAdapter();

    // 2026-04-13 is Monday
    const today = new Date(2026, 3, 13);
    // Previous week: Monday 2026-04-06
    const weekKey = "2026-04-06";
    const dayStart = new Date(2026, 3, 6).getTime();

    const report: DailyReport = {
      reportDate: weekKey,
      reportType: "weekly",
      periodFrom: dayStart,
      periodTo: dayStart + 7 * 86400000 - 1,
      sessionCount: 10,
      totalMessages: 50,
      totalTokens: 20000,
      summaryJson: "[]",
      overview: null,
      reportMarkdown: null,
      createdAt: Date.now(),
      emailedAt: null,
      emailTo: null,
      status: "in_progress",
      progressLabel: null,
      dataHash: null,
    };

    await adapter.saveDailyReport(report);

    const finalized = await finalizePreviousReports(adapter, today);
    expect(finalized).toContain(`weekly:${weekKey}`);
  });

  it("finalizes monthly on 1st", async () => {
    await createAdapter();

    // 2026-05-01
    const today = new Date(2026, 4, 1);
    const monthKey = "2026-04-01";
    const dayStart = new Date(2026, 3, 1).getTime();

    const report: DailyReport = {
      reportDate: monthKey,
      reportType: "monthly",
      periodFrom: dayStart,
      periodTo: dayStart + 30 * 86400000 - 1,
      sessionCount: 30,
      totalMessages: 200,
      totalTokens: 100000,
      summaryJson: "[]",
      overview: null,
      reportMarkdown: null,
      createdAt: Date.now(),
      emailedAt: null,
      emailTo: null,
      status: "in_progress",
      progressLabel: null,
      dataHash: null,
    };

    await adapter.saveDailyReport(report);

    const finalized = await finalizePreviousReports(adapter, today);
    expect(finalized).toContain(`monthly:${monthKey}`);
  });
});
