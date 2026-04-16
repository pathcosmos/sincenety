import { describe, it, expect, afterEach } from "vitest";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import {
  createTestAdapter, cleanupTestAdapter, makeDailyReport, makeGatherReport,
  type TestAdapterContext,
} from "./helpers.js";

let adapter: SqlJsAdapter;
let ctx: TestAdapterContext;

async function createAdapter(): Promise<SqlJsAdapter> {
  ctx = await createTestAdapter("sincenety-freshness-test");
  adapter = ctx.adapter;
  return adapter;
}

afterEach(async () => {
  if (ctx) await cleanupTestAdapter(ctx);
});

// ---------------------------------------------------------------------------
// getDailyReportFreshness
// ---------------------------------------------------------------------------

describe("getDailyReportFreshness", () => {
  it("returns null when neither gather nor daily exists", async () => {
    await createAdapter();
    const result = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(result).toBeNull();
  });

  it("daily only → hasDailyReport:true, hasGatherReport:false, stale:false", async () => {
    await createAdapter();
    await adapter.saveDailyReport(makeDailyReport());
    const f = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(f).not.toBeNull();
    expect(f!.hasDailyReport).toBe(true);
    expect(f!.hasGatherReport).toBe(false);
    expect(f!.stale).toBe(false);
  });

  it("gather only → hasDailyReport:false, hasGatherReport:true", async () => {
    await createAdapter();
    await adapter.saveGatherReport(makeGatherReport());
    const f = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(f).not.toBeNull();
    expect(f!.hasDailyReport).toBe(false);
    expect(f!.hasGatherReport).toBe(true);
    expect(f!.stale).toBe(false);
  });

  it("stale: gather.updatedAt > daily.createdAt → stale:true", async () => {
    await createAdapter();
    await adapter.saveGatherReport(makeGatherReport({ updatedAt: 2000 }));
    await adapter.saveDailyReport(makeDailyReport({ createdAt: 1000 }));
    const f = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(f!.stale).toBe(true);
  });

  it("fresh: daily.createdAt >= gather.updatedAt → stale:false", async () => {
    await createAdapter();
    await adapter.saveGatherReport(makeGatherReport({ updatedAt: 1000 }));
    await adapter.saveDailyReport(makeDailyReport({ createdAt: 2000 }));
    const f = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(f!.stale).toBe(false);
  });

  it("emailed=true when daily has emailedAt", async () => {
    await createAdapter();
    const id = await adapter.saveDailyReport(makeDailyReport());
    await adapter.updateDailyReportEmail(id, 99999, "test@test.com");
    const f = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(f!.emailed).toBe(true);
  });

  it("emailed=false when emailedAt is null", async () => {
    await createAdapter();
    await adapter.saveDailyReport(makeDailyReport({ emailedAt: null }));
    const f = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(f!.emailed).toBe(false);
  });

  it("timestamps match saved values", async () => {
    await createAdapter();
    await adapter.saveGatherReport(makeGatherReport({ updatedAt: 123456 }));
    await adapter.saveDailyReport(makeDailyReport({ createdAt: 789012 }));
    const f = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(f!.gatherUpdatedAt).toBe(123456);
    expect(f!.dailyCreatedAt).toBe(789012);
  });

  it("weekly/monthly type → hasGatherReport always false", async () => {
    await createAdapter();
    await adapter.saveGatherReport(makeGatherReport());
    await adapter.saveDailyReport(makeDailyReport({ reportType: "weekly" }));
    const f = await adapter.getDailyReportFreshness("2026-04-10", "weekly");
    expect(f!.hasGatherReport).toBe(false);
    expect(f!.hasDailyReport).toBe(true);
  });

  it("gather.updatedAt=null (v3 legacy) → stale:false", async () => {
    await createAdapter();
    await adapter.saveGatherReport(makeGatherReport({ updatedAt: null }));
    await adapter.saveDailyReport(makeDailyReport({ createdAt: 1000 }));
    const f = await adapter.getDailyReportFreshness("2026-04-10", "daily");
    expect(f!.stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// invalidateDailyReport
// ---------------------------------------------------------------------------

describe("invalidateDailyReport", () => {
  it("invalidates finalized non-emailed report → true, status=stale", async () => {
    await createAdapter();
    await adapter.saveDailyReport(makeDailyReport({ status: "finalized" }));
    const ok = await adapter.invalidateDailyReport("2026-04-10", "daily");
    expect(ok).toBe(true);
    const report = await adapter.getDailyReport("2026-04-10", "daily");
    expect(report!.status).toBe("stale");
    expect(report!.dataHash).toBeNull();
  });

  it("returns false for non-existent date", async () => {
    await createAdapter();
    const ok = await adapter.invalidateDailyReport("2099-01-01", "daily");
    expect(ok).toBe(false);
  });

  it("returns false for already-emailed report (protection)", async () => {
    await createAdapter();
    const id = await adapter.saveDailyReport(makeDailyReport());
    await adapter.updateDailyReportEmail(id, 12345, "test@test.com");
    const ok = await adapter.invalidateDailyReport("2026-04-10", "daily");
    expect(ok).toBe(false);
    const report = await adapter.getDailyReport("2026-04-10", "daily");
    expect(report!.status).toBe("finalized");
  });

  it("emailedAt=0 → treated as emailed, invalidation blocked", async () => {
    await createAdapter();
    const id = await adapter.saveDailyReport(makeDailyReport());
    await adapter.updateDailyReportEmail(id, 0, "");
    const ok = await adapter.invalidateDailyReport("2026-04-10", "daily");
    expect(ok).toBe(false);
  });

  it("works for weekly type", async () => {
    await createAdapter();
    await adapter.saveDailyReport(makeDailyReport({ reportType: "weekly" }));
    const ok = await adapter.invalidateDailyReport("2026-04-10", "weekly");
    expect(ok).toBe(true);
  });

  it("works for monthly type", async () => {
    await createAdapter();
    await adapter.saveDailyReport(makeDailyReport({ reportType: "monthly" }));
    const ok = await adapter.invalidateDailyReport("2026-04-10", "monthly");
    expect(ok).toBe(true);
  });
});
