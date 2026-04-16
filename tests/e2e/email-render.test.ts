import { describe, it, expect, afterEach } from "vitest";
import { SqlJsAdapter } from "../../src/storage/sqljs-adapter.js";
import { renderDailyEmail } from "../../src/email/renderer.js";
import type { SessionRecord, GatherReport, DailyReport } from "../../src/storage/adapter.js";
import { createTestAdapter, cleanupTestAdapter, type TestAdapterContext } from "../helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let ctx: TestAdapterContext;
let adapter: SqlJsAdapter;

async function createAdapter(): Promise<SqlJsAdapter> {
  ctx = await createTestAdapter("sincenety-email-render-test");
  adapter = ctx.adapter;
  return adapter;
}

afterEach(async () => {
  if (ctx) await cleanupTestAdapter(ctx);
});

// ---------------------------------------------------------------------------
// 테스트 데이터 — 3개 프로젝트, 3개 세션
// ---------------------------------------------------------------------------

const DATE_STR = "2026-04-16";
const BASE_TS = new Date(2026, 3, 16, 9, 0, 0).getTime();

function makeSession(idx: number, project: string, projectName: string): SessionRecord {
  return {
    id: `session-${idx}-${Date.now()}`,
    project: `/home/user/projects/${project}`,
    projectName,
    startedAt: BASE_TS + idx * 3600_000,
    endedAt: BASE_TS + idx * 3600_000 + 2400_000,
    durationMinutes: 40,
    messageCount: 10 + idx * 5,
    userMessageCount: 5 + idx * 2,
    assistantMessageCount: 5 + idx * 3,
    toolCallCount: 3,
    inputTokens: 5000 + idx * 1000,
    outputTokens: 2000 + idx * 500,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 7000 + idx * 1500,
    title: `${projectName} 기능 개발 #${idx}`,
    summary: `${projectName} 관련 작업 요약`,
    description: `${projectName}에서 새로운 기능을 구현하고 테스트를 작성했습니다.`,
    category: "feature",
    tags: "dev,test",
    model: "claude-sonnet-4-20250514",
    createdAt: Date.now(),
  };
}

const TEST_SESSIONS = [
  makeSession(0, "alpha-api", "alpha-api"),
  makeSession(1, "beta-dashboard", "beta-dashboard"),
  makeSession(2, "gamma-cli", "gamma-cli"),
];

function makeGatherReport(sessions: SessionRecord[]): GatherReport {
  const totalMsg = sessions.reduce((s, r) => s + r.messageCount, 0);
  const totalIn = sessions.reduce((s, r) => s + r.inputTokens, 0);
  const totalOut = sessions.reduce((s, r) => s + r.outputTokens, 0);
  return {
    gatheredAt: Date.now(),
    fromTimestamp: sessions[0].startedAt,
    toTimestamp: sessions[sessions.length - 1].endedAt,
    sessionCount: sessions.length,
    totalMessages: totalMsg,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    reportMarkdown: `# Daily Report ${DATE_STR}\n\n${sessions.map((s) => `- ${s.projectName}: ${s.title}`).join("\n")}`,
    reportJson: JSON.stringify(
      sessions.map((s) => ({
        sessionId: s.id,
        projectName: s.projectName,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMinutes: s.durationMinutes,
        messageCount: s.messageCount,
        userMessageCount: s.userMessageCount,
        assistantMessageCount: s.assistantMessageCount,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        totalTokens: s.totalTokens,
        title: s.title,
        summary: s.summary,
        description: s.description,
        model: s.model,
        category: s.category,
        actions: [],
      })),
    ),
    emailedAt: null,
    emailTo: null,
    reportDate: DATE_STR,
    dataHash: null,
    updatedAt: null,
  };
}

function makeDailyReport(sessions: SessionRecord[]): DailyReport {
  return {
    reportDate: DATE_STR,
    reportType: "daily",
    periodFrom: sessions[0].startedAt,
    periodTo: sessions[sessions.length - 1].endedAt,
    sessionCount: sessions.length,
    totalMessages: sessions.reduce((s, r) => s + r.messageCount, 0),
    totalTokens: sessions.reduce((s, r) => s + r.totalTokens, 0),
    summaryJson: JSON.stringify(
      sessions.map((s) => ({
        sessionId: s.id,
        projectName: s.projectName,
        topic: `${s.projectName} 핵심 작업`,
        outcome: `${s.projectName}에서 주요 기능을 완성했습니다.`,
        flow: `요구사항 분석 → 구현 → 테스트 → 완료`,
        significance: `${s.projectName} 프로젝트 진행률 향상`,
        nextSteps: `통합 테스트 및 배포`,
      })),
    ),
    overview: "오늘은 3개 프로젝트에서 핵심 기능을 개발하고 테스트를 완료했습니다.",
    reportMarkdown: `# AI Summary ${DATE_STR}`,
    createdAt: Date.now(),
    emailedAt: null,
    emailTo: null,
    status: "finalized",
    progressLabel: null,
    dataHash: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("email-render e2e", () => {
  it("renderDailyEmail로 subject/html/recipient가 올바르게 생성된다", async () => {
    const storage = await createAdapter();

    // 1. 세션 저장
    await storage.upsertSessions(TEST_SESSIONS);

    // 2. 갈무리 저장
    const gatherReport = makeGatherReport(TEST_SESSIONS);
    await storage.saveGatherReport(gatherReport);

    // 3. AI 요약 저장
    const dailyReport = makeDailyReport(TEST_SESSIONS);
    await storage.saveDailyReport(dailyReport);

    // 4. 이메일 수신자 설정
    await storage.setConfig("email", "test-recipient@example.com");

    // 5. 렌더링
    const result = await renderDailyEmail(storage, DATE_STR, "daily");

    // 6. 검증
    expect(result).not.toBeNull();
    expect(result!.recipient).toBe("test-recipient@example.com");
    expect(result!.reportType).toBe("daily");
    expect(result!.reportDate).toBe(DATE_STR);

    // subject에 세션 수 포함
    expect(result!.subject).toContain("3 sessions");
    expect(result!.subject).toContain("[sincenety]");
    expect(result!.subject).toContain(DATE_STR);

    // html에 각 프로젝트명 포함
    expect(result!.html).toContain("alpha-api");
    expect(result!.html).toContain("beta-dashboard");
    expect(result!.html).toContain("gamma-cli");

    // html에 sincenety 푸터 포함
    expect(result!.html).toContain("sincenety");
    expect(result!.html.toLowerCase()).toContain("work session");
  });

  it("email 미설정 시 null 반환", async () => {
    const storage = await createAdapter();
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).toBeNull();
  });

  it("데이터 없는 날짜에 null 반환", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");

    const result = await renderDailyEmail(storage, "2099-01-01", "daily");
    expect(result).toBeNull();
  });

  it("AI 요약 없이 gather 데이터만으로도 렌더링 가능", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).not.toBeNull();
    expect(result!.html).toContain("alpha-api");
    expect(result!.subject).toContain("3 sessions");
  });

  it("weekly reportType도 올바르게 렌더링된다", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");

    // weekly용 dailyReport 저장
    const weeklyReport: DailyReport = {
      ...makeDailyReport(TEST_SESSIONS),
      reportType: "weekly",
      reportDate: "2026-04-13", // 주간 시작일
    };
    await storage.saveDailyReport(weeklyReport);

    const result = await renderDailyEmail(storage, "2026-04-13", "weekly");
    expect(result).not.toBeNull();
    expect(result!.reportType).toBe("weekly");
    expect(result!.subject).toContain("Weekly Report");
  });

  it("html에 overview가 포함된다", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));
    await storage.saveDailyReport(makeDailyReport(TEST_SESSIONS));

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).not.toBeNull();
    // overview 텍스트가 html에 포함되어야 함
    expect(result!.html).toContain("3개 프로젝트");
  });

  it("subject에 토큰 수(Ktok)가 포함된다", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));
    await storage.saveDailyReport(makeDailyReport(TEST_SESSIONS));

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).not.toBeNull();
    expect(result!.subject).toMatch(/\d+Ktok/);
  });

  // ----- #5 AI provider badge -----

  it("AI provider 배지가 cloudflare 설정 시 렌더링", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");
    await storage.setConfig("d1_account_id", "acc");
    await storage.setConfig("d1_api_token", "tok");
    await storage.setConfig("ai_provider", "cloudflare");
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));
    await storage.saveDailyReport(makeDailyReport(TEST_SESSIONS));

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).not.toBeNull();
    expect(result!.html).toContain("AI: cloudflare");
  });

  it("AI provider 미설정 시 AI 배지 미출력 (heuristic은 표시하지 않음)", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));
    await storage.saveDailyReport(makeDailyReport(TEST_SESSIONS));

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("AI:");
  });

  // ----- #12 project weight compaction -----

  it("low weight 프로젝트는 Flow/nextSteps 미포함 (축약)", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");
    await storage.setConfig("project_weights", '{"alpha-api":"low"}');
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));
    await storage.saveDailyReport(makeDailyReport(TEST_SESSIONS));

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).not.toBeNull();
    // alpha-api는 여전히 프로젝트명으로 렌더링되지만 Flow 섹션 없음
    expect(result!.html).toContain("alpha-api");
  });

  it("high weight 프로젝트는 전체 상세 유지", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");
    await storage.setConfig("project_weights", '{"beta-dashboard":"high"}');
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));
    await storage.saveDailyReport(makeDailyReport(TEST_SESSIONS));

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).not.toBeNull();
    expect(result!.html).toContain("beta-dashboard");
  });

  it("resolveAiProvider가 throw하면 aiProvider=null → AI 배지 미출력", async () => {
    const storage = await createAdapter();
    await storage.setConfig("email", "test@example.com");
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));
    await storage.saveDailyReport(makeDailyReport(TEST_SESSIONS));

    // getConfig이 throw하도록 원본 메서드 래핑
    const origGetConfig = storage.getConfig.bind(storage);
    storage.getConfig = async (key: string) => {
      if (key === "ai_provider") throw new Error("DB corrupted");
      return origGetConfig(key);
    };

    const result = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(result).not.toBeNull();
    // .catch(() => null)로 aiProvider=null → "AI:" 배지 없어야 함
    expect(result!.html).not.toContain("AI:");
  });
});
