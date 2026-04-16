import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  detectAiProvider, assertAiReadyForCliPipeline, resolveAiProvider,
} from "../src/core/ai-provider.js";
import type { AiProviderConfig } from "../src/core/ai-provider.js";
import type { StorageAdapter } from "../src/storage/adapter.js";

function createMockStorage(entries: Record<string, string> = {}) {
  const configMap = new Map(Object.entries(entries));
  return {
    getConfig: vi.fn(async (key: string) => configMap.get(key) ?? null),
  } as unknown as StorageAdapter;
}

function cfg(overrides: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return { provider: null, accountId: null, apiToken: null, anthropicKey: null, ...overrides };
}

// ---------------------------------------------------------------------------
// detectAiProvider (pure function — 8 tests)
// ---------------------------------------------------------------------------

describe("detectAiProvider", () => {
  it("explicit cloudflare + creds → cloudflare", () => {
    expect(detectAiProvider(cfg({ provider: "cloudflare", accountId: "x", apiToken: "y" }))).toBe("cloudflare");
  });

  it("explicit cloudflare no creds + anthropicKey → anthropic (fallthrough)", () => {
    expect(detectAiProvider(cfg({ provider: "cloudflare", anthropicKey: "k" }))).toBe("anthropic");
  });

  it("explicit anthropic + key → anthropic", () => {
    expect(detectAiProvider(cfg({ provider: "anthropic", anthropicKey: "k" }))).toBe("anthropic");
  });

  it("explicit anthropic no key + d1 → cloudflare (fallthrough)", () => {
    expect(detectAiProvider(cfg({ provider: "anthropic", accountId: "a", apiToken: "t" }))).toBe("cloudflare");
  });

  it("explicit claude-code → claude-code", () => {
    expect(detectAiProvider(cfg({ provider: "claude-code" }))).toBe("claude-code");
  });

  it("auto-detect: d1 tokens → cloudflare", () => {
    expect(detectAiProvider(cfg({ accountId: "a", apiToken: "t" }))).toBe("cloudflare");
  });

  it("auto-detect: anthropic key → anthropic", () => {
    expect(detectAiProvider(cfg({ anthropicKey: "k" }))).toBe("anthropic");
  });

  it("all null → heuristic", () => {
    expect(detectAiProvider(cfg())).toBe("heuristic");
  });
});

// ---------------------------------------------------------------------------
// assertAiReadyForCliPipeline (5 tests)
// ---------------------------------------------------------------------------

describe("assertAiReadyForCliPipeline", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as any);
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("cloudflare passes silently", async () => {
    const s = createMockStorage({ ai_provider: "cloudflare", d1_account_id: "a", d1_api_token: "t" });
    await expect(assertAiReadyForCliPipeline(s)).resolves.toBeUndefined();
  });

  it("anthropic passes silently", async () => {
    const s = createMockStorage({ anthropic_api_key: "sk-xxx" });
    await expect(assertAiReadyForCliPipeline(s)).resolves.toBeUndefined();
  });

  it("claude-code + needsSkillCommand → JSON stdout + exit(2)", async () => {
    const s = createMockStorage({ ai_provider: "claude-code" });
    await expect(assertAiReadyForCliPipeline(s, "outd")).rejects.toThrow("exit:2");
    expect(writeSpy).toHaveBeenCalled();
    const json = JSON.parse(writeSpy.mock.calls[0][0] as string);
    expect(json.action).toBe("needs_skill");
    expect(json.command).toBe("outd");
  });

  it("claude-code + no command → throw", async () => {
    const s = createMockStorage({ ai_provider: "claude-code" });
    await expect(assertAiReadyForCliPipeline(s)).rejects.toThrow(/슬래시 명령/);
  });

  it("heuristic → throw", async () => {
    const s = createMockStorage();
    await expect(assertAiReadyForCliPipeline(s)).rejects.toThrow(/AI provider가 구성되지 않아/);
  });
});

// ---------------------------------------------------------------------------
// resolveAiProvider + env (2 tests)
// ---------------------------------------------------------------------------

describe("resolveAiProvider + env", () => {
  const origKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = origKey;
  });

  it("ANTHROPIC_API_KEY env overrides null DB value", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-env-test";
    const s = createMockStorage();
    const result = await resolveAiProvider(s);
    expect(result).toBe("anthropic");
  });

  it("resolveAiProvider async wrapper works for cloudflare", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const s = createMockStorage({ d1_account_id: "a", d1_api_token: "t" });
    const result = await resolveAiProvider(s);
    expect(result).toBe("cloudflare");
  });
});
