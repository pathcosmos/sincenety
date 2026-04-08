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
  return `진행중 — ${completed}/${total}일`;
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

  // --summarize: Workers AI로 세션 요약을 JSON에 포함
  if (options?.summarize) {
    const { loadAiProviderConfig } = await import("./ai-provider.js");
    const aiConfig = await loadAiProviderConfig(storage);
    if (aiConfig.accountId && aiConfig.apiToken) {
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
        console.log(`  🤖 ${dateStr} AI 요약 완료 (${summaries.length}세션, Workers AI)`);
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

  // 입력 세션과 DB 세션을 sessionId로 머지
  const mergedSessions = inputSessions.map((is) => {
    const dbSession = dbSessions.find((ds) => ds.id === is.sessionId);
    return {
      sessionId: is.sessionId,
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
    overview = overview ?? "[휴가]";
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
 * Cloudflare Workers AI로 변경된 날짜의 세션을 자동 요약.
 * D1 토큰(d1_account_id + d1_api_token)이 설정되어 있을 때만 동작.
 */
export async function autoSummarize(
  storage: StorageAdapter,
  changedDates: string[],
): Promise<number> {
  // Check if Cloudflare AI is available
  const [accountId, apiToken] = await Promise.all([
    storage.getConfig("d1_account_id"),
    storage.getConfig("d1_api_token"),
  ]);
  if (!accountId || !apiToken) return 0;

  const { summarizeSession, generateOverview } = await import("../cloud/cf-ai.js");
  const config: CfAiConfig = { accountId, apiToken };
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
        if (turns.length === 0) continue;

        const summary = await summarizeSession(config, s.projectName ?? "", turns);
        if (summary) {
          summaries.push({
            sessionId: s.sessionId,
            projectName: s.projectName,
            ...summary,
          });
        }
      }

      if (summaries.length > 0) {
        const overview = await generateOverview(config, date, summaries);
        await circleSave(storage, {
          date,
          type: "daily",
          overview: overview ?? undefined,
          sessions: summaries,
        });
        summarized++;
        console.log(`  🤖 ${date} AI 요약 완료 (${summaries.length}세션, Cloudflare AI)`);
      }
    } catch (err) {
      console.warn(`  ⚠️ ${date} AI 요약 실패: ${err instanceof Error ? err.message : String(err)}`);
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
      console.log(`  🤖 Cloudflare AI: ${summarized}일 요약 완료`);
    }
  }

  return {
    airResult,
    finalized,
    needsSummary: airResult.changedDates,
  };
}
