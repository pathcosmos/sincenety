import { describe, it, expect, vi, afterEach } from "vitest";
import { runDoctor, printDoctorTable, type DoctorRow } from "../src/core/doctor.js";
import type { StorageAdapter, FreshnessInfo, DailyReport } from "../src/storage/adapter.js";
import { makeDailyReport as baseMakeDailyReport } from "./helpers.js";

function makeFreshness(overrides: Partial<FreshnessInfo> = {}): FreshnessInfo {
  return {
    hasDailyReport: true, hasGatherReport: true,
    gatherUpdatedAt: 1000, dailyCreatedAt: 2000,
    emailed: false, stale: false, ...overrides,
  };
}

function makeDailyReport(overrides: Partial<DailyReport> = {}): DailyReport {
  return baseMakeDailyReport({
    reportDate: "2026-04-16", periodFrom: 0, periodTo: 0,
    totalMessages: 1, dataHash: null, ...overrides,
  });
}

function createMockStorage(
  freshnessResponder: (date: string) => FreshnessInfo | null = () => null,
  dailyResponder: (date: string) => DailyReport | null = () => null,
): StorageAdapter {
  return {
    getDailyReportFreshness: vi.fn(async (date: string) => freshnessResponder(date)),
    getDailyReport: vi.fn(async (date: string) => dailyResponder(date)),
  } as unknown as StorageAdapter;
}

// ---------------------------------------------------------------------------
// runDoctor
// ---------------------------------------------------------------------------

const TODAY = new Date(2026, 3, 16);

describe("runDoctor", () => {
  it("all NO_DATA when freshness returns null", async () => {
    const s = createMockStorage();
    const rows = await runDoctor(s, 3, TODAY);
    expect(rows.every((r) => r.status === "NO_DATA")).toBe(true);
  });

  it("OK when daily+gather exist and summaryJson valid", async () => {
    const s = createMockStorage(
      () => makeFreshness(),
      () => makeDailyReport(),
    );
    const rows = await runDoctor(s, 1, TODAY);
    expect(rows[0].status).toBe("OK");
  });

  it("MISSING_SUMMARY when gather exists but no daily", async () => {
    const s = createMockStorage(
      () => makeFreshness({ hasDailyReport: false }),
    );
    const rows = await runDoctor(s, 1, TODAY);
    expect(rows[0].status).toBe("MISSING_SUMMARY");
  });

  it("EMPTY_SUMMARY when summaryJson is empty array", async () => {
    const s = createMockStorage(
      () => makeFreshness(),
      () => makeDailyReport({ summaryJson: "[]" }),
    );
    const rows = await runDoctor(s, 1, TODAY);
    expect(rows[0].status).toBe("EMPTY_SUMMARY");
  });

  it("EMPTY_SUMMARY when summaryJson is malformed", async () => {
    const s = createMockStorage(
      () => makeFreshness(),
      () => makeDailyReport({ summaryJson: "{broken" }),
    );
    const rows = await runDoctor(s, 1, TODAY);
    expect(rows[0].status).toBe("EMPTY_SUMMARY");
  });

  it("STALE when stale=true and summaryJson valid", async () => {
    const s = createMockStorage(
      () => makeFreshness({ stale: true }),
      () => makeDailyReport(),
    );
    const rows = await runDoctor(s, 1, TODAY);
    expect(rows[0].status).toBe("STALE");
  });

  it("default days=14 → 14 rows", async () => {
    const s = createMockStorage();
    const rows = await runDoctor(s, 14, TODAY);
    expect(rows).toHaveLength(14);
  });

  it("custom days=3 → 3 rows", async () => {
    const s = createMockStorage();
    const rows = await runDoctor(s, 3, TODAY);
    expect(rows).toHaveLength(3);
  });

  it("dates are descending (today → past)", async () => {
    const s = createMockStorage();
    const rows = await runDoctor(s, 5, TODAY);
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].date > rows[i + 1].date).toBe(true);
    }
  });

  it("emailed flag is reflected", async () => {
    const s = createMockStorage(
      () => makeFreshness({ emailed: true }),
      () => makeDailyReport(),
    );
    const rows = await runDoctor(s, 1, TODAY);
    expect(rows[0].emailed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// printDoctorTable
// ---------------------------------------------------------------------------

describe("printDoctorTable", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function makeRow(overrides: Partial<DoctorRow> = {}): DoctorRow {
    return {
      date: "2026-04-16", hasGather: true, hasDaily: true,
      emailed: false, stale: false, emptySummary: false,
      status: "OK", ...overrides,
    };
  }

  it('header contains "sincenety doctor"', () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printDoctorTable([makeRow()]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("sincenety doctor");
  });

  it("STALE row → suggests --rerun", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printDoctorTable([makeRow({ status: "STALE", date: "2026-04-15" })]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("--rerun");
    expect(output).toContain("2026-04-15");
  });

  it("MISSING_SUMMARY → suggests /sincenety or circle (not --rerun)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printDoctorTable([makeRow({ status: "MISSING_SUMMARY" })]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toMatch(/\/sincenety|sincenety circle/);
    expect(output).not.toContain("--rerun");
  });

  it("icon mapping is correct", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printDoctorTable([
      makeRow({ status: "OK" }),
      makeRow({ status: "STALE", date: "2026-04-15" }),
      makeRow({ status: "EMPTY_SUMMARY", date: "2026-04-14" }),
      makeRow({ status: "MISSING_SUMMARY", date: "2026-04-13" }),
      makeRow({ status: "NO_DATA", date: "2026-04-12" }),
    ]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("✅");
    expect(output).toContain("⚠️");
    expect(output).toContain("⛔");
    expect(output).toContain("❌");
    expect(output).toContain("⬜");
  });
});
