import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const hookPath = join(fileURLToPath(import.meta.url), "../../hooks/guard-out.sh");

const tmpDirs: string[] = [];

function makeMockBinDir(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  writeFileSync(join(dir, "sincenety"), script, { mode: 0o755 });
  tmpDirs.push(dir);
  return dir;
}

function runHook(
  stdinJson: string,
  extraPath?: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bash", [hookPath], {
    input: stdinJson,
    env: {
      ...process.env,
      PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH,
    },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe("guard-out.sh hook", () => {
  it("passes when tool_name is not Bash", () => {
    const r = runHook('{"tool_name":"Read","tool_input":{}}');
    expect(r.status).toBe(0);
  });

  it("passes when command has no sincenety out", () => {
    const r = runHook('{"tool_name":"Bash","tool_input":{"command":"ls -la"}}');
    expect(r.status).toBe(0);
  });

  it("passes for sincenety circle (not out)", () => {
    const r = runHook('{"tool_name":"Bash","tool_input":{"command":"sincenety circle"}}');
    expect(r.status).toBe(0);
  });

  it("blocks (exit 2) when verify shows MISSING", () => {
    const bin = makeMockBinDir('#!/bin/bash\necho "MISSING"');
    const r = runHook(
      '{"tool_name":"Bash","tool_input":{"command":"sincenety outd"}}',
      bin,
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Run /sincenety first");
  });

  it("passes when verify shows OK", () => {
    const bin = makeMockBinDir('#!/bin/bash\necho "✅ OK"');
    const r = runHook(
      '{"tool_name":"Bash","tool_input":{"command":"sincenety out"}}',
      bin,
    );
    expect(r.status).toBe(0);
  });

  it("outd pattern also triggers the guard", () => {
    const bin = makeMockBinDir('#!/bin/bash\necho "✅ OK"');
    const r = runHook(
      '{"tool_name":"Bash","tool_input":{"command":"sincenety outd --preview"}}',
      bin,
    );
    expect(r.status).toBe(0);
  });

  it("passes with warning when verify itself fails (exit 1)", () => {
    const bin = makeMockBinDir('#!/bin/bash\nexit 1');
    const r = runHook(
      '{"tool_name":"Bash","tool_input":{"command":"sincenety out"}}',
      bin,
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("verify unavailable");
  });
});
