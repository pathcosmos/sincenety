import { describe, it, expect, vi, beforeEach } from "vitest";

describe("D1Client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should execute query successfully", async () => {
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
                results: [{ id: 1 }],
                meta: {
                  duration: 0.1,
                  rows_read: 1,
                  rows_written: 0,
                  changes: 0,
                  last_row_id: 0,
                },
              },
            ],
          }),
      }),
    );

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const client = new D1Client("acc", "db", "token");
    const result = await client.query("SELECT 1");
    expect(result.results).toEqual([{ id: 1 }]);
  });

  it("should handle HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      }),
    );

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const client = new D1Client("acc", "db", "bad-token");
    await expect(client.query("SELECT 1")).rejects.toThrow("D1 API error 401");
  });

  it("should handle D1 query errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: false,
            errors: [{ message: "syntax error" }],
          }),
      }),
    );

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const client = new D1Client("acc", "db", "token");
    await expect(client.query("INVALID SQL")).rejects.toThrow("D1 query error");
  });

  it("should ping successfully", async () => {
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
                meta: {
                  duration: 0.01,
                  rows_read: 0,
                  rows_written: 0,
                  changes: 0,
                  last_row_id: 0,
                },
              },
            ],
          }),
      }),
    );

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const client = new D1Client("acc", "db", "token");
    expect(await client.ping()).toBe(true);
  });

  it("should return false on ping failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network")),
    );

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const client = new D1Client("acc", "db", "token");
    expect(await client.ping()).toBe(false);
  });

  it("should execute batch sequentially", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        calls.push(body.sql);
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: [
                {
                  success: true,
                  results: [],
                  meta: {
                    duration: 0.01,
                    rows_read: 0,
                    rows_written: 0,
                    changes: 0,
                    last_row_id: 0,
                  },
                },
              ],
            }),
        });
      }),
    );

    const { D1Client } = await import("../src/cloud/d1-client.js");
    const client = new D1Client("acc", "db", "token");
    const results = await client.batch([
      { sql: "CREATE TABLE a (id INT)" },
      { sql: "CREATE TABLE b (id INT)" },
    ]);
    expect(results).toHaveLength(2);
    expect(calls).toEqual([
      "CREATE TABLE a (id INT)",
      "CREATE TABLE b (id INT)",
    ]);
  });
});
