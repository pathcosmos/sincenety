import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import type { GatherReport, DailyReport, VacationRecord, EmailLog } from "../src/storage/adapter.js";

let tmpDir: string;
let adapter: SqlJsAdapter;

async function createAdapter(): Promise<SqlJsAdapter> {
  tmpDir = mkdtempSync(join(tmpdir(), "sincenety-v4-test-"));
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

describe("DB v4 Schema Migration", () => {
  it("email_logs table exists and returns empty array", async () => {
    await createAdapter();
    const logs = await adapter.getEmailLogs(10);
    expect(logs).toEqual([]);
  });

  it("vacations table exists and returns empty array", async () => {
    await createAdapter();
    const vacations = await adapter.getVacationsByRange("2026-01-01", "2026-12-31");
    expect(vacations).toEqual([]);
  });

  it("status column works on daily_reports", async () => {
    await createAdapter();
    const report: DailyReport = {
      reportDate: "2026-04-07",
      reportType: "daily",
      periodFrom: 1775548000000,
      periodTo: 1775634000000,
      sessionCount: 3,
      totalMessages: 50,
      totalTokens: 10000,
      summaryJson: "[]",
      overview: "test overview",
      reportMarkdown: null,
      createdAt: Date.now(),
      emailedAt: null,
      emailTo: null,
      status: "in_progress",
      progressLabel: "진행중 — 3/7일",
      dataHash: "abc123",
    };
    await adapter.saveDailyReport(report);

    const retrieved = await adapter.getDailyReport("2026-04-07", "daily");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.status).toBe("in_progress");
    expect(retrieved!.progressLabel).toBe("진행중 — 3/7일");
    expect(retrieved!.dataHash).toBe("abc123");
  });

  it("report_date upsert on gather_reports — second save overwrites", async () => {
    await createAdapter();
    const base: GatherReport = {
      gatheredAt: Date.now(),
      fromTimestamp: 1775548000000,
      toTimestamp: 1775634000000,
      sessionCount: 2,
      totalMessages: 10,
      totalInputTokens: 5000,
      totalOutputTokens: 3000,
      reportMarkdown: "# First",
      reportJson: "{}",
      emailedAt: null,
      emailTo: null,
      reportDate: "2026-04-07",
      dataHash: "hash1",
      updatedAt: Date.now(),
    };

    const id1 = await adapter.saveGatherReport(base);

    // Save again with same reportDate — should upsert
    const updated = { ...base, sessionCount: 5, reportMarkdown: "# Updated", dataHash: "hash2" };
    const id2 = await adapter.saveGatherReport(updated);

    // Should be same row (upserted)
    const result = await adapter.getGatherReportByDate("2026-04-07");
    expect(result).not.toBeNull();
    expect(result!.sessionCount).toBe(5);
    expect(result!.reportMarkdown).toBe("# Updated");
    expect(result!.dataHash).toBe("hash2");
  });

  it("vacation CRUD — save, retrieve by range, delete", async () => {
    await createAdapter();

    const vacation: VacationRecord = {
      date: "2026-04-10",
      type: "vacation",
      source: "manual",
      label: "봄 휴가",
      createdAt: Date.now(),
    };
    await adapter.saveVacation(vacation);

    const vacation2: VacationRecord = {
      date: "2026-04-15",
      type: "sick",
      source: "manual",
      label: null,
      createdAt: Date.now(),
    };
    await adapter.saveVacation(vacation2);

    // Retrieve range
    const all = await adapter.getVacationsByRange("2026-04-01", "2026-04-30");
    expect(all).toHaveLength(2);
    expect(all[0].date).toBe("2026-04-10");
    expect(all[0].label).toBe("봄 휴가");
    expect(all[1].date).toBe("2026-04-15");
    expect(all[1].type).toBe("sick");

    // Delete
    await adapter.deleteVacation("2026-04-10");
    const afterDelete = await adapter.getVacationsByRange("2026-04-01", "2026-04-30");
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].date).toBe("2026-04-15");
  });

  it("email log save and retrieve", async () => {
    await createAdapter();

    const log: EmailLog = {
      sentAt: Date.now(),
      reportType: "daily",
      reportDate: "2026-04-07",
      periodFrom: "2026-04-07",
      periodTo: "2026-04-07",
      recipient: "test@example.com",
      subject: "일일 보고",
      bodyHtml: "<h1>보고</h1>",
      bodyText: "보고",
      provider: "gmail_smtp",
      status: "sent",
      errorMessage: null,
    };
    await adapter.saveEmailLog(log);

    const log2: EmailLog = {
      sentAt: Date.now() + 1000,
      reportType: "weekly",
      reportDate: "2026-04-07",
      periodFrom: "2026-04-01",
      periodTo: "2026-04-07",
      recipient: "test@example.com",
      subject: "주간 보고",
      bodyHtml: "<h1>주간</h1>",
      bodyText: "주간",
      provider: "resend",
      status: "failed",
      errorMessage: "SMTP error",
    };
    await adapter.saveEmailLog(log2);

    const logs = await adapter.getEmailLogs(10);
    expect(logs).toHaveLength(2);
    // Ordered by sent_at DESC
    expect(logs[0].reportType).toBe("weekly");
    expect(logs[0].status).toBe("failed");
    expect(logs[0].errorMessage).toBe("SMTP error");
    expect(logs[1].reportType).toBe("daily");
    expect(logs[1].status).toBe("sent");
    expect(logs[1].errorMessage).toBeNull();
  });

  it("updateDailyReportStatus updates status and progressLabel", async () => {
    await createAdapter();
    const report: DailyReport = {
      reportDate: "2026-04-07",
      reportType: "weekly",
      periodFrom: 1775548000000,
      periodTo: 1775634000000,
      sessionCount: 1,
      totalMessages: 5,
      totalTokens: 1000,
      summaryJson: "[]",
      overview: null,
      reportMarkdown: null,
      createdAt: Date.now(),
      emailedAt: null,
      emailTo: null,
      status: "in_progress",
      progressLabel: "진행중 — 1/7일",
      dataHash: null,
    };
    await adapter.saveDailyReport(report);

    await adapter.updateDailyReportStatus("2026-04-07", "weekly", "finalized", "완료 — 7/7일");

    const retrieved = await adapter.getDailyReport("2026-04-07", "weekly");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.status).toBe("finalized");
    expect(retrieved!.progressLabel).toBe("완료 — 7/7일");
  });
});
