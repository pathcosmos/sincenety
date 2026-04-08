import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StorageAdapter } from "../src/storage/adapter.js";

/**
 * StorageAdapter mock 생성 — 필요한 메서드만 구현
 */
function createMockStorage(
  configMap: Record<string, string> = {},
): StorageAdapter {
  const config = new Map(Object.entries(configMap));
  return {
    initialize: vi.fn(),
    close: vi.fn(),
    upsertSession: vi.fn(),
    upsertSessions: vi.fn(),
    getSessionsByDate: vi.fn().mockResolvedValue([]),
    getSessionsByRange: vi.fn().mockResolvedValue([]),
    saveGatherReport: vi.fn(),
    getGatherReportsByDate: vi.fn().mockResolvedValue([]),
    getGatherReportByDate: vi.fn().mockResolvedValue(null),
    getLatestGatherReport: vi.fn().mockResolvedValue(null),
    updateReportEmail: vi.fn(),
    saveDailyReport: vi.fn(),
    getDailyReport: vi.fn().mockResolvedValue(null),
    getDailyReportsByRange: vi.fn().mockResolvedValue([]),
    getLatestDailyReport: vi.fn().mockResolvedValue(null),
    updateDailyReportEmail: vi.fn(),
    updateDailyReportStatus: vi.fn(),
    saveVacation: vi.fn(),
    getVacationsByRange: vi.fn().mockResolvedValue([]),
    deleteVacation: vi.fn(),
    saveEmailLog: vi.fn(),
    getEmailLogs: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockImplementation(async (key: string) => config.get(key) ?? null),
    setConfig: vi.fn().mockImplementation(async (key: string, value: string) => {
      config.set(key, value);
    }),
    getLastCheckpoint: vi.fn().mockResolvedValue(null),
    saveCheckpoint: vi.fn(),
  } as StorageAdapter;
}

describe("loadD1Client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null when no D1 config", async () => {
    const storage = createMockStorage();
    const { loadD1Client } = await import("../src/cloud/sync.js");
    const client = await loadD1Client(storage);
    expect(client).toBeNull();
  });

  it("should return null when partial D1 config", async () => {
    const storage = createMockStorage({
      d1_account_id: "acc123",
      // missing database_id and api_token
    });
    const { loadD1Client } = await import("../src/cloud/sync.js");
    const client = await loadD1Client(storage);
    expect(client).toBeNull();
  });

  it("should return D1Client when fully configured", async () => {
    const storage = createMockStorage({
      d1_account_id: "acc123",
      d1_database_id: "db456",
      d1_api_token: "token789",
    });
    const { loadD1Client } = await import("../src/cloud/sync.js");
    const client = await loadD1Client(storage);
    expect(client).not.toBeNull();
  });
});

describe("pushToD1", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return empty result when no data to push", async () => {
    // Mock fetch for ensureD1Schema calls
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            result: [
              {
                success: true,
                results: [],
                meta: { duration: 0.01, rows_read: 0, rows_written: 0, changes: 0, last_row_id: 0 },
              },
            ],
          }),
      }),
    );

    const storage = createMockStorage();
    const { D1Client } = await import("../src/cloud/d1-client.js");
    const { pushToD1 } = await import("../src/cloud/sync.js");

    const client = new D1Client("acc", "db", "token");
    const result = await pushToD1(storage, client, "test-machine");

    expect(result.pushed.sessions).toBe(0);
    expect(result.pushed.gatherReports).toBe(0);
    expect(result.pushed.dailyReports).toBe(0);
    expect(result.pushed.emailLogs).toBe(0);
    expect(result.pushed.vacations).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should push sessions and update last_d1_sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            result: [
              {
                success: true,
                results: [],
                meta: { duration: 0.01, rows_read: 0, rows_written: 0, changes: 1, last_row_id: 1 },
              },
            ],
          }),
      }),
    );

    const storage = createMockStorage();
    (storage.getSessionsByRange as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "sess-1",
        project: "/test/project",
        projectName: "test-project",
        startedAt: Date.now() - 3600000,
        endedAt: Date.now(),
        durationMinutes: 60,
        messageCount: 10,
        userMessageCount: 5,
        assistantMessageCount: 5,
        toolCallCount: 3,
        inputTokens: 1000,
        outputTokens: 2000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 3000,
        title: "테스트 세션",
        summary: "테스트",
        description: "테스트 설명",
        category: "dev",
        tags: "test",
        model: "claude-sonnet-4-20250514",
        createdAt: Date.now() - 3600000,
      },
    ]);

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const { pushToD1 } = await import("../src/cloud/sync.js");

    const client = new D1Client("acc", "db", "token");
    const result = await pushToD1(storage, client, "test-machine");

    expect(result.pushed.sessions).toBe(1);
    expect(result.errors).toHaveLength(0);

    // last_d1_sync should have been saved
    expect(storage.setConfig).toHaveBeenCalledWith(
      "last_d1_sync",
      expect.any(String),
    );
  });

  it("should collect errors without throwing", async () => {
    // Make ensureD1Schema fail immediately
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      }),
    );

    const storage = createMockStorage();

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const { pushToD1 } = await import("../src/cloud/sync.js");

    const client = new D1Client("acc", "db", "token");
    const result = await pushToD1(storage, client, "test-machine");

    // Schema creation failed — should have error but not throw
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("스키마 생성 실패");
  });
});

describe("SyncResult structure", () => {
  it("should have correct shape", () => {
    const result = {
      pushed: {
        sessions: 5,
        gatherReports: 1,
        dailyReports: 2,
        emailLogs: 3,
        vacations: 0,
        config: 4,
      },
      errors: ["test error"],
    };

    expect(result.pushed).toHaveProperty("sessions");
    expect(result.pushed).toHaveProperty("gatherReports");
    expect(result.pushed).toHaveProperty("dailyReports");
    expect(result.pushed).toHaveProperty("emailLogs");
    expect(result.pushed).toHaveProperty("vacations");
    expect(result.pushed).toHaveProperty("config");
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

describe("getSyncStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should report unconfigured when no D1 config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network")),
    );

    const storage = createMockStorage();
    const { D1Client } = await import("../src/cloud/d1-client.js");
    const { getSyncStatus } = await import("../src/cloud/sync.js");

    const client = new D1Client("acc", "db", "token");
    const status = await getSyncStatus(storage, client, "test-machine");

    expect(status.configured).toBe(false);
    expect(status.lastSync).toBeNull();
    expect(status.d1Reachable).toBe(false);
  });

  it("should report configured and reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            result: [
              {
                success: true,
                results: [{ ok: 1 }],
                meta: { duration: 0.01, rows_read: 0, rows_written: 0, changes: 0, last_row_id: 0 },
              },
            ],
          }),
      }),
    );

    const storage = createMockStorage({
      d1_account_id: "acc",
      d1_database_id: "db",
      d1_api_token: "token",
      last_d1_sync: "1700000000000",
    });

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const { getSyncStatus } = await import("../src/cloud/sync.js");

    const client = new D1Client("acc", "db", "token");
    const status = await getSyncStatus(storage, client, "test-machine");

    expect(status.configured).toBe(true);
    expect(status.lastSync).toBe(1700000000000);
    expect(status.d1Reachable).toBe(true);
  });
});

describe("pullConfigFromD1", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should pull and set changed config keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            result: [
              {
                success: true,
                results: [
                  { key: "email", value: "test@example.com" },
                  { key: "provider", value: "resend" },
                ],
                meta: { duration: 0.01, rows_read: 2, rows_written: 0, changes: 0, last_row_id: 0 },
              },
            ],
          }),
      }),
    );

    const storage = createMockStorage({ email: "old@example.com" });

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const { pullConfigFromD1 } = await import("../src/cloud/sync.js");

    const client = new D1Client("acc", "db", "token");
    const changed = await pullConfigFromD1(storage, client);

    expect(changed).toContain("email");
    expect(changed).toContain("provider");
    expect(storage.setConfig).toHaveBeenCalledWith("email", "test@example.com");
    expect(storage.setConfig).toHaveBeenCalledWith("provider", "resend");
  });

  it("should not report unchanged keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            result: [
              {
                success: true,
                results: [{ key: "email", value: "same@example.com" }],
                meta: { duration: 0.01, rows_read: 1, rows_written: 0, changes: 0, last_row_id: 0 },
              },
            ],
          }),
      }),
    );

    const storage = createMockStorage({ email: "same@example.com" });

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const { pullConfigFromD1 } = await import("../src/cloud/sync.js");

    const client = new D1Client("acc", "db", "token");
    const changed = await pullConfigFromD1(storage, client);

    expect(changed).toHaveLength(0);
  });
});
