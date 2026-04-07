import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseHistory } from "../parser/history.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionDetail {
  sessionId: string;
  project: string;
  projectName: string;
  startedAt: number;
  endedAt: number;
  durationMinutes: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  title: string;
  summary: string;
  description: string;
  category: string;
  model: string;
}

interface SessionJsonlEntry {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeProjectPath(project: string): string {
  // Claude Code encodes: / → -, _ → - (leading - is KEPT)
  return project.replace(/[/_]/g, "-");
}

/**
 * Fallback: scan ~/.claude/projects/ for a directory matching the sessionId.
 * Handles cases where encoding doesn't match exactly.
 */
function findProjectDir(project: string, sessionId: string): string | null {
  const projectsDir = join(homedir(), ".claude", "projects");

  // Try exact encoding first
  const exactPath = join(projectsDir, encodeProjectPath(project), `${sessionId}.jsonl`);
  if (existsSync(exactPath)) return exactPath;

  // Fallback: try with only / → - (no _ replacement)
  const altEncoded = project.replace(/\//g, "-").replace(/^-/, "");
  const altPath = join(projectsDir, altEncoded, `${sessionId}.jsonl`);
  if (existsSync(altPath)) return altPath;

  return null;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" &&
          block !== null &&
          "text" in block &&
          typeof (block as Record<string, unknown>).text === "string",
      )
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) : str;
}

function isSlashCommand(text: string): boolean {
  const cleaned = text.replace(/<[^>]+>/g, "").trimStart();
  return cleaned.startsWith("/");
}

function cleanTitle(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")   // XML/HTML 태그 제거
    .replace(/\n/g, " ")
    .trim();
}

function mostCommon(values: string[]): string {
  if (values.length === 0) return "";
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getSessionJsonlPath(
  project: string,
  sessionId: string,
): string {
  const encoded = encodeProjectPath(project);
  return join(homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
}

export async function parseSessionJsonl(
  project: string,
  sessionId: string,
): Promise<SessionDetail | null> {
  // Try multiple encoding strategies
  let filePath = getSessionJsonlPath(project, sessionId);
  if (!existsSync(filePath)) {
    const found = findProjectDir(project, sessionId);
    if (!found) return null;
    filePath = found;
  }

  let startedAt = Infinity;
  let endedAt = -Infinity;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let messageCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  const userTexts: string[] = [];
  const models: string[] = [];

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: SessionJsonlEntry;
    try {
      entry = JSON.parse(line) as SessionJsonlEntry;
    } catch {
      continue;
    }

    const type = entry.type;
    if (!type) continue;

    messageCount++;

    // Timestamp bookkeeping
    if (entry.timestamp) {
      const ts = new Date(entry.timestamp).getTime();
      if (ts < startedAt) startedAt = ts;
      if (ts > endedAt) endedAt = ts;
    }

    // Tool call counting
    if (type.includes("tool")) {
      toolCallCount++;
    }

    if (type === "user" && entry.message?.role === "user") {
      userMessageCount++;
      const text = extractTextContent(entry.message.content);
      if (text) userTexts.push(text);
    }

    if (type === "assistant" && entry.message?.role === "assistant") {
      assistantMessageCount++;

      if (entry.message.model) {
        models.push(entry.message.model);
      }

      const usage = entry.message.usage;
      if (usage) {
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
        cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
        cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      }
    }
  }

  // Edge case: empty or no messages
  if (startedAt === Infinity) startedAt = 0;
  if (endedAt === -Infinity) endedAt = 0;

  const durationMinutes = (endedAt - startedAt) / 60000;
  const totalTokens = inputTokens + outputTokens;

  // Title: first non-slash user message, truncated to 100 chars
  const firstNonSlash = userTexts.find((t) => !isSlashCommand(t)) ?? userTexts[0] ?? "";
  const title = truncate(cleanTitle(firstNonSlash), 100);
  const summary = title;

  // Description: first 3-5 user messages joined, truncated to 500 chars
  const descSlice = userTexts.slice(0, 5);
  const description = truncate(
    descSlice.map((t) => t.replace(/\n/g, " ").trim()).join(" | "),
    500,
  );

  const projectName = project.split("/").filter(Boolean).pop() ?? project;
  const model = mostCommon(models);

  return {
    sessionId,
    project,
    projectName,
    startedAt,
    endedAt,
    durationMinutes,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    messageCount,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens,
    title,
    summary,
    description,
    category: projectName,
    model,
  };
}

/**
 * history.jsonl 기반 SessionGroup을 세션 JSONL 데이터로 보강.
 * 세션 JSONL이 있으면 토큰/상세 데이터를 덮어쓰고, 없으면 원본 유지.
 */
export async function enrichSessionsFromJsonl(
  baseSessions: Array<{
    sessionId: string;
    project: string;
    startedAt?: number;
    endedAt?: number;
    messageCount?: number;
    summary?: string;
  }>,
): Promise<SessionDetail[]> {
  const results: SessionDetail[] = [];
  for (const base of baseSessions) {
    const detail = await parseSessionJsonl(base.project, base.sessionId);
    if (detail) {
      results.push(detail);
    } else {
      // 세션 JSONL 없으면 기본값으로 채움
      results.push({
        sessionId: base.sessionId,
        project: base.project,
        projectName:
          base.project.split("/").filter(Boolean).pop() ?? base.project,
        startedAt: (base.startedAt as number) ?? 0,
        endedAt: (base.endedAt as number) ?? 0,
        durationMinutes: 0,
        userMessageCount: 0,
        assistantMessageCount: 0,
        toolCallCount: 0,
        messageCount: (base.messageCount as number) ?? 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        title: (base.summary as string) ?? "",
        summary: (base.summary as string) ?? "",
        description: "",
        category:
          base.project.split("/").filter(Boolean).pop() ?? base.project,
        model: "",
      });
    }
  }
  return results;
}

export async function findSessionFiles(
  sinceTimestamp: number,
): Promise<Array<{ project: string; sessionId: string }>> {
  const seen = new Set<string>();
  const results: Array<{ project: string; sessionId: string }> = [];

  for await (const entry of parseHistory({ sinceTimestamp })) {
    const key = `${entry.project}::${entry.sessionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ project: entry.project, sessionId: entry.sessionId });
  }

  return results;
}
