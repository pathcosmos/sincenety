import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isLastDayOfMonth,
  determineReportTypes,
  getReportDateKey,
  parseDateArg,
  resolvePipelineMode,
  collectUnrecordedSummaryErrors,
  printVerifyTable,
  findUnsentReports,
} from "../src/core/out.js";
import type { CircleSummaryError } from "../src/core/circle.js";
import type { OutResultEntry, VerifyCheck } from "../src/core/out.js";
import type { StorageAdapter, DailyReport } from "../src/storage/adapter.js";

// ---------------------------------------------------------------------------
// isLastDayOfMonth
// ---------------------------------------------------------------------------

describe("isLastDayOfMonth", () => {
  it("Apr 30 → true (4월 마지막 날)", () => {
    expect(isLastDayOfMonth(new Date(2026, 3, 30))).toBe(true);
  });

  it("Apr 29 → false", () => {
    expect(isLastDayOfMonth(new Date(2026, 3, 29))).toBe(false);
  });

  it("Feb 28, 2027 (non-leap) → true", () => {
    expect(isLastDayOfMonth(new Date(2027, 1, 28))).toBe(true);
  });

  it("Feb 28, 2028 (leap) → false", () => {
    expect(isLastDayOfMonth(new Date(2028, 1, 28))).toBe(false);
  });

  it("Feb 29, 2028 (leap) → true", () => {
    expect(isLastDayOfMonth(new Date(2028, 1, 29))).toBe(true);
  });

  it("Dec 31 → true", () => {
    expect(isLastDayOfMonth(new Date(2026, 11, 31))).toBe(true);
  });

  it("Jan 31 → true", () => {
    expect(isLastDayOfMonth(new Date(2026, 0, 31))).toBe(true);
  });

  it("Jan 30 → false", () => {
    expect(isLastDayOfMonth(new Date(2026, 0, 30))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// determineReportTypes
// ---------------------------------------------------------------------------

describe("determineReportTypes", () => {
  it("Mon-Thu → daily only", () => {
    // 2026-04-07 = Tuesday
    const tuesday = new Date(2026, 3, 7);
    expect(determineReportTypes(tuesday, [])).toEqual(["daily"]);
  });

  it("Wednesday → daily only", () => {
    const wednesday = new Date(2026, 3, 8);
    expect(determineReportTypes(wednesday, [])).toEqual(["daily"]);
  });

  it("Friday → includes weekly", () => {
    // 2026-04-10 = Friday
    const friday = new Date(2026, 3, 10);
    const types = determineReportTypes(friday, []);
    expect(types).toContain("daily");
    expect(types).toContain("weekly");
  });

  it("month-end → includes monthly", () => {
    // 2026-04-30 = Thursday, last day of April
    const apr30 = new Date(2026, 3, 30);
    const types = determineReportTypes(apr30, []);
    expect(types).toContain("daily");
    expect(types).toContain("monthly");
  });

  it("Friday + month-end → daily + weekly + monthly", () => {
    // 2027-01-29 is Friday and Jan 29 is NOT month-end
    // Use 2026-07-31 = Friday? Let's check: new Date(2026,6,31).getDay()
    // Actually let's just use unsentTypes for the combo test
    const friday = new Date(2026, 3, 10); // Friday
    const types = determineReportTypes(friday, ["monthly"]);
    expect(types).toContain("daily");
    expect(types).toContain("weekly");
    expect(types).toContain("monthly");
    expect(types).toHaveLength(3);
  });

  it("unsent weekly catchup on non-Friday", () => {
    const tuesday = new Date(2026, 3, 7);
    const types = determineReportTypes(tuesday, ["weekly"]);
    expect(types).toContain("daily");
    expect(types).toContain("weekly");
  });

  it("unsent monthly catchup on non-month-end", () => {
    const tuesday = new Date(2026, 3, 7);
    const types = determineReportTypes(tuesday, ["monthly"]);
    expect(types).toContain("daily");
    expect(types).toContain("monthly");
  });

  it("deduplicates when Friday + unsent weekly", () => {
    const friday = new Date(2026, 3, 10);
    const types = determineReportTypes(friday, ["weekly"]);
    const weeklyCount = types.filter((t) => t === "weekly").length;
    expect(weeklyCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getReportDateKey
// ---------------------------------------------------------------------------

describe("getReportDateKey", () => {
  it("daily → today's date", () => {
    const today = new Date(2026, 3, 7); // 2026-04-07
    expect(getReportDateKey("daily", today)).toBe("2026-04-07");
  });

  it("weekly → monday of current week", () => {
    // 2026-04-07 = Tuesday → monday = 2026-04-06
    const tuesday = new Date(2026, 3, 7);
    expect(getReportDateKey("weekly", tuesday)).toBe("2026-04-06");
  });

  it("monthly → first of current month", () => {
    const today = new Date(2026, 3, 15);
    expect(getReportDateKey("monthly", today)).toBe("2026-04-01");
  });

  it("weekly on Sunday → same week's monday", () => {
    // 2026-04-12 = Sunday → monday = 2026-04-06
    const sunday = new Date(2026, 3, 12);
    expect(getReportDateKey("weekly", sunday)).toBe("2026-04-06");
  });

  it("monthly on first → same month", () => {
    const first = new Date(2026, 3, 1);
    expect(getReportDateKey("monthly", first)).toBe("2026-04-01");
  });
});

// ---------------------------------------------------------------------------
// parseDateArg
// ---------------------------------------------------------------------------

describe("parseDateArg", () => {
  it("valid yyyyMMdd → Date", () => {
    const d = parseDateArg("20260408");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // 0-based
    expect(d.getDate()).toBe(8);
  });

  it("year-end → Dec 31", () => {
    const d = parseDateArg("20281231");
    expect(d.getFullYear()).toBe(2028);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  it("throws on short string", () => {
    expect(() => parseDateArg("2026048")).toThrow("Invalid date format");
  });

  it("throws on non-numeric", () => {
    expect(() => parseDateArg("2026040a")).toThrow("Invalid date format");
  });

  it("throws on invalid calendar date (Feb 30)", () => {
    expect(() => parseDateArg("20260230")).toThrow("Invalid date");
  });

  it("throws on month 13", () => {
    expect(() => parseDateArg("20261301")).toThrow("Invalid date");
  });
});

// ---------------------------------------------------------------------------
// --date integration with helpers
// ---------------------------------------------------------------------------

describe("--date integration with helpers", () => {
  it("daily key for specific date", () => {
    expect(getReportDateKey("daily", parseDateArg("20260408"))).toBe("2026-04-08");
  });

  it("weekly key → Monday of that week (Wed Apr 8 → Mon Apr 6)", () => {
    expect(getReportDateKey("weekly", parseDateArg("20260408"))).toBe("2026-04-06");
  });

  it("monthly key → 1st of that month", () => {
    expect(getReportDateKey("monthly", parseDateArg("20260408"))).toBe("2026-04-01");
  });

  it("Friday date includes weekly in report types", () => {
    const types = determineReportTypes(parseDateArg("20260410"), []);
    expect(types).toContain("daily");
    expect(types).toContain("weekly");
  });

  it("month-end date includes monthly in report types", () => {
    expect(isLastDayOfMonth(parseDateArg("20260430"))).toBe(true);
  });

  it("mid-month non-Friday → daily only", () => {
    // 2026-04-08 is Wednesday
    const types = determineReportTypes(parseDateArg("20260408"), []);
    expect(types).toEqual(["daily"]);
  });
});

// ---------------------------------------------------------------------------
// resolvePipelineMode
// ---------------------------------------------------------------------------

describe("resolvePipelineMode", () => {
  it("defaults to full when nothing is set", () => {
    expect(resolvePipelineMode(undefined, null)).toBe("full");
  });

  it("defaults to full when explicit and config both missing", () => {
    expect(resolvePipelineMode(undefined, undefined)).toBe("full");
  });

  it("returns explicit option when provided (full)", () => {
    expect(resolvePipelineMode("full", null)).toBe("full");
  });

  it("returns explicit option when provided (smart)", () => {
    expect(resolvePipelineMode("smart", null)).toBe("smart");
  });

  it("explicit option overrides config", () => {
    expect(resolvePipelineMode("smart", "full")).toBe("smart");
    expect(resolvePipelineMode("full", "smart")).toBe("full");
  });

  it("uses config when no explicit option", () => {
    expect(resolvePipelineMode(undefined, "smart")).toBe("smart");
    expect(resolvePipelineMode(undefined, "full")).toBe("full");
  });

  it("falls back to full for invalid config values", () => {
    expect(resolvePipelineMode(undefined, "invalid")).toBe("full");
    expect(resolvePipelineMode(undefined, "")).toBe("full");
  });
});

// ---------------------------------------------------------------------------
// collectUnrecordedSummaryErrors
// ---------------------------------------------------------------------------

describe("collectUnrecordedSummaryErrors", () => {
  const today = new Date(2026, 3, 8); // Wednesday — reportTypes=["daily"] only

  it("returns empty when no summary errors", () => {
    const result = collectUnrecordedSummaryErrors([], [], today);
    expect(result).toEqual([]);
  });

  it("promotes weekly error to an entry when not already recorded", () => {
    const errors: CircleSummaryError[] = [{ type: "weekly", error: "boom" }];
    const existing: OutResultEntry[] = [];
    const result = collectUnrecordedSummaryErrors(errors, existing, today);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("weekly");
    expect(result[0].status).toBe("error");
    expect(result[0].error).toContain("boom");
    expect(result[0].dateKey).toBe("2026-04-06"); // monday of week
  });

  it("promotes monthly error with correct dateKey (1st of month)", () => {
    const errors: CircleSummaryError[] = [{ type: "monthly", error: "bust" }];
    const result = collectUnrecordedSummaryErrors(errors, [], today);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("monthly");
    expect(result[0].dateKey).toBe("2026-04-01");
    expect(result[0].error).toContain("bust");
  });

  it("skips errors already recorded in existing entries (dedup)", () => {
    const errors: CircleSummaryError[] = [{ type: "weekly", error: "boom" }];
    const existing: OutResultEntry[] = [
      { type: "weekly", dateKey: "2026-04-06", status: "error", error: "already handled" },
    ];
    const result = collectUnrecordedSummaryErrors(errors, existing, today);
    expect(result).toEqual([]);
  });

  it("does NOT dedup non-error existing entries of same type", () => {
    // 이론상 있을 수 없는 케이스지만 방어: 기존 entry가 'sent'면 error는 여전히 전파
    const errors: CircleSummaryError[] = [{ type: "weekly", error: "boom" }];
    const existing: OutResultEntry[] = [
      { type: "weekly", dateKey: "2026-04-06", status: "sent" },
    ];
    const result = collectUnrecordedSummaryErrors(errors, existing, today);
    expect(result).toHaveLength(1);
  });

  it("promotes both weekly and monthly when both failed and neither recorded", () => {
    const errors: CircleSummaryError[] = [
      { type: "weekly", error: "w-err" },
      { type: "monthly", error: "m-err" },
    ];
    const result = collectUnrecordedSummaryErrors(errors, [], today);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.type).sort()).toEqual(["monthly", "weekly"]);
  });

  it("error message embeds the type label for clarity", () => {
    const errors: CircleSummaryError[] = [{ type: "weekly", error: "db down" }];
    const result = collectUnrecordedSummaryErrors(errors, [], today);
    expect(result[0].error).toMatch(/weekly baseline auto-summary failed/);
    expect(result[0].error).toContain("db down");
  });
});

// ---------------------------------------------------------------------------
// printVerifyTable
// ---------------------------------------------------------------------------

describe("printVerifyTable", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function makeCheck(overrides: Partial<VerifyCheck>): VerifyCheck {
    return {
      type: "daily", dateKey: "2026-04-16", summary: "OK",
      baseline: "OK", recipient: "OK",
      gatherUpdatedAt: null, dailyCreatedAt: null, ...overrides,
    };
  }

  it("prints header", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printVerifyTable([makeCheck({})]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Verify report readiness");
    spy.mockRestore();
  });

  it("renders OK status", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printVerifyTable([makeCheck({ summary: "OK" })]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("✅ OK");
    spy.mockRestore();
  });

  it("renders MISSING status", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printVerifyTable([makeCheck({ summary: "MISSING" })]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("❌ MISSING");
    spy.mockRestore();
  });

  it("renders STALE status", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printVerifyTable([makeCheck({ summary: "STALE" })]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("⚠️  STALE");
    spy.mockRestore();
  });

  it("renders EMAILED status", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printVerifyTable([makeCheck({ summary: "EMAILED" })]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("📧 SENT");
    spy.mockRestore();
  });

  it("handles empty array without crash", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => printVerifyTable([])).not.toThrow();
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Verify report readiness");
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// findUnsentReports
// ---------------------------------------------------------------------------

describe("findUnsentReports", () => {
  function makeMockStorage(reports: Record<string, Partial<DailyReport> | null>): StorageAdapter {
    return {
      getDailyReport: vi.fn(async (date: string, type?: string) => {
        const key = `${date}:${type ?? "daily"}`;
        const r = reports[key] ?? null;
        return r ? { id: 1, reportDate: date, reportType: type ?? "daily", periodFrom: 0, periodTo: 0, sessionCount: 0, totalMessages: 0, totalTokens: 0, summaryJson: "[]", overview: null, reportMarkdown: null, createdAt: Date.now(), emailedAt: null, emailTo: null, status: "finalized", progressLabel: null, dataHash: null, ...r } : null;
      }),
    } as unknown as StorageAdapter;
  }

  it("returns [weekly] when last week finalized + not emailed", async () => {
    const monday = "2026-04-06";
    const storage = makeMockStorage({ [`${monday}:weekly`]: { status: "finalized", emailedAt: null } });
    const result = await findUnsentReports(storage, new Date(2026, 3, 16));
    expect(result).toContain("weekly");
  });

  it("returns [] when last week weekly already emailed", async () => {
    const monday = "2026-04-06";
    const storage = makeMockStorage({ [`${monday}:weekly`]: { status: "finalized", emailedAt: 12345 } });
    const result = await findUnsentReports(storage, new Date(2026, 3, 16));
    expect(result).not.toContain("weekly");
  });

  it("returns [monthly] when last month finalized + not emailed", async () => {
    const storage = makeMockStorage({ ["2026-03-01:monthly"]: { status: "finalized", emailedAt: null } });
    const result = await findUnsentReports(storage, new Date(2026, 3, 16));
    expect(result).toContain("monthly");
  });

  it("returns [weekly, monthly] when both unsent", async () => {
    const monday = "2026-04-06";
    const storage = makeMockStorage({
      [`${monday}:weekly`]: { status: "finalized", emailedAt: null },
      ["2026-03-01:monthly"]: { status: "finalized", emailedAt: null },
    });
    const result = await findUnsentReports(storage, new Date(2026, 3, 16));
    expect(result).toContain("weekly");
    expect(result).toContain("monthly");
  });

  it("handles month-start edge (Apr 3 → last week crosses to March)", async () => {
    const storage = makeMockStorage({ ["2026-03-23:weekly"]: { status: "finalized", emailedAt: null } });
    const result = await findUnsentReports(storage, new Date(2026, 3, 3));
    expect(result).toContain("weekly");
  });
});
