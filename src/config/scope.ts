/**
 * Scope configuration — global vs project-level tracking
 *
 * Stored as plain JSON at ~/.sincenety/scope.json (not in the encrypted DB)
 * because postinstall needs to write it before DB initialization.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScopeConfig =
  | { mode: "global" }
  | { mode: "project"; path: string };

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getScopePath(): string {
  return join(homedir(), ".sincenety", "scope.json");
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export async function readScope(): Promise<ScopeConfig | null> {
  const p = getScopePath();
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.mode === "global") return { mode: "global" };
    if (parsed.mode === "project" && typeof parsed.path === "string") {
      return { mode: "project", path: parsed.path };
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeScope(scope: ScopeConfig): Promise<void> {
  const dir = join(homedir(), ".sincenety");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(getScopePath(), JSON.stringify(scope, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Interactive prompt
// ---------------------------------------------------------------------------

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Interactive scope selection prompt.
 * Returns the chosen scope config and saves it to disk.
 */
export async function promptScope(
  rl?: ReturnType<typeof createInterface>,
): Promise<ScopeConfig> {
  const ownRl = !rl;
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
  }

  try {
    console.log("");
    console.log("  How would you like to use sincenety?");
    console.log("");
    console.log("    1) Global   — track all Claude Code projects on this machine");
    console.log("    2) Project  — track only a specific project");
    console.log("");

    const choice = await prompt(rl, "  Choose [1/2]: ");

    let scope: ScopeConfig;

    if (choice === "2") {
      const defaultPath = process.cwd();
      const pathInput = await prompt(rl, `  Project path [${defaultPath}]: `);
      const projectPath = pathInput || defaultPath;
      scope = { mode: "project", path: projectPath };
      console.log(`  ✅ Scope: project — ${projectPath}`);
    } else {
      scope = { mode: "global" };
      console.log("  ✅ Scope: global");
    }

    await writeScope(scope);
    return scope;
  } finally {
    if (ownRl) rl.close();
  }
}
