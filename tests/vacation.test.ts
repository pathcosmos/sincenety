import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import {
  registerVacation,
  listVacations,
  removeVacation,
  isVacationDay,
  getVacationStats,
} from "../src/vacation/manager.js";
import {
  isVacationKeyword,
  detectVacationType,
  parseCalendarEvent,
} from "../src/vacation/detector.js";

// ─── Storage setup ──────────────────────────────────────────────────────────

let tmpDir: string;
let adapter: SqlJsAdapter;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "sincenety-vacation-test-"));
  adapter = new SqlJsAdapter({ dbPath: join(tmpDir, "test.db") });
  await adapter.initialize();
});

afterEach(async () => {
  if (adapter) await adapter.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ─── 1. Vacation Manager ────────────────────────────────────────────────────

describe("Vacation Manager", () => {
  it("registerVacation: save and retrieve", async () => {
    await registerVacation(adapter, ["2026-04-10"]);
    const list = await listVacations(adapter, "2026-04-01", "2026-04-30");
    expect(list).toHaveLength(1);
    expect(list[0].date).toBe("2026-04-10");
    expect(list[0].type).toBe("vacation");
    expect(list[0].source).toBe("manual");
  });

  it("registerVacation with type: sick type persisted", async () => {
    await registerVacation(adapter, ["2026-04-11"], "sick", "manual", "감기");
    const list = await listVacations(adapter, "2026-04-11", "2026-04-11");
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe("sick");
    expect(list[0].label).toBe("감기");
  });

  it("listVacations: correct range query", async () => {
    await registerVacation(adapter, ["2026-04-05", "2026-04-10", "2026-04-20"]);
    const inRange = await listVacations(adapter, "2026-04-06", "2026-04-15");
    expect(inRange).toHaveLength(1);
    expect(inRange[0].date).toBe("2026-04-10");
  });

  it("removeVacation: delete works", async () => {
    await registerVacation(adapter, ["2026-04-12"]);
    expect(await isVacationDay(adapter, "2026-04-12")).toBe(true);
    await removeVacation(adapter, "2026-04-12");
    expect(await isVacationDay(adapter, "2026-04-12")).toBe(false);
  });

  it("isVacationDay: true for registered, false for unregistered", async () => {
    await registerVacation(adapter, ["2026-05-01"]);
    expect(await isVacationDay(adapter, "2026-05-01")).toBe(true);
    expect(await isVacationDay(adapter, "2026-05-02")).toBe(false);
  });

  it("getVacationStats: total, byType breakdown", async () => {
    await registerVacation(adapter, ["2026-04-10", "2026-04-11"], "vacation");
    await registerVacation(adapter, ["2026-04-12"], "sick");
    await registerVacation(adapter, ["2026-04-13"], "half");

    const stats = await getVacationStats(adapter, "2026-04-01", "2026-04-30");
    expect(stats.total).toBe(4);
    expect(stats.byType).toEqual({ vacation: 2, sick: 1, half: 1 });
    expect(stats.dates).toEqual([
      "2026-04-10",
      "2026-04-11",
      "2026-04-12",
      "2026-04-13",
    ]);
  });
});

// ─── 2. Keyword Detector ────────────────────────────────────────────────────

describe("Keyword Detector", () => {
  it("isVacationKeyword: true for 연차/PTO/병가", () => {
    expect(isVacationKeyword("연차")).toBe(true);
    expect(isVacationKeyword("PTO")).toBe(true);
    expect(isVacationKeyword("병가")).toBe(true);
    expect(isVacationKeyword("vacation day")).toBe(true);
    expect(isVacationKeyword("반차 오후")).toBe(true);
  });

  it("isVacationKeyword: false for non-vacation text", () => {
    expect(isVacationKeyword("Team meeting")).toBe(false);
    expect(isVacationKeyword("Sprint planning")).toBe(false);
    expect(isVacationKeyword("Code review")).toBe(false);
  });

  it("detectVacationType: correct type mapping", () => {
    expect(detectVacationType("연차 사용")).toBe("vacation");
    expect(detectVacationType("PTO request")).toBe("vacation");
    expect(detectVacationType("annual leave")).toBe("vacation");
    expect(detectVacationType("병가")).toBe("sick");
    expect(detectVacationType("sick day")).toBe("sick");
    expect(detectVacationType("공휴일")).toBe("holiday");
    expect(detectVacationType("holiday")).toBe("holiday");
    expect(detectVacationType("반차")).toBe("half");
    expect(detectVacationType("half-day")).toBe("half");
    expect(detectVacationType("대휴")).toBe("other");
    expect(detectVacationType("compensatory leave")).toBe("other");
    expect(detectVacationType("보상휴가")).toBe("other");
    expect(detectVacationType("Team standup")).toBeNull();
  });

  it("parseCalendarEvent: all-day vacation event", () => {
    const result = parseCalendarEvent("연차", true);
    expect(result).toEqual({ isVacation: true, type: "vacation" });
  });

  it("parseCalendarEvent: half-day (not all-day) still detected", () => {
    const result = parseCalendarEvent("반차 오전", false);
    expect(result).toEqual({ isVacation: true, type: "half" });
  });

  it("parseCalendarEvent: non-vacation event", () => {
    const result = parseCalendarEvent("Team meeting", false);
    expect(result).toEqual({ isVacation: false, type: "" });
  });

  it("parseCalendarEvent: null for empty summary", () => {
    expect(parseCalendarEvent("", true)).toBeNull();
  });
});
