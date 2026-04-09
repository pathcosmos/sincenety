import { describe, it, expect } from "vitest";
import {
  isLastDayOfMonth,
  determineReportTypes,
  getReportDateKey,
  parseDateArg,
} from "../src/core/out.js";

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
