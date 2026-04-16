/**
 * 공유 테스트 헬퍼 — SqlJsAdapter 생성/정리 + 팩토리 함수
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import type { DailyReport, GatherReport } from "../src/storage/adapter.js";

export interface TestAdapterContext {
  adapter: SqlJsAdapter;
  tmpDir: string;
}

export async function createTestAdapter(prefix = "sincenety-test"): Promise<TestAdapterContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const adapter = new SqlJsAdapter({ dbPath: join(tmpDir, "test.db") });
  await adapter.initialize();
  return { adapter, tmpDir };
}

export async function cleanupTestAdapter(ctx: TestAdapterContext): Promise<void> {
  if (ctx.adapter) await ctx.adapter.close();
  if (ctx.tmpDir) rmSync(ctx.tmpDir, { recursive: true, force: true });
}

export function makeDailyReport(overrides: Partial<DailyReport> = {}): DailyReport {
  return {
    reportDate: "2026-04-10",
    reportType: "daily",
    periodFrom: 1000,
    periodTo: 2000,
    sessionCount: 1,
    totalMessages: 5,
    totalTokens: 100,
    summaryJson: '[{"sessionId":"s1","topic":"test"}]',
    overview: null,
    reportMarkdown: null,
    createdAt: 1000,
    emailedAt: null,
    emailTo: null,
    status: "finalized",
    progressLabel: null,
    dataHash: "abc",
    ...overrides,
  };
}

export function makeGatherReport(overrides: Partial<GatherReport> = {}): GatherReport {
  return {
    gatheredAt: 1000,
    fromTimestamp: 0,
    toTimestamp: 2000,
    sessionCount: 1,
    totalMessages: 5,
    totalInputTokens: 50,
    totalOutputTokens: 50,
    reportMarkdown: "",
    reportJson: "[]",
    emailedAt: null,
    emailTo: null,
    reportDate: "2026-04-10",
    dataHash: "xyz",
    updatedAt: 1000,
    ...overrides,
  };
}
