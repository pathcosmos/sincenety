/**
 * circle (마무리) — Finalization + JSON Output + Save
 *
 * 이전 보고서를 finalize하고, 변경된 날짜의 세션 데이터를
 * JSON으로 출력하거나 daily_reports에 저장한다.
 */

import type { StorageAdapter, DailyReport } from "../storage/adapter.js";
import { runAir, type AirOptions, type AirResult } from "./air.js";
import type { CfAiConfig } from "../cloud/cf-ai.js";

// ---------------------------------------------------------------------------
// Text cleaning for claude-code JSON output (mirrors summarizer.ts clean())
// ---------------------------------------------------------------------------

/** XML/시스템 태그/파일 경로/파일명 제거 — 요약 품질 향상용 */
function cleanTurnText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/Caveat:.*?(?=[\n|]|$)/gi, "")
    .replace(/Base directory for this skill:.*?(?=[\n|]|$)/gi, "")
    .replace(/(?:\/(?:Users|Volumes|home|tmp|var|opt|etc|usr)\/)\S+/g, "")
    .replace(/(?:\.\.?\/)\S+/g, "")
    .replace(/\b[\w.-]+\.(?:ts|js|tsx|jsx|json|jsonl|md|yaml|yml|toml|css|html|sql|sh|py|go|rs)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 의미 없는 단답 턴 필터 */
const SKIP_INPUTS = new Set(["ok", "yes", "네", "응", "ㅇㅇ", "좋아", "됐어", "확인", "ㅇ", "ㅋ", "고마워", "감사", "알겠어"]);

function isSkipTurn(input: string): boolean {
  const cleaned = cleanTurnText(input);
  return cleaned.length <= 3 || SKIP_INPUTS.has(cleaned.toLowerCase());
}

/** conversationTurns를 claude-code용으로 전처리: clean + filter + truncate + limit 30 */
function preprocessTurnsForClaudeCode(
  turns: Array<{ userInput: string; assistantOutput: string; timestamp: number }>,
): Array<{ userInput: string; assistantOutput: string; timestamp: number }> {
  return turns
    .filter((t) => !isSkipTurn(t.userInput))
    .slice(0, 30)
    .map((t) => ({
      userInput: cleanTurnText(t.userInput).slice(0, 200),
      assistantOutput: cleanTurnText(t.assistantOutput).slice(0, 300),
      timestamp: t.timestamp,
    }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CircleOptions extends AirOptions {
  // 추가 옵션은 향후 확장
}

export interface CircleResult {
  airResult: AirResult;
  finalized: string[];
  needsSummary: string[];
}

export interface CircleSaveSessionInput {
  sessionId: string;
  projectName?: string;
  topic?: string;
  outcome?: string;
  flow?: string;
  significance?: string;
  nextSteps?: string;
}

export interface CircleSaveInput {
  date: string;
  type?: "daily" | "weekly" | "monthly";
  overview?: string;
  sessions: CircleSaveSessionInput[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** YYYY-MM-DD 문자열로 변환 (로컬 시간 기준) */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 주어진 날짜가 속한 주의 월요일~일요일 YYYY-MM-DD를 반환.
 * 주 = 월요일~일요일.
 */
export function getWeekBoundary(date: Date): { monday: string; sunday: string } {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0=일, 1=월, ..., 6=토
  const dayOfWeek = d.getDay();
  // 월요일까지의 offset (일요일이면 6일 전, 월요일이면 0일 전)
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    monday: toDateStr(monday),
    sunday: toDateStr(sunday),
  };
}

/**
 * 진행 상태 라벨 생성.
 */
export function getProgressLabel(
  _type: string,
  _date: Date,
  completed: number,
  total: number,
): string {
  return `in progress — ${completed}/${total} days`;
}

/**
 * 이전 보고서를 finalize 처리.
 * - 어제 daily가 in_progress면 finalized로 전환
 * - 월요일이면 지난주 weekly를 finalize
 * - 1일이면 전월 monthly를 finalize
 */
export async function finalizePreviousReports(
  storage: StorageAdapter,
  today: Date,
): Promise<string[]> {
  const finalized: string[] = [];

  // 어제 날짜
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);

  // 어제 daily report finalize
  const dailyReport = await storage.getDailyReport(yesterdayStr, "daily");
  if (dailyReport && dailyReport.status !== "finalized") {
    await storage.updateDailyReportStatus(yesterdayStr, "daily", "finalized");
    finalized.push(`daily:${yesterdayStr}`);
  }

  // 월요일이면 → 지난주 weekly finalize
  if (today.getDay() === 1) {
    const { monday } = getWeekBoundary(yesterday);
    const weeklyReport = await storage.getDailyReport(monday, "weekly");
    if (weeklyReport && weeklyReport.status !== "finalized") {
      await storage.updateDailyReportStatus(monday, "weekly", "finalized");
      finalized.push(`weekly:${monday}`);
    }
  }

  // 1일이면 → 전월 monthly finalize
  if (today.getDate() === 1) {
    const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const monthKey = toDateStr(prevMonth); // YYYY-MM-01
    const monthlyReport = await storage.getDailyReport(monthKey, "monthly");
    if (monthlyReport && monthlyReport.status !== "finalized") {
      await storage.updateDailyReportStatus(monthKey, "monthly", "finalized");
      finalized.push(`monthly:${monthKey}`);
    }
  }

  return finalized;
}

/**
 * air 실행 후 변경된 날짜의 세션 JSON을 추출하여 반환.
 */
export async function circleJson(
  storage: StorageAdapter,
  options?: CircleOptions & { summarize?: boolean },
): Promise<{ dates: string[]; sessions: Record<string, unknown[]> }> {
  const airResult = await runAir(storage, options);
  await finalizePreviousReports(storage, new Date());

  const sessions: Record<string, unknown[]> = {};

  for (const dateStr of airResult.changedDates) {
    const gatherReport = await storage.getGatherReportByDate(dateStr);
    if (gatherReport && gatherReport.reportJson) {
      try {
        sessions[dateStr] = JSON.parse(gatherReport.reportJson);
      } catch {
        sessions[dateStr] = [];
      }
    } else {
      sessions[dateStr] = [];
    }
  }

  // claude-code 경로: conversationTurns 전처리 (clean + filter + truncate + 30턴 제한)
  // --summarize 시에는 Workers AI가 자체 전처리하므로 스킵
  if (!options?.summarize) {
    for (const dateStr of airResult.changedDates) {
      const dateSessions = sessions[dateStr] as any[];
      if (!dateSessions?.length) continue;
      for (const s of dateSessions) {
        if (s.conversationTurns?.length) {
          s.conversationTurns = preprocessTurnsForClaudeCode(s.conversationTurns);
        }
      }
    }
  }

  // --summarize: Workers AI로 세션 요약을 JSON에 포함 (ai_provider가 cloudflare일 때만)
  if (options?.summarize) {
    const { resolveAiProvider, loadAiProviderConfig } = await import("./ai-provider.js");
    const provider = await resolveAiProvider(storage);
    const aiConfig = await loadAiProviderConfig(storage);
    if (provider === "cloudflare" && aiConfig.accountId && aiConfig.apiToken) {
      const { summarizeSession: cfSummarize, generateOverview } = await import("../cloud/cf-ai.js");
      const cfConfig: CfAiConfig = { accountId: aiConfig.accountId, apiToken: aiConfig.apiToken };

      for (const dateStr of airResult.changedDates) {
        const dateSessions = sessions[dateStr] as any[];
        if (!dateSessions?.length) continue;

        const summaries: any[] = [];
        for (const s of dateSessions) {
          const turns = s.conversationTurns ?? [];
          if (turns.length === 0) continue;
          const summary = await cfSummarize(cfConfig, s.projectName ?? "", turns);
          if (summary) {
            s.aiSummary = summary;
            summaries.push({ ...summary, sessionId: s.sessionId, projectName: s.projectName });
          }
        }

        if (summaries.length > 0) {
          const overview = await generateOverview(cfConfig, dateStr, summaries);
          // overview를 최상위에 첨부
          (sessions as any)[`${dateStr}_overview`] = overview;
        }
        console.log(`  🤖 ${dateStr} AI summary done (${summaries.length} sessions, Workers AI)`);
      }
    }
  }

  return {
    dates: airResult.changedDates,
    sessions,
  };
}

/**
 * AI 요약 결과를 daily_reports에 저장.
 * DB의 세션 통계(messageCount, totalTokens 등)와 요약 데이터를 머지한다.
 */
export async function circleSave(
  storage: StorageAdapter,
  input: CircleSaveInput,
): Promise<void> {
  const { date, type = "daily", sessions: inputSessions } = input;
  let { overview } = input;

  // DB에서 해당 날짜의 세션 통계 조회
  const dbSessions = await storage.getSessionsByDate(date);

  // 입력 세션과 DB 세션을 sessionId로 머지 (prefix 매칭 폴백으로 잘린 ID 방어)
  const mergedSessions = inputSessions.map((is) => {
    let dbSession = dbSessions.find((ds) => ds.id === is.sessionId);
    if (!dbSession && is.sessionId) {
      dbSession = dbSessions.find((ds) =>
        ds.id.startsWith(is.sessionId.slice(0, 12)) || is.sessionId.startsWith(ds.id.slice(0, 12)),
      );
    }
    // 실제 DB sessionId로 교정 (잘못된 ID가 들어와도 올바른 ID로 저장)
    const resolvedId = dbSession?.id ?? is.sessionId;
    return {
      sessionId: resolvedId,
      projectName: is.projectName ?? dbSession?.projectName ?? "",
      topic: is.topic ?? "",
      outcome: is.outcome ?? "",
      flow: is.flow ?? "",
      significance: is.significance ?? "",
      nextSteps: is.nextSteps ?? "",
      // DB 통계
      messageCount: dbSession?.messageCount ?? 0,
      totalTokens: dbSession?.totalTokens ?? 0,
      inputTokens: dbSession?.inputTokens ?? 0,
      outputTokens: dbSession?.outputTokens ?? 0,
      durationMinutes: dbSession?.durationMinutes ?? 0,
      model: dbSession?.model ?? "",
    };
  });

  // 집계
  const totalMessages = mergedSessions.reduce((s, m) => s + m.messageCount, 0);
  const totalTokens = mergedSessions.reduce((s, m) => s + m.totalTokens, 0);

  // 날짜 범위 (00:00 ~ 23:59:59)
  const [y, m, d] = date.split("-").map(Number);
  const periodFrom = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const periodTo = periodFrom + 86400000 - 1;

  // 휴가일 감지
  const { isVacationDay } = await import("../vacation/manager.js");
  const isVacation = await isVacationDay(storage, date);
  if (isVacation && mergedSessions.length === 0) {
    overview = overview ?? "[vacation]";
  }

  // 오늘이면 in_progress, 아니면 finalized
  const todayStr = toDateStr(new Date());
  const status = date === todayStr ? "in_progress" : "finalized";

  const report: DailyReport = {
    reportDate: date,
    reportType: type,
    periodFrom,
    periodTo,
    sessionCount: mergedSessions.length,
    totalMessages,
    totalTokens,
    summaryJson: JSON.stringify(mergedSessions),
    overview: overview ?? null,
    reportMarkdown: null,
    createdAt: Date.now(),
    emailedAt: null,
    emailTo: null,
    status,
    progressLabel: null,
    dataHash: null,
  };

  await storage.saveDailyReport(report);
}

/**
 * 변경된 날짜의 세션을 자동 요약.
 * 모든 ai_provider에서 동작 — cloudflare는 Workers AI, 그 외는 heuristic/API.
 * claude-code 모드에서도 heuristic 요약을 baseline으로 저장하여
 * SKILL.md circle --save로 Claude Code가 덮어쓰기 전까지 최소한의 요약을 보장.
 *
 * 크로스 디바이스: D1에서 다른 기기의 요약을 pull하여 통합 요약 생성.
 */
export async function autoSummarize(
  storage: StorageAdapter,
  changedDates: string[],
): Promise<number> {
  const { resolveAiProvider, loadAiProviderConfig } = await import("./ai-provider.js");
  const { summarizeSession: summarize } = await import("./summarizer.js");
  const provider = await resolveAiProvider(storage);

  // Cloudflare Workers AI 설정 (cloudflare일 때만)
  let cfConfig: CfAiConfig | null = null;
  let cfSummarize: typeof import("../cloud/cf-ai.js").summarizeSession | null = null;
  let cfOverview: typeof import("../cloud/cf-ai.js").generateOverview | null = null;
  if (provider === "cloudflare") {
    const aiConfig = await loadAiProviderConfig(storage);
    if (aiConfig.accountId && aiConfig.apiToken) {
      const cfAi = await import("../cloud/cf-ai.js");
      cfConfig = { accountId: aiConfig.accountId, apiToken: aiConfig.apiToken };
      cfSummarize = cfAi.summarizeSession;
      cfOverview = cfAi.generateOverview;
    }
  }

  // D1 클라이언트 로드 (크로스 디바이스 세션 pull용)
  let d1Client: import("../cloud/d1-client.js").D1Client | null = null;
  let machineId = "";
  try {
    const { loadD1Client, getAutoMachineId } = await import("../cloud/sync.js");
    d1Client = await loadD1Client(storage);
    if (d1Client) {
      machineId = await getAutoMachineId(storage);
    }
  } catch {
    // D1 미설정 시 로컬 전용
  }

  let summarized = 0;

  for (const date of changedDates) {
    // 이미 요약된 날짜는 스킵 (SKILL.md circle --save 등으로 저장된 경우)
    const existingReport = await storage.getDailyReport(date, "daily");
    if (existingReport?.summaryJson) continue;

    const report = await storage.getGatherReportByDate(date);
    if (!report?.reportJson) continue;

    try {
      const sessions = JSON.parse(report.reportJson);
      const summaries: Array<{
        sessionId: string;
        projectName: string;
        topic: string;
        outcome: string;
        flow: string;
        significance: string;
        nextSteps?: string;
      }> = [];

      for (const s of sessions) {
        const turns = s.conversationTurns ?? [];

        if (cfConfig && cfSummarize && turns.length > 0) {
          // Cloudflare Workers AI 경로
          const summary = await cfSummarize(cfConfig, s.projectName ?? "", turns);
          if (summary) {
            summaries.push({ sessionId: s.sessionId, projectName: s.projectName, ...summary });
            continue;
          }
        }

        // 전 provider 공통: summarizer.ts 경유 (anthropic API 또는 heuristic)
        const fallback = await summarize(
          { ...s, conversationTurns: turns } as any,
          storage,
        );
        summaries.push({
          sessionId: s.sessionId,
          projectName: s.projectName ?? "",
          ...fallback,
        });
      }

      // 크로스 디바이스: 다른 기기의 이미 요약된 세션을 pull하여 머지
      if (d1Client && machineId) {
        try {
          const { pullCrossDeviceReports } = await import("../cloud/sync.js");
          const remoteReports = await pullCrossDeviceReports(d1Client, machineId, date, "daily");
          const localIds = new Set(summaries.map((s) => s.sessionId));
          let remoteCount = 0;
          for (const remote of remoteReports) {
            try {
              const remoteSessions = JSON.parse(remote.summaryJson || "[]");
              for (const rs of remoteSessions) {
                const rsId = rs.sessionId ?? "";
                if (rsId && !localIds.has(rsId)) {
                  summaries.push({
                    sessionId: rsId,
                    projectName: rs.projectName ?? "",
                    topic: rs.topic ?? "",
                    outcome: rs.outcome ?? "",
                    flow: rs.flow ?? "",
                    significance: rs.significance ?? "",
                    nextSteps: rs.nextSteps ?? "",
                  });
                  localIds.add(rsId);
                  remoteCount++;
                }
              }
            } catch {
              // 개별 리모트 파싱 실패 무시
            }
          }
          if (remoteCount > 0) {
            console.error(`  🔗 ${date}: ${remoteCount} sessions merged from other devices`);
          }
        } catch {
          // D1 pull 실패 시 로컬 전용
        }
      }

      if (summaries.length > 0) {
        let overview: string | null = null;
        if (cfConfig && cfOverview) {
          overview = await cfOverview(cfConfig, date, summaries);
        } else {
          // heuristic overview: 세션 topic 요약
          const topics = summaries.map((s) => s.topic).filter(Boolean);
          overview = topics.length > 0
            ? `${date} 작업: ${topics.join(", ")}`
            : null;
        }

        await circleSave(storage, {
          date,
          type: "daily",
          overview: overview ?? undefined,
          sessions: summaries,
        });
        summarized++;
        const providerLabel = cfConfig ? "Cloudflare AI" : provider;
        console.log(`  🤖 ${date} summary done (${summaries.length} sessions, ${providerLabel})`);
      }
    } catch (err) {
      console.warn(`  ⚠️ ${date} summary failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summarized;
}

/**
 * circle 메인 오케스트레이터 — air 실행 + finalize + 변경 날짜 목록 반환.
 * SKILL.md 흐름(--json/--save)이 아닌 경우, Cloudflare AI로 자동 요약.
 */
export async function runCircle(
  storage: StorageAdapter,
  options?: CircleOptions & { json?: boolean; save?: boolean; skipAutoSummarize?: boolean },
): Promise<CircleResult> {
  const airResult = await runAir(storage, options);
  const finalized = await finalizePreviousReports(storage, new Date());

  // Auto-summarize with Cloudflare AI (when not using SKILL.md flow)
  if (!options?.json && !options?.save && !options?.skipAutoSummarize) {
    const summarized = await autoSummarize(storage, airResult.changedDates);
    if (summarized > 0) {
      console.log(`  🤖 ${summarized} day(s) summarized`);
    }
  }

  return {
    airResult,
    finalized,
    needsSummary: airResult.changedDates,
  };
}
