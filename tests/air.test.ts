import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import {
  groupSessionsByDate,
  computeDataHash,
  determineRange,
} from "../src/core/air.js";
import type { SessionGroup } from "../src/grouper/session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let adapter: SqlJsAdapter;

function makeSession(
  overrides: Partial<SessionGroup> & { sessionId: string; startedAt: number },
): SessionGroup {
  return {
    project: "/test/project",
    projectName: "project",
    endedAt: overrides.startedAt + 3600000,
    messageCount: 5,
    messages: [],
    summary: "test session",
    ...overrides,
  };
}

async function createAdapter(): Promise<SqlJsAdapter> {
  tmpDir = mkdtempSync(join(tmpdir(), "sincenety-air-test-"));
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
// Tests
// ---------------------------------------------------------------------------

describe("groupSessionsByDate", () => {
  it("groups sessions from 2 different dates correctly", () => {
    // 2026-04-07 09:00 KST
    const day1Ms = new Date(2026, 3, 7, 9, 0, 0).getTime();
    // 2026-04-08 14:00 KST
    const day2Ms = new Date(2026, 3, 8, 14, 0, 0).getTime();

    const sessions: SessionGroup[] = [
      makeSession({ sessionId: "s1", startedAt: day1Ms }),
      makeSession({ sessionId: "s2", startedAt: day1Ms + 3600000 }),
      makeSession({ sessionId: "s3", startedAt: day2Ms }),
    ];

    const map = groupSessionsByDate(sessions);

    expect(map.size).toBe(2);
    expect(map.get("2026-04-07")).toHaveLength(2);
    expect(map.get("2026-04-08")).toHaveLength(1);
    expect(map.get("2026-04-08")![0].sessionId).toBe("s3");
  });

  it("returns empty map for empty input", () => {
    const map = groupSessionsByDate([]);
    expect(map.size).toBe(0);
  });
});

describe("computeDataHash", () => {
  it("same input produces same hash", () => {
    const sessions = [
      makeSession({ sessionId: "a", startedAt: 1000, messageCount: 10 }),
      makeSession({ sessionId: "b", startedAt: 2000, messageCount: 20 }),
    ];
    const h1 = computeDataHash(sessions);
    const h2 = computeDataHash(sessions);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

  it("different input produces different hash", () => {
    const s1 = [
      makeSession({ sessionId: "a", startedAt: 1000, messageCount: 10 }),
    ];
    const s2 = [
      makeSession({ sessionId: "a", startedAt: 1000, messageCount: 11 }),
    ];
    expect(computeDataHash(s1)).not.toBe(computeDataHash(s2));
  });

  it("order-independent (sorted internally)", () => {
    const sa = makeSession({ sessionId: "a", startedAt: 1000, messageCount: 10 });
    const sb = makeSession({ sessionId: "b", startedAt: 2000, messageCount: 20 });
    expect(computeDataHash([sa, sb])).toBe(computeDataHash([sb, sa]));
  });
});

describe("determineRange", () => {
  it("no checkpoint — isFirstRun=true, from ~90 days ago", async () => {
    await createAdapter();
    const { from, to, isFirstRun } = await determineRange(adapter);

    expect(isFirstRun).toBe(true);
    // from should be roughly 90 days ago (allow 1 day tolerance)
    const daysDiff = (to - from) / 86400000;
    expect(daysDiff).toBeGreaterThanOrEqual(89);
    expect(daysDiff).toBeLessThanOrEqual(91);
  });

  it("with checkpoint — from = checkpoint date 00:00", async () => {
    await createAdapter();

    // Save a checkpoint at 2026-04-05 15:30
    const checkpointTs = new Date(2026, 3, 5, 15, 30, 0).getTime();
    await adapter.saveCheckpoint(checkpointTs);

    const { from, isFirstRun } = await determineRange(adapter);

    expect(isFirstRun).toBe(false);
    // from should be 2026-04-05 00:00:00
    const expected = new Date(2026, 3, 5, 0, 0, 0, 0).getTime();
    expect(from).toBe(expected);
  });
});
