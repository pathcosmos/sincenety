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
  /** 사용자 입력 전체 목록 (타임스탬프 포함) */
  userInputs: Array<{ timestamp: number; text: string }>;
  /** 대화 턴 (사용자 입력 + 어시스턴트 응답 쌍) — 요약 생성용 */
  conversationTurns: Array<{ userInput: string; assistantOutput: string; timestamp: number }>;
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
    const textParts: string[] = [];
    const toolNames: string[] = [];
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        textParts.push(b.text);
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        toolNames.push(b.name as string);
      }
    }
    // 텍스트가 있으면 텍스트 우선, 없으면 tool 이름이라도 반환
    if (textParts.length > 0) return textParts.join("\n");
    if (toolNames.length > 0) return `[${toolNames.join(", ")}]`;
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

/** XML/HTML 태그, 시스템 메시지, 파일 경로 등을 정리 */
function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")                     // XML/HTML 태그 제거
    .replace(/Caveat:.*?(?=\n|$)/gi, "")         // Caveat 시스템 메시지 제거
    .replace(/Base directory for this skill:.*?(?=\n|$)/gi, "")
    .replace(/(?:\/(?:Users|Volumes|home|tmp|var|opt|etc|usr)\/)\S+/g, "")  // 절대 경로 제거
    .replace(/(?:\.\.?\/)\S+/g, "")              // 상대 경로 (./foo, ../bar) 제거
    .replace(/\b[\w.-]+\.(?:ts|js|tsx|jsx|json|jsonl|md|yaml|yml|toml|css|html|sql|sh|py|go|rs)\b/g, "")  // 파일명 제거
    .replace(/\s+/g, " ")                        // 연속 공백/줄바꿈 → 단일 공백
    .trim();
}

function cleanTitle(text: string): string {
  return cleanText(text);
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
  const userInputs: Array<{ timestamp: number; text: string }> = [];
  const models: string[] = [];

  // 대화 턴 수집: 사용자 입력 → 어시스턴트 응답 쌍
  let pendingUserInput: { text: string; timestamp: number } | null = null;
  const conversationTurns: Array<{ userInput: string; assistantOutput: string; timestamp: number }> = [];

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
      if (text) {
        userTexts.push(text);
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
        userInputs.push({ timestamp: ts, text });
        // 이전 pending이 있으면 응답 없이 턴 저장
        if (pendingUserInput) {
          conversationTurns.push({
            userInput: pendingUserInput.text,
            assistantOutput: "",
            timestamp: pendingUserInput.timestamp,
          });
        }
        pendingUserInput = { text, timestamp: ts };
      }
    }

    if (type === "assistant" && entry.message?.role === "assistant") {
      assistantMessageCount++;

      if (entry.message.model) {
        models.push(entry.message.model);
      }

      // 어시스턴트 응답 텍스트 수집 (첫 1500자 — 요약 품질 확보)
      const assistText = extractTextContent(entry.message.content);
      const assistSummary = assistText.length > 1500 ? assistText.slice(0, 1500) : assistText;

      // 대화 턴 완성
      if (pendingUserInput) {
        conversationTurns.push({
          userInput: pendingUserInput.text,
          assistantOutput: assistSummary,
          timestamp: pendingUserInput.timestamp,
        });
        pendingUserInput = null;
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

  // 마지막 pending 사용자 입력 처리
  if (pendingUserInput) {
    conversationTurns.push({
      userInput: pendingUserInput.text,
      assistantOutput: "",
      timestamp: pendingUserInput.timestamp,
    });
  }

  // Edge case: empty or no messages
  if (startedAt === Infinity) startedAt = 0;
  if (endedAt === -Infinity) endedAt = 0;

  const durationMinutes = (endedAt - startedAt) / 60000;
  const totalTokens = inputTokens + outputTokens;

  // Title: first meaningful (>5 chars) non-slash user message, cleaned and truncated
  const meaningfulNonSlash = userTexts.find((t) => !isSlashCommand(t) && cleanTitle(t).length > 5);
  const anyNonSlash = userTexts.find((t) => !isSlashCommand(t));
  const titleCandidate = meaningfulNonSlash ?? anyNonSlash ?? "";
  const projectLabel = project.split("/").filter(Boolean).pop() ?? project;
  const title = titleCandidate
    ? truncate(cleanTitle(titleCandidate), 100)
    : `[${projectLabel}] session`;
  const summary = title;

  // Description: 의미 있는 사용자 입력을 정리하여 전체 작업 흐름 파악용
  // 짧은 응답(ok, yes 등)과 슬래시 커맨드는 필터링, 나머지 전부 포함
  const meaningfulInputs = userTexts
    .map((t) => cleanText(t))
    .filter((t) => t.length > 5 && !t.startsWith("/"));
  const description = truncate(
    meaningfulInputs.join(" | "),
    2000,
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
    userInputs,
    conversationTurns,
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
        userInputs: [],
        conversationTurns: [],
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
