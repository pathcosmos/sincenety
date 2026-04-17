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

/** Auto-summary 실행 중 발생한 실패 정보 — runOut이 발송 스킵 판단에 사용. */
export interface CircleSummaryError {
  type: "weekly" | "monthly";
  error: string;
}

export interface CircleResult {
  airResult: AirResult;
  finalized: string[];
  needsSummary: string[];
  /** full 모드에서 autoSummarizeWeekly/Monthly가 throw한 경우 기록된다. */
  summaryErrors: CircleSummaryError[];
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
// (삭제됨) mergeSummariesByTitle — 휴리스틱 텍스트 결합 (outcomes.join("\n"),
// flows.join(" → "))으로 같은 프로젝트 여러 세션을 하나로 이어붙이던 함수.
// v0.8.8에서 제거. 같은 프로젝트 여러 세션은 각각 독립 카드로 보여준다 —
// AI로 생성된 개별 세션 요약의 신뢰성을 그대로 유지한다.
// ---------------------------------------------------------------------------

/** 세션 메타데이터를 포함한 요약 형태 (daily/weekly/monthly 공통). */
export interface SessionSummary extends CircleSaveSessionInput {
  messageCount?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMinutes?: number;
  model?: string;
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
 *
 * v0.8.9: 강제 재요약 범위를 **이번 주(월~오늘)**로 한정. 이전에는 이번 달까지
 * 포함했지만 매 실행마다 수십 일을 재요약하느라 출력/토큰 소비가 과도했다.
 * monthly 보고서는 발송 시점(월말)에 별도 경로로 갱신한다.
 */
export async function circleJson(
  storage: StorageAdapter,
  options?: CircleOptions & { summarize?: boolean },
): Promise<{ dates: string[]; sessions: Record<string, unknown[]> }> {
  const airResult = await runAir(storage, options);
  await finalizePreviousReports(storage, new Date());

  // 변경 감지된 날짜 ∪ 이번 주(월~오늘)
  const today = new Date();
  const forcedDates = new Set<string>(datesInCurrentWeekUpToToday(today));

  // gather 데이터가 있는 날짜만 유지 (빈 날은 드롭)
  const forcedWithData: string[] = [];
  for (const d of forcedDates) {
    const g = await storage.getGatherReportByDate(d);
    if (g?.reportJson) forcedWithData.push(d);
  }

  const allDates = Array.from(
    new Set<string>([...airResult.changedDates, ...forcedWithData]),
  ).sort();

  const sessions: Record<string, unknown[]> = {};

  for (const dateStr of allDates) {
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
    for (const dateStr of allDates) {
      const dateSessions = sessions[dateStr] as any[];
      if (!dateSessions?.length) continue;
      for (const s of dateSessions) {
        if (s.conversationTurns?.length) {
          s.conversationTurns = preprocessTurnsForClaudeCode(s.conversationTurns);
        }
        // SKILL.md용 머지 그룹 힌트 — 같은 프로젝트 내 유사 세션 판별
        const project = s.projectName ?? "";
        const topic = (s.title ?? s.summary ?? "").toLowerCase().trim().replace(/\s+/g, " ");
        s.mergeGroup = `${project}::${topic}`;
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

      for (const dateStr of allDates) {
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
    dates: allDates,
    sessions,
  };
}

/** 이번 주 월요일부터 오늘까지의 YYYY-MM-DD 날짜 목록. */
function datesInCurrentWeekUpToToday(today: Date): string[] {
  const { monday } = getWeekBoundary(today);
  const [my, mm, md] = monday.split("-").map(Number);
  const start = new Date(my, mm - 1, md);
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    dates.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
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

// ---------------------------------------------------------------------------
// (삭제됨) 휴리스틱 주간/월간 baseline 경로
// ---------------------------------------------------------------------------
// v0.8.6에서 daily 요약의 휴리스틱 fallback을 제거한 방향성과 일치시켜,
// v0.8.8에서 weekly/monthly baseline의 텍스트-머지 경로(summarizeRangeInto,
// autoSummarizeWeekly, autoSummarizeMonthly)를 전부 삭제했다.
// weekly/monthly는 이제 오직 skill의 `circle --save --type <type>` 경로로만
// 생성된다. Workers AI 기반 CLI rollup은 추후 별도 PR로 도입 예정.

/**
 * 변경된 날짜의 세션을 자동 요약.
 *
 * v0.8.6부터 휴리스틱 fallback 완전 제거. AI provider가
 * cloudflare 또는 anthropic으로 유효하게 구성되지 않으면
 * `assertAiReadyForCliPipeline`에서 즉시 throw → sincenety 전체 파이프라인 중단.
 *
 * 세션별 요약이 실패하면 그 날짜의 저장을 전체 취소하고 throw 전파.
 * "부분적으로 실패한 요약"을 절대 DB에 쓰지 않음.
 *
 * 크로스 디바이스: D1에서 다른 기기의 요약을 pull하여 통합 요약 생성.
 */
export async function autoSummarize(
  storage: StorageAdapter,
  changedDates: string[],
  forceDates?: Set<string>,
): Promise<number> {
  const { resolveAiProvider, loadAiProviderConfig, assertAiReadyForCliPipeline } =
    await import("./ai-provider.js");
  const { summarizeSession: summarize } = await import("./summarizer.js");

  // 진입 가드 — AI가 없으면 여기서 throw, 호출자(runCircle)가 전파.
  await assertAiReadyForCliPipeline(storage);

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
    // 이미 요약된 날짜 처리:
    //   - 발송 완료면 보호 (절대 덮어쓰지 않음)
    //   - forceDates에 포함되면 freshness 무관 재요약 (이번 주 항상 최신화)
    //   - 아니면 stale일 때만 재요약
    const existingReport = await storage.getDailyReport(date, "daily");
    if (existingReport?.summaryJson) {
      if (existingReport.emailedAt != null) continue;
      if (forceDates?.has(date)) {
        console.log(`  ♻️  ${date} re-summarizing (current week — forced refresh)`);
      } else {
        const freshness = await storage.getDailyReportFreshness(date, "daily");
        if (freshness && !freshness.stale) continue;
        console.log(`  ♻️  ${date} re-summarizing (gather updated after last summary)`);
      }
    }

    const report = await storage.getGatherReportByDate(date);
    if (!report?.reportJson) continue;

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
        // Cloudflare Workers AI 경로 — null 반환 시 AI 실패로 간주하고 throw
        const summary = await cfSummarize(cfConfig, s.projectName ?? "", turns);
        if (!summary) {
          throw new Error(
            `Workers AI 요약 실패 (date=${date}, session=${s.sessionId}, project=${s.projectName ?? "?"}). ` +
              "휴리스틱 fallback은 v0.8.6부터 제거됐습니다 — 부분적으로 실패한 요약을 DB에 쓰지 않습니다.",
          );
        }
        summaries.push({ sessionId: s.sessionId, projectName: s.projectName, ...summary });
        continue;
      }

      // Anthropic 경로: summarizer.ts가 실패 시 throw (더 이상 휴리스틱 fallback 없음)
      const result = await summarize(
        { ...s, conversationTurns: turns } as any,
        storage,
      );
      summaries.push({
        sessionId: s.sessionId,
        projectName: s.projectName ?? "",
        ...result,
      });
    }

    // 크로스 디바이스: 다른 기기의 이미 요약된 세션을 pull하여 머지
    // (네트워크/D1 flaky는 무시해도 로컬 요약 품질에 영향 없으므로 try/catch 유지)
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
          } catch (err) {
            console.warn(`  ⚠️ ${date}: remote 요약 JSON 파싱 실패 — ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (remoteCount > 0) {
          console.error(`  🔗 ${date}: ${remoteCount} sessions merged from other devices`);
        }
      } catch (err) {
        console.warn(`  ⚠️ ${date}: D1 pull 실패 (로컬 요약만 사용) — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // v0.8.8: 프로젝트 단위 휴리스틱 머지 제거. 같은 프로젝트에 여러 세션이
    // 있어도 각 세션의 AI 요약을 독립 항목으로 저장한다.
    if (summaries.length > 0) {
      // overview는 Workers AI로만 생성. 실패하거나 provider가 없으면 null —
      // 휴리스틱 "날짜 작업: topic1, topic2, ..." 폴백은 제거됨.
      let overview: string | null = null;
      if (cfConfig && cfOverview) {
        overview = await cfOverview(cfConfig, date, summaries as any);
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
  }

  return summarized;
}

/**
 * circle 메인 오케스트레이터 — air 실행 + finalize + 변경 날짜 목록 반환.
 * SKILL.md 흐름(--json/--save)이 아닌 경우, Cloudflare AI로 자동 요약.
 *
 * v0.8.8: `mode` 파라미터 제거. 휴리스틱 weekly/monthly baseline 재생성
 * 경로가 삭제되어 circle은 항상 daily만 처리한다.
 */
export async function runCircle(
  storage: StorageAdapter,
  options?: CircleOptions & {
    json?: boolean;
    save?: boolean;
    skipAutoSummarize?: boolean;
    /** #10 rerun: 강제 재요약할 날짜(YYYY-MM-DD) 목록. 발송본은 보호됨. */
    rerun?: string[];
    /** #2 claude-code provider일 때 needs_skill JSON으로 종료시킬 CLI 명령명 */
    needsSkillCommand?: string;
  },
): Promise<CircleResult> {
  // #10 rerun 처리 — autoSummarize 전에 지정 날짜 무효화하여 재생성 강제
  const rerunDates: string[] = [];
  if (options?.rerun && options.rerun.length > 0) {
    for (const d of options.rerun) {
      const ok = await storage.invalidateDailyReport(d, "daily");
      if (ok) {
        rerunDates.push(d);
        console.log(`  ♻️  ${d} invalidated for rerun`);
      } else {
        console.warn(`  ⚠️  ${d} skip rerun (not found or already emailed)`);
      }
    }
  }

  const airResult = await runAir(storage, options);

  // v0.8.9: 매 실행 시 **이번 주(월~오늘)** daily만 강제 재요약 (월 단위 제거).
  // 매 실행마다 이번 달 전체를 재요약하느라 토큰/시간 소비가 과도했던 문제를 해소.
  // gather 데이터가 있는 날짜만 대상. 발송 완료된 daily는 autoSummarize 내부에서 보호.
  const today = new Date();
  const forcedThisWeek = new Set<string>();
  for (const d of datesInCurrentWeekUpToToday(today)) {
    const g = await storage.getGatherReportByDate(d);
    if (g?.reportJson) forcedThisWeek.add(d);
  }

  // rerun 무효화 날짜 + 이번 주 daily를 changedDates에 병합
  const allChanged = Array.from(
    new Set<string>([
      ...airResult.changedDates,
      ...rerunDates,
      ...forcedThisWeek,
    ]),
  );
  const finalized = await finalizePreviousReports(storage, today);
  const summaryErrors: CircleSummaryError[] = [];

  // Auto-summarize (when not using SKILL.md --json/--save flow)
  if (!options?.json && !options?.save && !options?.skipAutoSummarize) {
    // AI 진입 가드 — provider 설정 불량이면 즉시 throw하여 sincenety 파이프라인 전체 중단
    const { assertAiReadyForCliPipeline } = await import("./ai-provider.js");
    await assertAiReadyForCliPipeline(storage, options?.needsSkillCommand);

    const summarized = await autoSummarize(storage, allChanged, forcedThisWeek);
    if (summarized > 0) {
      console.log(`  🤖 ${summarized} day(s) summarized`);
    }

    // v0.8.8: weekly/monthly baseline 자동 재생성 제거됨.
    // 휴리스틱 텍스트-머지로 고품질 요약이 되덮이는 문제를 막기 위해,
    // weekly/monthly는 이제 skill 경로의 `circle --save --type <type>`으로만
    // 생성된다. out*이 row를 못 찾으면 skill 안내 에러로 중단한다.
  }

  return {
    airResult,
    finalized,
    needsSummary: allChanged,
    summaryErrors,
  };
}
