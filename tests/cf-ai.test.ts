import { describe, it, expect, vi, beforeEach } from "vitest";

describe("cf-ai", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should parse successful summary response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              topic: "테스트 요약",
              outcome: "테스트 결과물",
              flow: "A → B → C",
              significance: "테스트 성과",
              nextSteps: "",
            }),
          },
        }],
      }),
    }));

    const { summarizeSession } = await import("../src/cloud/cf-ai.js");
    const result = await summarizeSession(
      { accountId: "acc", apiToken: "tok" },
      "test-project",
      [{ userInput: "hello", assistantOutput: "world" }],
    );

    expect(result).not.toBeNull();
    expect(result!.topic).toBe("테스트 요약");
    expect(result!.flow).toBe("A → B → C");
  });

  it("should handle API errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    }));

    const { summarizeSession } = await import("../src/cloud/cf-ai.js");
    const result = await summarizeSession(
      { accountId: "acc", apiToken: "bad" },
      "test",
      [{ userInput: "x", assistantOutput: "y" }],
    );
    expect(result).toBeNull();
  });

  it("should handle markdown-wrapped JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: "```json\n{\"topic\":\"test\",\"outcome\":\"ok\",\"flow\":\"A→B\",\"significance\":\"done\",\"nextSteps\":\"\"}\n```",
          },
        }],
      }),
    }));

    const { summarizeSession } = await import("../src/cloud/cf-ai.js");
    const result = await summarizeSession(
      { accountId: "acc", apiToken: "tok" },
      "test",
      [{ userInput: "x", assistantOutput: "y" }],
    );
    expect(result!.topic).toBe("test");
  });

  it("should generate overview", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "오늘 하루 종합 요약입니다." } }],
      }),
    }));

    const { generateOverview } = await import("../src/cloud/cf-ai.js");
    const result = await generateOverview(
      { accountId: "acc", apiToken: "tok" },
      "2026-04-08",
      [{ topic: "test", outcome: "ok", flow: "A→B", significance: "done" }],
    );
    expect(result).toBe("오늘 하루 종합 요약입니다.");
  });
});
