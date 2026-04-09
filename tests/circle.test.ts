import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import {
  getWeekBoundary,
  getProgressLabel,
  finalizePreviousReports,
  mergeSummariesByTitle,
} from "../src/core/circle.js";
import type { MergedSummary } from "../src/core/circle.js";
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
    expect(label).toBe("in progress — 3/7 days");
  });

  it("handles zero values", () => {
    const label = getProgressLabel("weekly", new Date(), 0, 5);
    expect(label).toBe("in progress — 0/5 days");
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

// ---------------------------------------------------------------------------
// mergeSummariesByTitle
// ---------------------------------------------------------------------------

function makeSummary(overrides: Partial<MergedSummary> = {}): MergedSummary {
  return {
    sessionId: "sess-001",
    projectName: "myproject",
    topic: "Add login feature",
    outcome: "Implemented login",
    flow: "Design → Code",
    significance: "Core auth",
    nextSteps: "Add tests",
    messageCount: 10,
    totalTokens: 5000,
    inputTokens: 2000,
    outputTokens: 3000,
    durationMinutes: 30,
    model: "claude-sonnet",
    ...overrides,
  };
}

describe("mergeSummariesByTitle", () => {
  it("merges sessions with same projectName even if topics differ", () => {
    const sessions: MergedSummary[] = [
      makeSummary({ sessionId: "s1", topic: "Login feature" }),
      makeSummary({ sessionId: "s2", topic: "Payment module" }),
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toContain("(×2)");
  });

  it("merges sessions with same projectName and topic", () => {
    const sessions: MergedSummary[] = [
      makeSummary({
        sessionId: "s1",
        topic: "Refactor DB layer",
        outcome: "Extracted adapter",
        flow: "Analyze",
        significance: "Short",
        nextSteps: "Step A",
        messageCount: 10,
        totalTokens: 5000,
        inputTokens: 2000,
        outputTokens: 3000,
        durationMinutes: 20,
      }),
      makeSummary({
        sessionId: "s2",
        topic: "Refactor DB layer",
        outcome: "Added tests",
        flow: "Test",
        significance: "Much longer significance text",
        nextSteps: "Step B",
        messageCount: 8,
        totalTokens: 4000,
        inputTokens: 1500,
        outputTokens: 2500,
        durationMinutes: 15,
      }),
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);
    const m = result[0];
    expect(m.sessionId).toBe("s1");
    expect(m.topic).toBe("Refactor DB layer (×2)");
    expect(m.outcome).toContain("Extracted adapter");
    expect(m.outcome).toContain("Added tests");
    expect(m.flow).toBe("Analyze → Test");
    expect(m.significance).toBe("Much longer significance text");
    expect(m.nextSteps).toBe("Step B");
    expect(m.messageCount).toBe(18);
    expect(m.totalTokens).toBe(9000);
    expect(m.inputTokens).toBe(3500);
    expect(m.outputTokens).toBe(5500);
    expect(m.durationMinutes).toBe(35);
  });

  it("normalizes topic for grouping (slash commands, trailing project name, case)", () => {
    const sessions: MergedSummary[] = [
      makeSummary({
        sessionId: "s1",
        projectName: "sincenety",
        topic: "/sincenety Fix bug",
        messageCount: 5,
        totalTokens: 1000,
        inputTokens: 400,
        outputTokens: 600,
        durationMinutes: 10,
      }),
      makeSummary({
        sessionId: "s2",
        projectName: "sincenety",
        topic: "FIX BUG sincenety",
        messageCount: 3,
        totalTokens: 800,
        inputTokens: 300,
        outputTokens: 500,
        durationMinutes: 5,
      }),
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toContain("(×2)");
  });

  it("keeps separate groups for different projects (same topic, different projectName)", () => {
    const sessions: MergedSummary[] = [
      makeSummary({ sessionId: "s1", projectName: "alpha", topic: "Fix bug" }),
      makeSummary({ sessionId: "s2", projectName: "beta", topic: "Fix bug" }),
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(2);
  });

  it("single session — no (×N) added", () => {
    const sessions: MergedSummary[] = [
      makeSummary({ sessionId: "s1", topic: "Solo task" }),
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("Solo task");
    expect(result[0].topic).not.toContain("×");
  });

  it("empty array returns empty", () => {
    const result = mergeSummariesByTitle([]);
    expect(result).toHaveLength(0);
  });

  it("merges 3+ sessions — (×3), flow joins all three", () => {
    const sessions: MergedSummary[] = [
      makeSummary({
        sessionId: "s1",
        topic: "Deploy pipeline",
        flow: "Plan",
        messageCount: 5,
        totalTokens: 1000,
        inputTokens: 400,
        outputTokens: 600,
        durationMinutes: 10,
      }),
      makeSummary({
        sessionId: "s2",
        topic: "Deploy pipeline",
        flow: "Build",
        messageCount: 7,
        totalTokens: 2000,
        inputTokens: 800,
        outputTokens: 1200,
        durationMinutes: 20,
      }),
      makeSummary({
        sessionId: "s3",
        topic: "Deploy pipeline",
        flow: "Ship",
        messageCount: 3,
        totalTokens: 500,
        inputTokens: 200,
        outputTokens: 300,
        durationMinutes: 5,
      }),
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);
    const m = result[0];
    expect(m.topic).toBe("Deploy pipeline (×3)");
    expect(m.flow).toBe("Plan → Build → Ship");
    expect(m.mergedCount).toBe(3);
    expect(m.messageCount).toBe(15);
    expect(m.totalTokens).toBe(3500);
    expect(m.inputTokens).toBe(1400);
    expect(m.outputTokens).toBe(2100);
    expect(m.durationMinutes).toBe(35);
  });
});
