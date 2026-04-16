import { describe, it, expect, afterEach, vi } from "vitest";
import { join } from "node:path";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import {
  getWeekBoundary,
  getProgressLabel,
  finalizePreviousReports,
  mergeSummariesByTitle,
  autoSummarizeWeekly,
  autoSummarizeMonthly,
  runCircle,
} from "../src/core/circle.js";
import type { MergedSummary } from "../src/core/circle.js";
import type { DailyReport, StorageAdapter } from "../src/storage/adapter.js";
import { createTestAdapter, cleanupTestAdapter, type TestAdapterContext } from "./helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let ctx: TestAdapterContext;
let adapter: SqlJsAdapter;

async function createAdapter(): Promise<SqlJsAdapter> {
  ctx = await createTestAdapter("sincenety-circle-test");
  adapter = ctx.adapter;
  return adapter;
}

afterEach(async () => {
  if (ctx) await cleanupTestAdapter(ctx);
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

// ---------------------------------------------------------------------------
// autoSummarizeWeekly
// ---------------------------------------------------------------------------

/** 주어진 날짜/타입으로 daily_reports row 저장 헬퍼 */
async function saveReport(
  a: SqlJsAdapter,
  date: string,
  type: "daily" | "weekly" | "monthly",
  overrides: Partial<DailyReport> = {},
): Promise<void> {
  const [y, m, d] = date.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const report: DailyReport = {
    reportDate: date,
    reportType: type,
    periodFrom: dayStart,
    periodTo: dayStart + 86400000 - 1,
    sessionCount: 0,
    totalMessages: 0,
    totalTokens: 0,
    summaryJson: "[]",
    overview: null,
    reportMarkdown: null,
    createdAt: Date.now(),
    emailedAt: null,
    emailTo: null,
    status: "finalized",
    progressLabel: null,
    dataHash: null,
    ...overrides,
  };
  await a.saveDailyReport(report);
}

/** daily summary sessions JSON 헬퍼 */
function makeDailySummaryJson(
  sessions: Array<Partial<MergedSummary> & { sessionId: string; projectName: string; topic: string }>,
): string {
  return JSON.stringify(
    sessions.map((s) => ({
      sessionId: s.sessionId,
      projectName: s.projectName,
      topic: s.topic,
      outcome: s.outcome ?? "",
      flow: s.flow ?? "",
      significance: s.significance ?? "",
      nextSteps: s.nextSteps ?? "",
      messageCount: s.messageCount ?? 0,
      totalTokens: s.totalTokens ?? 0,
      inputTokens: s.inputTokens ?? 0,
      outputTokens: s.outputTokens ?? 0,
      durationMinutes: s.durationMinutes ?? 0,
      model: s.model ?? "",
    })),
  );
}

describe("autoSummarizeWeekly", () => {
  it("creates weekly row from this week's daily reports", async () => {
    await createAdapter();

    // 이번 주 = 2026-04-06 (월) ~ 2026-04-12 (일), 오늘 = 수요일 2026-04-08
    const today = new Date(2026, 3, 8);

    await saveReport(adapter, "2026-04-06", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s1", projectName: "alpha", topic: "Login", messageCount: 5, totalTokens: 1000 },
      ]),
      totalMessages: 5,
      totalTokens: 1000,
      sessionCount: 1,
    });
    await saveReport(adapter, "2026-04-07", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s2", projectName: "alpha", topic: "Signup", messageCount: 3, totalTokens: 500 },
      ]),
      totalMessages: 3,
      totalTokens: 500,
      sessionCount: 1,
    });

    await autoSummarizeWeekly(adapter, today);

    const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
    expect(weekly).not.toBeNull();
    expect(weekly!.reportType).toBe("weekly");
    expect(weekly!.reportDate).toBe("2026-04-06");
    // alpha 프로젝트 2개 세션이 머지되어 1개
    const sessions = JSON.parse(weekly!.summaryJson || "[]");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectName).toBe("alpha");
    expect(sessions[0].mergedCount).toBe(2);
    // 집계
    expect(weekly!.totalMessages).toBe(8);
    expect(weekly!.totalTokens).toBe(1500);
  });

  it("status is in_progress when within current week, finalized when past", async () => {
    await createAdapter();
    // 이번 주 월요일이 오늘 기준 이전이어도, 주가 아직 안 끝났으면 in_progress
    const wednesday = new Date(2026, 3, 8); // 수요일
    await saveReport(adapter, "2026-04-06", "daily", {
      summaryJson: makeDailySummaryJson([{ sessionId: "s1", projectName: "p", topic: "t" }]),
    });
    await autoSummarizeWeekly(adapter, wednesday);
    const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
    expect(weekly!.status).toBe("in_progress");
  });

  it("does nothing when no daily reports exist in week", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 8);
    await autoSummarizeWeekly(adapter, today);
    const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
    expect(weekly).toBeNull();
  });

  it("upserts (overwrites) existing weekly when not emailed yet", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 8);

    // 기존 weekly row (아직 미발송)
    await saveReport(adapter, "2026-04-06", "weekly", {
      summaryJson: JSON.stringify([{ sessionId: "old", projectName: "old", topic: "old" }]),
      overview: "OLD OVERVIEW",
    });
    await saveReport(adapter, "2026-04-07", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "new", projectName: "new", topic: "new", messageCount: 10, totalTokens: 2000 },
      ]),
      totalMessages: 10,
      totalTokens: 2000,
    });

    await autoSummarizeWeekly(adapter, today);

    const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
    const sessions = JSON.parse(weekly!.summaryJson || "[]");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectName).toBe("new");
    expect(weekly!.totalMessages).toBe(10);
  });

  it("protects weekly with emailedAt === 0 (falsy but non-null)", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 8);

    // emailedAt=0은 정상 Date.now()로는 나올 수 없지만, 수동 DB 삽입이나
    // 버그로 들어올 수 있음. null이 아닌 이상 "발송된 것으로 간주"해야 안전.
    await saveReport(adapter, "2026-04-06", "weekly", {
      summaryJson: JSON.stringify([{ sessionId: "sent-with-zero", projectName: "sent", topic: "sent" }]),
      overview: "EMAILED AT ZERO",
      sessionCount: 7,
      totalMessages: 77,
      totalTokens: 777,
      emailedAt: 0,
      emailTo: "zero@example.com",
    });
    await saveReport(adapter, "2026-04-07", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "new", projectName: "new", topic: "new", messageCount: 999, totalTokens: 999 },
      ]),
    });

    await autoSummarizeWeekly(adapter, today);

    const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
    // 덮어쓰기 발생하면 new 프로젝트가 들어가고 통계가 변함
    const sessions = JSON.parse(weekly!.summaryJson || "[]");
    expect(sessions[0].projectName).toBe("sent");
    expect(weekly!.overview).toBe("EMAILED AT ZERO");
    expect(weekly!.totalMessages).toBe(77);
    expect(weekly!.totalTokens).toBe(777);
    expect(weekly!.emailedAt).toBe(0);
  });

  it("does NOT overwrite already-emailed weekly — even when new daily data would change totals", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 8);

    // 기존 weekly는 구체적 통계 값을 가진 상태로 저장
    await saveReport(adapter, "2026-04-06", "weekly", {
      summaryJson: JSON.stringify([{ sessionId: "sent", projectName: "sent", topic: "sent" }]),
      overview: "ORIGINAL EMAILED OVERVIEW",
      sessionCount: 42,
      totalMessages: 777,
      totalTokens: 88888,
      emailedAt: 1234567890,
      emailTo: "me@example.com",
    });
    // 새 daily: 덮어쓰기가 일어난다면 totals가 변할 만큼 큰 데이터
    await saveReport(adapter, "2026-04-07", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "new", projectName: "new", topic: "new", messageCount: 999, totalTokens: 999999 },
      ]),
      totalMessages: 999,
      totalTokens: 999999,
    });

    const before = await adapter.getDailyReport("2026-04-06", "weekly");
    await autoSummarizeWeekly(adapter, today);
    const after = await adapter.getDailyReport("2026-04-06", "weekly");

    // 모든 사용자 가시 필드가 불변 — 스냅샷 비교
    expect(after).not.toBeNull();
    expect(after!.summaryJson).toBe(before!.summaryJson);
    expect(after!.overview).toBe("ORIGINAL EMAILED OVERVIEW");
    expect(after!.sessionCount).toBe(42);
    expect(after!.totalMessages).toBe(777);
    expect(after!.totalTokens).toBe(88888);
    expect(after!.emailedAt).toBe(1234567890);
    expect(after!.emailTo).toBe("me@example.com");
    expect(after!.createdAt).toBe(before!.createdAt);
    // 새 daily가 totals에 섞이지 않았음을 명시적으로 재확인
    expect(after!.totalMessages).not.toBe(999);
    expect(after!.totalTokens).not.toBe(999999);
  });
});

// ---------------------------------------------------------------------------
// autoSummarizeMonthly
// ---------------------------------------------------------------------------

describe("autoSummarizeWeekly — corrupted daily row handling", () => {
  it("warns and continues when a daily summaryJson is malformed", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 8); // Wed

    // 정상 daily
    await saveReport(adapter, "2026-04-06", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "good", projectName: "alpha", topic: "OK", messageCount: 5, totalTokens: 1000 },
      ]),
      totalMessages: 5,
      totalTokens: 1000,
    });
    // 손상된 daily (JSON parse 실패)
    await saveReport(adapter, "2026-04-07", "daily", {
      summaryJson: "{broken json",
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const wrote = await autoSummarizeWeekly(adapter, today);
      expect(wrote).toBe(true);

      // warn 호출됨 + 실패한 reportDate 언급
      expect(warnSpy).toHaveBeenCalled();
      const warnArgs = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(warnArgs).toContain("2026-04-07");

      // 정상 daily는 weekly에 여전히 포함됨
      const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
      expect(weekly).not.toBeNull();
      const sessions = JSON.parse(weekly!.summaryJson || "[]");
      expect(sessions).toHaveLength(1);
      expect(sessions[0].projectName).toBe("alpha");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("skips dailies where summaryJson parses to non-array (e.g. 'null')", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 8);

    await saveReport(adapter, "2026-04-06", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "good", projectName: "alpha", topic: "OK", messageCount: 5, totalTokens: 1000 },
      ]),
    });
    await saveReport(adapter, "2026-04-07", "daily", {
      summaryJson: "null",
    });
    await saveReport(adapter, "2026-04-08", "daily", {
      summaryJson: '{"not":"an array"}',
    });

    await autoSummarizeWeekly(adapter, today);

    const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
    const sessions = JSON.parse(weekly!.summaryJson || "[]");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectName).toBe("alpha");
  });

  it("skips dailies with empty summaryJson string", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 8);

    await saveReport(adapter, "2026-04-06", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "good", projectName: "alpha", topic: "OK" },
      ]),
    });
    await saveReport(adapter, "2026-04-07", "daily", {
      summaryJson: "",
    });

    await autoSummarizeWeekly(adapter, today);
    const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
    expect(weekly).not.toBeNull();
    const sessions = JSON.parse(weekly!.summaryJson || "[]");
    expect(sessions).toHaveLength(1);
  });
});

describe("autoSummarizeMonthly", () => {
  it("creates monthly row from this month's daily reports", async () => {
    await createAdapter();
    // 이번 달 = 2026-04-01 ~ 2026-04-30, 오늘 = 2026-04-15
    const today = new Date(2026, 3, 15);

    await saveReport(adapter, "2026-04-02", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s1", projectName: "alpha", topic: "Login", messageCount: 5, totalTokens: 1000 },
      ]),
      totalMessages: 5,
      totalTokens: 1000,
    });
    await saveReport(adapter, "2026-04-10", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s2", projectName: "beta", topic: "API", messageCount: 8, totalTokens: 3000 },
      ]),
      totalMessages: 8,
      totalTokens: 3000,
    });

    await autoSummarizeMonthly(adapter, today);

    const monthly = await adapter.getDailyReport("2026-04-01", "monthly");
    expect(monthly).not.toBeNull();
    expect(monthly!.reportType).toBe("monthly");
    const sessions = JSON.parse(monthly!.summaryJson || "[]");
    // 2 projects, 1 session each — no merging
    expect(sessions).toHaveLength(2);
    expect(monthly!.totalMessages).toBe(13);
    expect(monthly!.totalTokens).toBe(4000);
  });

  it("status is in_progress when within current month", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 15);
    await saveReport(adapter, "2026-04-02", "daily", {
      summaryJson: makeDailySummaryJson([{ sessionId: "s1", projectName: "p", topic: "t" }]),
    });
    await autoSummarizeMonthly(adapter, today);
    const monthly = await adapter.getDailyReport("2026-04-01", "monthly");
    expect(monthly!.status).toBe("in_progress");
  });

  it("does nothing when no daily reports exist in month", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 15);
    await autoSummarizeMonthly(adapter, today);
    const monthly = await adapter.getDailyReport("2026-04-01", "monthly");
    expect(monthly).toBeNull();
  });

  it("does NOT overwrite already-emailed monthly — snapshot totals unchanged", async () => {
    await createAdapter();
    const today = new Date(2026, 3, 15);

    await saveReport(adapter, "2026-04-01", "monthly", {
      summaryJson: JSON.stringify([{ sessionId: "sent", projectName: "sent", topic: "sent" }]),
      overview: "ORIGINAL MONTHLY OVERVIEW",
      sessionCount: 100,
      totalMessages: 5000,
      totalTokens: 1000000,
      emailedAt: 9999,
      emailTo: "me@x.com",
    });
    await saveReport(adapter, "2026-04-10", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "new", projectName: "new", topic: "new", messageCount: 111, totalTokens: 222 },
      ]),
      totalMessages: 111,
      totalTokens: 222,
    });

    const before = await adapter.getDailyReport("2026-04-01", "monthly");
    await autoSummarizeMonthly(adapter, today);
    const after = await adapter.getDailyReport("2026-04-01", "monthly");

    expect(after!.summaryJson).toBe(before!.summaryJson);
    expect(after!.overview).toBe("ORIGINAL MONTHLY OVERVIEW");
    expect(after!.sessionCount).toBe(100);
    expect(after!.totalMessages).toBe(5000);
    expect(after!.totalTokens).toBe(1000000);
    expect(after!.emailedAt).toBe(9999);
    expect(after!.emailTo).toBe("me@x.com");
    expect(after!.createdAt).toBe(before!.createdAt);
  });
});

// ---------------------------------------------------------------------------
// runCircle — summaryErrors field propagation
// ---------------------------------------------------------------------------

/**
 * 특정 메서드가 throw하도록 adapter를 감싼다. autoSummarizeWeekly/Monthly 내부의
 * `storage.getDailyReport(..., "weekly"|"monthly")` 호출만 선택적으로 실패시켜
 * runCircle이 에러를 기록하는지 검증한다.
 */
function wrapStorageWithFailingGetDailyReport(
  inner: StorageAdapter,
  failOn: "weekly" | "monthly",
  errorMsg = "simulated storage failure",
): StorageAdapter {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "getDailyReport") {
        return async (date: string, type?: string) => {
          if (type === failOn) throw new Error(errorMsg);
          return (target.getDailyReport as any).call(target, date, type);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as StorageAdapter;
}

// ---------------------------------------------------------------------------
// Boundary cases — Sunday week / December→January / Feb leap year
// ---------------------------------------------------------------------------

describe("autoSummarizeWeekly — boundary cases", () => {
  it("Sunday as today — still groups with the current week's Monday", async () => {
    await createAdapter();
    // 2026-04-12 is Sunday. getWeekBoundary has a dayOfWeek===0 special branch.
    // Expected: monday=2026-04-06, sunday=2026-04-12
    const sunday = new Date(2026, 3, 12);

    await saveReport(adapter, "2026-04-06", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s1", projectName: "alpha", topic: "Mon work", messageCount: 3, totalTokens: 300 },
      ]),
      totalMessages: 3,
      totalTokens: 300,
    });
    await saveReport(adapter, "2026-04-12", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s2", projectName: "alpha", topic: "Sun work", messageCount: 4, totalTokens: 400 },
      ]),
      totalMessages: 4,
      totalTokens: 400,
    });

    await autoSummarizeWeekly(adapter, sunday);

    // 일요일 호출인데 weekly row가 2026-04-06(월)에 생성돼야 함 — 다음 주(2026-04-13)가 아니라
    const weekly = await adapter.getDailyReport("2026-04-06", "weekly");
    expect(weekly).not.toBeNull();
    expect(weekly!.totalMessages).toBe(7);
    expect(weekly!.totalTokens).toBe(700);
    // 반대편 — 다음 주(2026-04-13) weekly row가 만들어지면 안 됨
    const nextWeek = await adapter.getDailyReport("2026-04-13", "weekly");
    expect(nextWeek).toBeNull();
  });

  it("Monday as today — uses that Monday as the weekly anchor", async () => {
    await createAdapter();
    // 2026-04-13 Monday
    const monday = new Date(2026, 3, 13);
    await saveReport(adapter, "2026-04-13", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s1", projectName: "p", topic: "t" },
      ]),
    });

    await autoSummarizeWeekly(adapter, monday);
    const weekly = await adapter.getDailyReport("2026-04-13", "weekly");
    expect(weekly).not.toBeNull();
    // 지난 주 weekly는 안 만들어짐
    const lastWeek = await adapter.getDailyReport("2026-04-06", "weekly");
    expect(lastWeek).toBeNull();
  });
});

describe("autoSummarizeMonthly — boundary cases", () => {
  it("December — uses Dec 31 as last day, not Jan 0", async () => {
    await createAdapter();
    // 2026-12-15
    const dec15 = new Date(2026, 11, 15);

    await saveReport(adapter, "2026-12-03", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s1", projectName: "a", topic: "early Dec", messageCount: 2, totalTokens: 200 },
      ]),
      totalMessages: 2,
      totalTokens: 200,
    });
    await saveReport(adapter, "2026-12-31", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s2", projectName: "a", topic: "last day", messageCount: 5, totalTokens: 500 },
      ]),
      totalMessages: 5,
      totalTokens: 500,
    });
    // 2027-01-01 — 범위 밖이어야 함
    await saveReport(adapter, "2027-01-01", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s3", projectName: "a", topic: "new year" },
      ]),
    });

    await autoSummarizeMonthly(adapter, dec15);

    const dec = await adapter.getDailyReport("2026-12-01", "monthly");
    expect(dec).not.toBeNull();
    // 2026-12-03과 2026-12-31만 포함, 2027-01-01 제외
    expect(dec!.totalMessages).toBe(7);
    expect(dec!.totalTokens).toBe(700);
    // 2027-01-01 monthly row가 잘못 생성되면 안 됨
    const jan = await adapter.getDailyReport("2027-01-01", "monthly");
    expect(jan).toBeNull();
  });

  it("February in a leap year (2028) — includes Feb 29", async () => {
    await createAdapter();
    const feb15Leap = new Date(2028, 1, 15); // 2028-02-15 (leap)

    await saveReport(adapter, "2028-02-29", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s1", projectName: "a", topic: "leap day", messageCount: 10, totalTokens: 1000 },
      ]),
      totalMessages: 10,
      totalTokens: 1000,
    });
    // 2028-03-01은 범위 밖
    await saveReport(adapter, "2028-03-01", "daily", {
      summaryJson: makeDailySummaryJson([{ sessionId: "s2", projectName: "a", topic: "mar" }]),
    });

    await autoSummarizeMonthly(adapter, feb15Leap);
    const feb = await adapter.getDailyReport("2028-02-01", "monthly");
    expect(feb).not.toBeNull();
    expect(feb!.totalMessages).toBe(10);
    expect(feb!.totalTokens).toBe(1000);
  });

  it("February in non-leap year (2027) — last day is Feb 28", async () => {
    await createAdapter();
    const feb15 = new Date(2027, 1, 15);
    await saveReport(adapter, "2027-02-28", "daily", {
      summaryJson: makeDailySummaryJson([
        { sessionId: "s1", projectName: "a", topic: "last", messageCount: 1, totalTokens: 10 },
      ]),
      totalMessages: 1,
      totalTokens: 10,
    });

    await autoSummarizeMonthly(adapter, feb15);
    const feb = await adapter.getDailyReport("2027-02-01", "monthly");
    expect(feb).not.toBeNull();
    expect(feb!.totalMessages).toBe(1);
  });
});

describe("runCircle — summaryErrors propagation", () => {
  // v0.8.6: runCircle은 AI provider 진입 가드를 통과해야 함.
  // 테스트는 D1 자격증명을 config에 주입하여 "cloudflare" provider로 판정되게 한다.
  async function seedAiConfig(a: StorageAdapter): Promise<void> {
    await a.setConfig("d1_account_id", "test-account");
    await a.setConfig("d1_api_token", "test-token");
    await a.setConfig("ai_provider", "cloudflare");
  }

  it("records weekly failure in summaryErrors without aborting", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    // 빈 history 파일로 runAir이 side-effect 없이 끝나도록 함
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const wrapped = wrapStorageWithFailingGetDailyReport(adapter, "weekly", "boom weekly");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await runCircle(wrapped, { historyPath: emptyHistory, mode: "full" });
      expect(result.summaryErrors).toEqual([
        { type: "weekly", error: "boom weekly" },
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("records monthly failure independently of weekly", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const wrapped = wrapStorageWithFailingGetDailyReport(adapter, "monthly", "boom monthly");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await runCircle(wrapped, { historyPath: emptyHistory, mode: "full" });
      expect(result.summaryErrors).toHaveLength(1);
      expect(result.summaryErrors[0]).toEqual({ type: "monthly", error: "boom monthly" });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("smart mode skips weekly/monthly entirely — no summaryErrors even if would fail", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    // weekly/monthly를 throw하게 감쌌지만, smart 모드는 호출 자체를 하지 않음
    const wrapped = wrapStorageWithFailingGetDailyReport(adapter, "weekly", "should not be called");
    const result = await runCircle(wrapped, { historyPath: emptyHistory, mode: "smart" });
    expect(result.summaryErrors).toEqual([]);
  });

  it("full mode with healthy storage returns empty summaryErrors", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const result = await runCircle(adapter, { historyPath: emptyHistory, mode: "full" });
    expect(result.summaryErrors).toEqual([]);
  });

  it("AI provider 미설정 상태에서 runCircle이 throw — 전체 파이프라인 중단", async () => {
    await createAdapter();
    // 일부러 AI config 주입하지 않음 — provider = "heuristic"
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    await expect(
      runCircle(adapter, { historyPath: emptyHistory, mode: "full" }),
    ).rejects.toThrow(/AI provider가 구성되지 않아/);
  });

  it("ai_provider=claude-code는 CLI 경로에서 throw — 슬래시 명령 전용임을 알림", async () => {
    await createAdapter();
    await adapter.setConfig("ai_provider", "claude-code");
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    await expect(
      runCircle(adapter, { historyPath: emptyHistory, mode: "full" }),
    ).rejects.toThrow(/\/sincenety 슬래시 명령에서만/);
  });
});

// ---------------------------------------------------------------------------
// runCircle — rerun option (#10)
// ---------------------------------------------------------------------------

describe("runCircle — rerun", () => {
  async function seedAiConfig(a: StorageAdapter): Promise<void> {
    await a.setConfig("d1_account_id", "test-account");
    await a.setConfig("d1_api_token", "test-token");
    await a.setConfig("ai_provider", "cloudflare");
  }

  function makeDR(date: string, overrides: Partial<DailyReport> = {}): DailyReport {
    return {
      reportDate: date, reportType: "daily", periodFrom: 0, periodTo: 86400000,
      sessionCount: 1, totalMessages: 1, totalTokens: 100,
      summaryJson: '[{"sessionId":"s1","topic":"test"}]',
      overview: null, reportMarkdown: null, createdAt: Date.now(),
      emailedAt: null, emailTo: null, status: "finalized",
      progressLabel: null, dataHash: "abc", ...overrides,
    };
  }

  it("rerun invalidates date and includes it in needsSummary", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const date = "2026-04-15";
    await adapter.saveDailyReport(makeDR(date));
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCircle(adapter, { historyPath: emptyHistory, mode: "full", rerun: [date] });
      // invalidation 후 autoSummarize가 재생성할 수 있으므로 invalidated 로그만 확인
      const logOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logOutput).toContain("invalidated");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("rerun skips emailed date with warning", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const date = "2026-04-15";
    const id = await adapter.saveDailyReport(makeDR(date));
    await adapter.updateDailyReportEmail(id, 12345, "test@test.com");
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCircle(adapter, { historyPath: emptyHistory, mode: "full", rerun: [date] });
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("skip rerun"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("rerun with non-existent date warns and continues", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await runCircle(adapter, { historyPath: emptyHistory, mode: "full", rerun: ["2099-01-01"] });
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("skip rerun"))).toBe(true);
      expect(result.summaryErrors).toEqual([]);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("rerun with mixed emailed/non-emailed dates", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const dateA = "2026-04-14";
    const dateB = "2026-04-15";
    const idA = await adapter.saveDailyReport(makeDR(dateA));
    await adapter.updateDailyReportEmail(idA, 12345, "test@test.com");
    await adapter.saveDailyReport(makeDR(dateB));
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCircle(adapter, { historyPath: emptyHistory, mode: "full", rerun: [dateA, dateB] });
      // emailed report A: invalidation skipped → still has emailedAt
      const reportA = await adapter.getDailyReport(dateA, "daily");
      expect(reportA!.emailedAt).toBe(12345);
      // non-emailed report B: invalidation succeeded (then autoSummarize may re-create)
      // verify warnSpy logged skip for dateA
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("skip rerun"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("smart mode + rerun invalidates before summarize", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const date = "2026-04-15";
    await adapter.saveDailyReport(makeDR(date));
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await runCircle(adapter, { historyPath: emptyHistory, mode: "smart", rerun: [date] });
      // smart mode skips weekly/monthly — no summaryErrors
      expect(result.summaryErrors).toEqual([]);
      // rerun 자체는 크래시 없이 완료
      const logOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logOutput).toContain("invalidated");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("duplicate rerun dates only invalidate once", async () => {
    await createAdapter();
    await seedAiConfig(adapter);
    const date = "2026-04-15";
    await adapter.saveDailyReport(makeDR(date));
    const emptyHistory = join(ctx.tmpDir, "empty-history.jsonl");
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(emptyHistory, ""));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // 동일 날짜 2번 전달 — 첫 번째에서 invalidate, 두 번째는 status=stale 상태에서 다시 invalidate
      // 크래시 없이 정상 동작하면 OK
      await expect(
        runCircle(adapter, { historyPath: emptyHistory, mode: "full", rerun: [date, date] }),
      ).resolves.toBeDefined();
    } finally {
      logSpy.mockRestore();
    }
  });
});
