/**
 * 갈무리 핵심 로직 — 파싱 → 그룹핑 → 저장 → 리포트
 */

import { parseHistory, getDefaultHistoryPath } from "../parser/history.js";
import { groupFromStream, type SessionGroup } from "../grouper/session.js";
import type {
  StorageAdapter,
  SessionRecord,
  GatherReport,
} from "../storage/adapter.js";

export interface GatherOptions {
  sinceTimestamp?: number;
  historyPath?: string;
  /** 세션 JSONL 파서 사용 여부 (v0.2) — 없으면 history.jsonl만 사용 */
  useSessionJsonl?: boolean;
}

export interface GatherResult {
  sessions: SessionGroup[];
  fromTimestamp: number;
  toTimestamp: number;
  isFirstRun: boolean;
  reportId?: number;
}

function sessionGroupToRecord(group: SessionGroup): SessionRecord {
  return {
    id: group.sessionId,
    project: group.project,
    projectName: group.projectName,
    startedAt: group.startedAt,
    endedAt: group.endedAt,
    durationMinutes: group.durationMinutes ?? 0,
    messageCount: group.messageCount,
    userMessageCount: group.userMessageCount ?? 0,
    assistantMessageCount: group.assistantMessageCount ?? 0,
    toolCallCount: group.toolCallCount ?? 0,
    inputTokens: group.inputTokens ?? 0,
    outputTokens: group.outputTokens ?? 0,
    cacheCreationTokens: group.cacheCreationTokens ?? 0,
    cacheReadTokens: group.cacheReadTokens ?? 0,
    totalTokens: group.totalTokens ?? 0,
    title: group.title ?? group.summary,
    summary: group.summary,
    description: group.description ?? "",
    category: group.category ?? group.projectName,
    tags: (group.tags ?? []).join(","),
    model: group.model ?? "",
    createdAt: Date.now(),
  };
}

/** XML/HTML 태그, 시스템 메시지 등을 정리하여 사람이 읽을 수 있는 텍스트로 변환 */
function stripTags(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")                       // XML/HTML 태그
    .replace(/Caveat:.*?(?=\n|$)/gi, "")           // Caveat 시스템 메시지
    .replace(/Base directory for this skill:.*?(?=\n|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** userInputs에서 의미 있는 작업 목록 추출 (짧은 응답/커맨드 필터) */
function extractMeaningfulActions(
  inputs: Array<{ timestamp: number; text: string }>,
): Array<{ time: string; input: string }> {
  return inputs
    .map((ui) => {
      const cleaned = stripTags(ui.text);
      return {
        time: ui.timestamp > 0
          ? new Date(ui.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
          : "",
        input: cleaned.length > 200 ? cleaned.slice(0, 199) + "…" : cleaned,
        raw: cleaned,
      };
    })
    .filter((a) => a.raw.length > 3);  // 빈 문자열/매우 짧은 응답 제거
}

async function buildGatherReport(
  sessions: SessionGroup[],
  fromTimestamp: number,
  toTimestamp: number,
  markdownReport: string,
  storage: StorageAdapter,
): Promise<GatherReport> {
  const totalMessages = sessions.reduce((s, g) => s + g.messageCount, 0);
  const totalInputTokens = sessions.reduce(
    (s, g) => s + (g.inputTokens ?? 0), 0
  );
  const totalOutputTokens = sessions.reduce(
    (s, g) => s + (g.outputTokens ?? 0), 0
  );

  // 세션별 AI/헬리스틱 요약 생성
  const { summarizeSessions } = await import("./summarizer.js");
  const summaries = await summarizeSessions(sessions, storage);

  return {
    gatheredAt: toTimestamp,
    fromTimestamp,
    toTimestamp,
    sessionCount: sessions.length,
    totalMessages,
    totalInputTokens,
    totalOutputTokens,
    reportMarkdown: markdownReport,
    reportJson: JSON.stringify(
      sessions.map((s) => {
        const inputs = s.userInputs ?? [];
        const actions = extractMeaningfulActions(inputs).map((a) => ({
          time: a.time,
          input: a.input,
          result: "",
          significance: "",
        }));

        const summary = summaries.get(s.sessionId);
        const cleanTitle = summary?.topic || stripTags(s.title ?? s.summary);
        const cleanDesc = stripTags(s.description ?? "");

        return {
          sessionId: s.sessionId,
          projectName: s.projectName,
          title: cleanTitle,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationMinutes: s.durationMinutes ?? (s.endedAt - s.startedAt) / 60000,
          messageCount: s.messageCount,
          userMessageCount: s.userMessageCount ?? 0,
          assistantMessageCount: s.assistantMessageCount ?? 0,
          inputTokens: s.inputTokens ?? 0,
          outputTokens: s.outputTokens ?? 0,
          totalTokens: (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
          model: s.model ?? "",
          category: s.category ?? s.projectName,
          description: cleanDesc,
          actions,
          wrapUp: summary ? {
            outcome: summary.outcome,
            significance: summary.significance,
            flow: summary.flow,
          } : undefined,
        };
      })
    ),
    emailedAt: null,
    emailTo: null,
  };
}

export async function gather(
  storage: StorageAdapter,
  options: GatherOptions = {}
): Promise<GatherResult> {
  const now = Date.now();
  const historyPath = options.historyPath ?? getDefaultHistoryPath();

  // 갈무리 시작점 결정
  let fromTimestamp: number;
  let isFirstRun = false;

  if (options.sinceTimestamp != null) {
    fromTimestamp = options.sinceTimestamp;
  } else {
    // 항상 오늘 00:00부터 — 하루 전체 작업을 매번 수집 (upsert로 중복 방지)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    fromTimestamp = today.getTime();

    const lastCheckpoint = await storage.getLastCheckpoint();
    if (lastCheckpoint == null) {
      isFirstRun = true;
    }
  }

  // 파싱 + 그룹핑
  let sessions: SessionGroup[];

  if (options.useSessionJsonl) {
    // v0.2: 세션 JSONL 기반 (토큰/상세 데이터 포함)
    const { enrichSessionsFromJsonl } = await import(
      "../parser/session-jsonl.js"
    );
    const entries = parseHistory({ historyPath, sinceTimestamp: fromTimestamp });
    const baseSessions = await groupFromStream(entries);
    const details = await enrichSessionsFromJsonl(baseSessions);
    // SessionDetail → SessionGroup 호환 (messages 필드 추가)
    sessions = details.map((d) => ({
      ...d,
      messages: [],
      tags: [],
    }));
  } else {
    // v0.1 호환: history.jsonl만 사용
    const entries = parseHistory({ historyPath, sinceTimestamp: fromTimestamp });
    sessions = await groupFromStream(entries);
  }

  let reportId: number | undefined;

  if (sessions.length > 0) {
    const records = sessions.map(sessionGroupToRecord);
    await storage.upsertSessions(records);

    // 갈무리 리포트 저장
    const { generateMarkdownReport } = await import(
      "../report/markdown.js"
    );
    const markdown = generateMarkdownReport(sessions, fromTimestamp, now);
    const report = await buildGatherReport(sessions, fromTimestamp, now, markdown, storage);
    reportId = await storage.saveGatherReport(report);

    await storage.saveCheckpoint(now);
  }

  return {
    sessions,
    fromTimestamp,
    toTimestamp: now,
    isFirstRun,
    reportId,
  };
}
