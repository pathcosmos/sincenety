import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTransport } from "nodemailer";
import nodemailer from "nodemailer";
import { SqlJsAdapter } from "../../src/storage/sqljs-adapter.js";
import { renderDailyEmail } from "../../src/email/renderer.js";
import type { SessionRecord, GatherReport, DailyReport } from "../../src/storage/adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let adapter: SqlJsAdapter;

async function createAdapter(): Promise<SqlJsAdapter> {
  tmpDir = mkdtempSync(join(tmpdir(), "sincenety-email-ethereal-test-"));
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
// 테스트 데이터
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
    title: `${projectName} feature dev #${idx}`,
    summary: `${projectName} work summary`,
    description: `Implemented new features and wrote tests for ${projectName}.`,
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
        actions: [
          { time: "09:00", input: "feat: add endpoint", result: "created /api/v1/data", significance: "core API" },
          { time: "09:20", input: "test: add unit tests", result: "12 tests passing", significance: "coverage" },
        ],
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
        topic: `${s.projectName} core implementation`,
        outcome: `Completed key features for ${s.projectName}.`,
        flow: `Analysis → Implementation → Testing → Done`,
        significance: `Progress on ${s.projectName} project`,
        nextSteps: `Integration tests and deployment`,
      })),
    ),
    overview: "Today we worked on 3 projects, completing core features and writing comprehensive tests.",
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
// Ethereal SMTP 실제 발송 테스트 — ETHEREAL_TEST=1 로 활성화
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.ETHEREAL_TEST)("email-ethereal e2e", () => {
  it("Ethereal SMTP로 이메일 발송 후 HTML 내용을 검증한다", async () => {
    const storage = await createAdapter();

    // DB 데이터 준비
    await storage.upsertSessions(TEST_SESSIONS);
    await storage.saveGatherReport(makeGatherReport(TEST_SESSIONS));
    await storage.saveDailyReport(makeDailyReport(TEST_SESSIONS));

    // Ethereal 테스트 계정 생성
    const testAccount = await nodemailer.createTestAccount();
    const recipient = testAccount.user;

    await storage.setConfig("email", recipient);

    // 렌더링
    const rendered = await renderDailyEmail(storage, DATE_STR, "daily");
    expect(rendered).not.toBeNull();

    // Ethereal SMTP로 발송
    const transporter = createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    const info = await transporter.sendMail({
      from: testAccount.user,
      to: recipient,
      subject: rendered!.subject,
      text: rendered!.text,
      html: rendered!.html,
    });

    // Ethereal 미리보기 URL 출력
    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`  Ethereal preview: ${previewUrl}`);
    expect(previewUrl).toBeTruthy();

    // 발송된 메일 검증
    expect(info.accepted).toContain(recipient);
    expect(info.messageId).toBeTruthy();

    // subject 검증
    expect(rendered!.subject).toContain("3 sessions");
    expect(rendered!.subject).toContain("[sincenety]");

    // html 검증 — 프로젝트명 포함
    expect(rendered!.html).toContain("alpha-api");
    expect(rendered!.html).toContain("beta-dashboard");
    expect(rendered!.html).toContain("gamma-cli");

    // html 검증 — sincenety 푸터 포함
    expect(rendered!.html).toContain("sincenety");
  }, 30_000); // Ethereal 네트워크 타임아웃 여유
});
