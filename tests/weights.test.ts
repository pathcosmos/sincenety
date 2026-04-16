import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isWeightLevel, resolveWeight, getProjectWeights, setProjectWeight,
} from "../src/core/weights.js";
import type { StorageAdapter } from "../src/storage/adapter.js";

function createMockStorage() {
  const configMap = new Map<string, string>();
  return {
    storage: {
      getConfig: vi.fn(async (key: string) => configMap.get(key) ?? null),
      setConfig: vi.fn(async (key: string, value: string) => { configMap.set(key, value); }),
    } as unknown as StorageAdapter,
    configMap,
  };
}

// ---------------------------------------------------------------------------
// isWeightLevel
// ---------------------------------------------------------------------------

describe("isWeightLevel", () => {
  it('"high" → true', () => expect(isWeightLevel("high")).toBe(true));
  it('"normal" → true', () => expect(isWeightLevel("normal")).toBe(true));
  it('"low" → true', () => expect(isWeightLevel("low")).toBe(true));
  it('"critical" → false', () => expect(isWeightLevel("critical")).toBe(false));
  it("42 → false", () => expect(isWeightLevel(42)).toBe(false));
  it("null → false", () => expect(isWeightLevel(null)).toBe(false));
});

// ---------------------------------------------------------------------------
// resolveWeight
// ---------------------------------------------------------------------------

describe("resolveWeight", () => {
  it("exact match", () => {
    expect(resolveWeight({ "/a/b": "high" }, "/a/b")).toBe("high");
  });

  it("basename fallback", () => {
    expect(resolveWeight({ myproject: "low" }, "/home/user/myproject")).toBe("low");
  });

  it("no match → normal", () => {
    expect(resolveWeight({ other: "high" }, "unmatched")).toBe("normal");
  });

  it("empty projectKey → normal", () => {
    expect(resolveWeight({ x: "high" }, "")).toBe("normal");
  });

  it("exact takes precedence over basename", () => {
    expect(resolveWeight({ "/a/b": "high", b: "low" }, "/a/b")).toBe("high");
  });

  it("trailing slash path", () => {
    expect(resolveWeight({ proj: "low" }, "/home/proj/")).toBe("low");
  });

  it("no-slash key → normal (no match in empty map)", () => {
    expect(resolveWeight({}, "myproject")).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// getProjectWeights
// ---------------------------------------------------------------------------

describe("getProjectWeights", () => {
  it("returns {} when config key missing", async () => {
    const { storage } = createMockStorage();
    expect(await getProjectWeights(storage)).toEqual({});
  });

  it("parses valid JSON", async () => {
    const { storage, configMap } = createMockStorage();
    configMap.set("project_weights", '{"a":"high","b":"low"}');
    expect(await getProjectWeights(storage)).toEqual({ a: "high", b: "low" });
  });

  it("filters invalid weight values", async () => {
    const { storage, configMap } = createMockStorage();
    configMap.set("project_weights", '{"a":"critical","b":"low"}');
    expect(await getProjectWeights(storage)).toEqual({ b: "low" });
  });

  it("returns {} on broken JSON", async () => {
    const { storage, configMap } = createMockStorage();
    configMap.set("project_weights", "not json");
    expect(await getProjectWeights(storage)).toEqual({});
  });

  it('returns {} on non-object JSON ("string")', async () => {
    const { storage, configMap } = createMockStorage();
    configMap.set("project_weights", '"string"');
    expect(await getProjectWeights(storage)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// setProjectWeight
// ---------------------------------------------------------------------------

describe("setProjectWeight", () => {
  it("adds new weight", async () => {
    const { storage } = createMockStorage();
    await setProjectWeight(storage, "/a", "high");
    expect(await getProjectWeights(storage)).toEqual({ "/a": "high" });
  });

  it("updates existing weight", async () => {
    const { storage, configMap } = createMockStorage();
    configMap.set("project_weights", '{"/a":"high"}');
    await setProjectWeight(storage, "/a", "low");
    const w = await getProjectWeights(storage);
    expect(w["/a"]).toBe("low");
  });

  it('"clear" removes entry', async () => {
    const { storage, configMap } = createMockStorage();
    configMap.set("project_weights", '{"/a":"high"}');
    await setProjectWeight(storage, "/a", "clear");
    expect(await getProjectWeights(storage)).toEqual({});
  });

  it("preserves other keys when clearing", async () => {
    const { storage, configMap } = createMockStorage();
    configMap.set("project_weights", '{"/a":"high","/b":"low"}');
    await setProjectWeight(storage, "/a", "clear");
    expect(await getProjectWeights(storage)).toEqual({ "/b": "low" });
  });
});
