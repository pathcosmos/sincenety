/**
 * air (환기) — 날짜별 그룹핑 갈무리 + 백필 오케스트레이터
 *
 * history.jsonl을 파싱하여 세션을 날짜별로 그룹핑하고,
 * 변경 감지(data hash)로 필요한 날짜만 upsert한다.
 */

import { createHash } from "node:crypto";
import { parseHistory, getDefaultHistoryPath } from "../parser/history.js";
import { groupFromStream, type SessionGroup } from "../grouper/session.js";
import { enrichSessionsFromJsonl } from "../parser/session-jsonl.js";
import { generateMarkdownReport } from "../report/markdown.js";
import { sessionGroupToRecord } from "./gatherer.js";
import type { StorageAdapter, GatherReport } from "../storage/adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { ScopeConfig } from "../config/scope.js";

export interface AirOptions {
  historyPath?: string;
  scope?: ScopeConfig;
}

export interface AirResult {
  dates: string[];
  totalSessions: number;
  isFirstRun: boolean;
  backfillDays: number;
  changedDates: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** YYYY-MM-DD 문자열로 변환 (로컬 시간 기준) */
function toDateStr(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 날짜 문자열의 00:00:00 epoch ms */
function dateStrToEpoch(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** from~to 범위의 모든 YYYY-MM-DD를 생성 */
function generateDateRange(fromMs: number, toMs: number): string[] {
  const dates: string[] = [];
  const d = new Date(fromMs);
  d.setHours(0, 0, 0, 0);
  const endDate = toDateStr(toMs);

  while (true) {
    const ds = toDateStr(d.getTime());
    dates.push(ds);
    if (ds >= endDate) break;
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 세션 배열을 startedAt 기준 YYYY-MM-DD로 그룹핑
 */
export function groupSessionsByDate(
  sessions: SessionGroup[],
): Map<string, SessionGroup[]> {
  const map = new Map<string, SessionGroup[]>();
  for (const s of sessions) {
    const dateStr = toDateStr(s.startedAt);
    const arr = map.get(dateStr);
    if (arr) {
      arr.push(s);
    } else {
      map.set(dateStr, [s]);
    }
  }
  return map;
}

/**
 * 세션 목록의 변경 감지용 SHA-256 해시.
 * sessionId + messageCount를 정렬 후 해시한다.
 */
export function computeDataHash(sessions: SessionGroup[]): string {
  const payload = sessions
    .map((s) => `${s.sessionId}:${s.messageCount}`)
    .sort()
    .join("|");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * 백필 범위 결정 — 체크포인트가 없으면 90일 전부터.
 */
export async function determineRange(
  storage: StorageAdapter,
): Promise<{ from: number; to: number; isFirstRun: boolean }> {
  const now = Date.now();
  const lastCheckpoint = await storage.getLastCheckpoint();

  if (lastCheckpoint == null) {
    // 첫 실행: 90일 전부터
    const d = new Date();
    d.setDate(d.getDate() - 90);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: now, isFirstRun: true };
  }

  // 체크포인트 날짜의 00:00부터
  const d = new Date(lastCheckpoint);
  d.setHours(0, 0, 0, 0);
  return { from: d.getTime(), to: now, isFirstRun: false };
}

/**
 * air 메인 오케스트레이터 — 날짜별 갈무리 + 변경 감지 + 백필
 */
export async function runAir(
  storage: StorageAdapter,
  options: AirOptions = {},
): Promise<AirResult> {
  const { from, to, isFirstRun } = await determineRange(storage);
  const historyPath = options.historyPath ?? getDefaultHistoryPath();

  // 1. 파싱 + 그룹핑 + 세션 JSONL 보강
  const entries = parseHistory({ historyPath, sinceTimestamp: from });
  const baseSessions = await groupFromStream(entries);
  const details = await enrichSessionsFromJsonl(baseSessions);

  // SessionDetail → SessionGroup 호환
  let sessions: SessionGroup[] = details.map((d) => ({
    ...d,
    messages: [],
    tags: [],
  }));

  // Scope 필터링 — project 모드면 해당 프로젝트 세션만
  if (options.scope?.mode === "project") {
    const scopePath = options.scope.path;
    sessions = sessions.filter((s) => s.project === scopePath);
  }

  // 2. 날짜별 그룹핑
  const byDate = groupSessionsByDate(sessions);

  // 3. 전체 날짜 범위 생성 (빈 날 포함)
  const allDates = generateDateRange(from, to);
  const changedDates: string[] = [];

  // 4. 각 날짜별 변경 감지 + upsert
  for (const dateStr of allDates) {
    const daySessions = byDate.get(dateStr) ?? [];
    const hash = computeDataHash(daySessions);

    // 기존 리포트와 해시 비교
    const existing = await storage.getGatherReportByDate(dateStr);
    if (existing && existing.dataHash === hash) {
      continue; // 변경 없음 — 스킵
    }

    // 세션 레코드 upsert
    if (daySessions.length > 0) {
      const records = daySessions.map(sessionGroupToRecord);
      await storage.upsertSessions(records);
    }

    // 날짜의 00:00 ~ 23:59:59 범위
    const dayStart = dateStrToEpoch(dateStr);
    const dayEnd = dayStart + 86400000 - 1;

    // 마크다운 리포트 생성
    const markdown =
      daySessions.length > 0
        ? generateMarkdownReport(daySessions, dayStart, dayEnd)
        : "# No activity\n";

    // conversationTurns 포함 JSON 생성
    const reportJson = JSON.stringify(
      daySessions.map((s) => ({
        sessionId: s.sessionId,
        projectName: s.projectName,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMinutes:
          s.durationMinutes ?? (s.endedAt - s.startedAt) / 60000,
        messageCount: s.messageCount,
        userMessageCount: s.userMessageCount ?? 0,
        assistantMessageCount: s.assistantMessageCount ?? 0,
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        totalTokens: (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
        model: s.model ?? "",
        title: s.title ?? s.summary,
        summary: s.summary,
        conversationTurns: s.conversationTurns ?? [],
      })),
    );

    const totalMessages = daySessions.reduce(
      (sum, s) => sum + s.messageCount,
      0,
    );
    const totalInputTokens = daySessions.reduce(
      (sum, s) => sum + (s.inputTokens ?? 0),
      0,
    );
    const totalOutputTokens = daySessions.reduce(
      (sum, s) => sum + (s.outputTokens ?? 0),
      0,
    );

    const report: GatherReport = {
      gatheredAt: Date.now(),
      fromTimestamp: dayStart,
      toTimestamp: dayEnd,
      sessionCount: daySessions.length,
      totalMessages,
      totalInputTokens,
      totalOutputTokens,
      reportMarkdown: markdown,
      reportJson,
      emailedAt: null,
      emailTo: null,
      reportDate: dateStr,
      dataHash: hash,
      updatedAt: Date.now(),
    };

    await storage.saveGatherReport(report);
    changedDates.push(dateStr);
  }

  // 5. 체크포인트 저장
  await storage.saveCheckpoint(to);

  // 6. D1 auto-sync (non-fatal) — 미동기화 데이터 전부 push
  try {
    const { loadD1Client, pushToD1 } = await import("../cloud/sync.js");
    const { ensureD1Schema } = await import("../cloud/d1-schema.js");
    const { hostname } = await import("node:os");
    const client = await loadD1Client(storage);
    if (client) {
      const machineId = await storage.getConfig("machine_id") ?? hostname();
      await ensureD1Schema(client);
      await pushToD1(storage, client, machineId);
      console.error("  ☁️  D1 sync complete");
    }
  } catch (err) {
    console.warn(`  ⚠️  D1 sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 백필 일수 계산
  const backfillDays = allDates.length;

  return {
    dates: allDates,
    totalSessions: sessions.length,
    isFirstRun,
    backfillDays,
    changedDates,
  };
}
