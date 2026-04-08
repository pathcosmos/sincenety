import { describe, it, expect } from "vitest";
import { getMachineId } from "../src/util/machine-id.js";

describe("getMachineId", () => {
  it("should return a non-empty string", () => {
    const id = getMachineId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("should have platform prefix", () => {
    const id = getMachineId();
    expect(id).toMatch(/^(mac|linux|win|other)_/);
  });

  it("should be deterministic (same machine = same id)", () => {
    const id1 = getMachineId();
    const id2 = getMachineId();
    expect(id1).toBe(id2);
  });

  it("should contain username", () => {
    const id = getMachineId();
    const user = process.env.USER ?? process.env.USERNAME ?? "unknown";
    expect(id).toContain(user);
  });
});
