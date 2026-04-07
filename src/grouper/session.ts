export interface HistoryEntry {
  display: string;
  pastedContents: Record<string, unknown>;
  timestamp: number;
  project: string;
  sessionId: string;
}

export interface SessionGroup {
  sessionId: string;
  project: string;
  projectName: string;
  startedAt: number;
  endedAt: number;
  durationMinutes?: number;
  messageCount: number;
  userMessageCount?: number;
  assistantMessageCount?: number;
  toolCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  title?: string;
  summary: string;
  description?: string;
  category?: string;
  tags?: string[];
  model?: string;
  messages: string[];
  /** 사용자 입력 전체 목록 (타임스탬프 포함, session-jsonl에서 제공) */
  userInputs?: Array<{ timestamp: number; text: string }>;
  /** 대화 턴 (사용자→어시스턴트 쌍) — 실제 작업 내용 파악용 */
  conversationTurns?: Array<{ userInput: string; assistantOutput: string; timestamp: number }>;
}

function extractProjectName(project: string): string {
  const segments = project.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] || project;
}

function pickSummary(messages: string[]): string {
  const nonCommand = messages.find((m) => !m.startsWith("/"));
  const raw = nonCommand ?? messages[0] ?? "";
  return raw.length > 100 ? raw.slice(0, 100) : raw;
}

export function groupSessions(entries: HistoryEntry[]): SessionGroup[] {
  const groups = new Map<string, {
    sessionId: string;
    project: string;
    min: number;
    max: number;
    count: number;
    summaryCandidate: string | null;
    firstMessage: string | null;
  }>();

  for (const entry of entries) {
    const key = `${entry.sessionId}|${entry.project}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        sessionId: entry.sessionId,
        project: entry.project,
        min: entry.timestamp,
        max: entry.timestamp,
        count: 0,
        summaryCandidate: null,
        firstMessage: null,
      };
      groups.set(key, group);
    }
    if (entry.timestamp < group.min) group.min = entry.timestamp;
    if (entry.timestamp > group.max) group.max = entry.timestamp;
    group.count++;
    // summary 후보만 유지 (메모리 최소화 — 전체 메시지 버퍼링 안 함)
    if (group.firstMessage === null) group.firstMessage = entry.display;
    if (group.summaryCandidate === null && !entry.display.startsWith("/")) {
      group.summaryCandidate = entry.display;
    }
  }

  const result: SessionGroup[] = [];
  for (const g of groups.values()) {
    const rawSummary = g.summaryCandidate ?? g.firstMessage ?? "";
    result.push({
      sessionId: g.sessionId,
      project: g.project,
      projectName: extractProjectName(g.project),
      startedAt: g.min,
      endedAt: g.max,
      messageCount: g.count,
      messages: [],
      summary: rawSummary.length > 100 ? rawSummary.slice(0, 100) : rawSummary,
    });
  }

  result.sort((a, b) => a.startedAt - b.startedAt);
  return result;
}

export async function groupFromStream(
  entries: AsyncIterable<HistoryEntry>,
): Promise<SessionGroup[]> {
  const collected: HistoryEntry[] = [];
  for await (const entry of entries) {
    collected.push(entry);
  }
  return groupSessions(collected);
}
