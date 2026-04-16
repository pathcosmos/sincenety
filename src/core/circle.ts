/**
 * circle (마무리) — Finalization + JSON Output + Save
 *
 * 이전 보고서를 finalize하고, 변경된 날짜의 세션 데이터를
 * JSON으로 출력하거나 daily_reports에 저장한다.
 */

import type { StorageAdapter, DailyReport } from "../storage/adapter.js";
import { runAir, type AirOptions, type AirResult } from "./air.js";
import type { CfAiConfig } from "../cloud/cf-ai.js";
import type { PipelineMode } from "./out.js";

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
// mergeSummariesByTitle — 동일 프로젝트+제목 세션 통합 요약
// ---------------------------------------------------------------------------

/** 제목 정규화: 소문자, 공백 정리, 프로젝트명 접미사/슬래시 커맨드 제거 */
function normalizeTitle(title: string, projectName: string): string {
  let t = title.toLowerCase().trim();
  const pn = projectName.toLowerCase();
  if (pn && t.endsWith(pn)) {
    t = t.slice(0, -pn.length).trim();
  }
  t = t.replace(/^\/\S+\s*/, "").trim();
  t = t.replace(/\s+/g, " ");
  return t;
}

export interface MergedSummary extends CircleSaveSessionInput {
  messageCount?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMinutes?: number;
  model?: string;
  mergedCount?: number;
}

/**
 * 동일 프로젝트 세션을 머지하여 프로젝트별 1개 항목으로 통합한다.
 * - projectName 기준 그룹핑
 * - 2+ 그룹: 통계 합산, flow " → " 연결, significance 최장 채택
 * - 제목에 "(×N)" 표시
 */
export function mergeSummariesByTitle(sessions: MergedSummary[]): MergedSummary[] {
  if (sessions.length <= 1) return sessions;

  const groups = new Map<string, MergedSummary[]>();
  for (const s of sessions) {
    const key = s.projectName ?? "";
    const group = groups.get(key);
    if (group) {
      group.push(s);
    } else {
      groups.set(key, [s]);
    }
  }

  const merged: MergedSummary[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    const first = group[0];
    const last = group[group.length - 1];
    const n = group.length;

    // flow: 각 세션의 flow를 " → "로 연결
    const flows = group
      .map((s) => s.flow)
      .filter((f): f is string => !!f && f.length > 0);

    // significance: 가장 긴 것 채택
    let longestSig = "";
    for (const s of group) {
      if ((s.significance?.length ?? 0) > longestSig.length) {
        longestSig = s.significance ?? "";
      }
    }

    // outcome: 줄바꿈으로 연결
    const outcomes = group
      .map((s) => s.outcome)
      .filter((o): o is string => !!o && o.length > 0);

    const m: MergedSummary = {
      sessionId: first.sessionId,
      projectName: first.projectName,
      topic: `${first.topic} (×${n})`,
      outcome: outcomes.join("\n"),
      flow: flows.join(" → "),
      significance: longestSig,
      nextSteps: last.nextSteps,
      messageCount: group.reduce((sum, s) => sum + (s.messageCount ?? 0), 0),
      totalTokens: group.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0),
      inputTokens: group.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0),
      outputTokens: group.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0),
      durationMinutes: group.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
      model: first.model,
      mergedCount: n,
    };

    merged.push(m);
  }

  return merged;
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
        // SKILL.md용 머지 그룹 힌트
        const project = s.projectName ?? "";
        const topic = s.title ?? s.summary ?? "";
        s.mergeGroup = `${project}::${normalizeTitle(topic, project)}`;
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

// ---------------------------------------------------------------------------
// autoSummarizeWeekly / autoSummarizeMonthly
// ---------------------------------------------------------------------------

/**
 * 주어진 날짜 범위의 daily_reports를 모아서 weekly/monthly row로 upsert.
 *
 * - 해당 기간의 daily 리포트 수집
 * - summaryJson 내 세션들을 flatten
 * - mergeSummariesByTitle로 프로젝트 단위 통합
 * - 집계(totalMessages, totalTokens, sessionCount)
 * - 기존 row가 emailedAt != null이면 스킵 (발송된 보고서 보호)
 * - 기존 row가 미발송이면 덮어쓰기 (upsert)
 *
 * 두 호출자(autoSummarizeWeekly/Monthly)가 `today`로부터 range를 파생하므로,
 * `today`는 구조적으로 항상 [rangeFrom, rangeTo] 안. status는 항상 "in_progress"이며
 * 기간 종료 후 `finalizePreviousReports`가 별도로 "finalized"로 전환한다.
 *
 * overview는 baseline heuristic (topic 나열). Claude Code가 SKILL.md 흐름으로
 * 고품질 overview를 덮어쓰기 전까지 최소 수준의 요약을 보장한다.
 */
async function summarizeRangeInto(
  storage: StorageAdapter,
  type: "weekly" | "monthly",
  rangeFrom: string, // YYYY-MM-DD inclusive
  rangeTo: string,   // YYYY-MM-DD inclusive
  reportDate: string, // weekly=monday, monthly=1st
): Promise<boolean> {
  // 1. 기존 발송된 보고서면 건드리지 않음
  // emailedAt 필드가 존재(= not null)하기만 하면 발송된 것으로 간주.
  // 단순 `existing?.emailedAt` 체크는 emailedAt === 0에 대해 falsy로 빠져
  // 덮어쓰기 사고 가능성이 있어 명시적 null 비교 사용.
  const existing = await storage.getDailyReport(reportDate, type);
  if (existing && existing.emailedAt != null) return false;

  // 2. 기간 내 daily 리포트 모음
  const dailies = await storage.getDailyReportsByRange(rangeFrom, rangeTo, "daily");
  if (dailies.length === 0) return false;

  // 3. 모든 daily의 summaryJson을 flatten
  // JSON.parse 실패는 경고로 드러내되(언더카운트가 조용히 발생하지 않도록),
  // 다른 예외는 bare catch로 숨기지 말고 re-throw.
  const allSessions: MergedSummary[] = [];
  for (const d of dailies) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(d.summaryJson || "[]");
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.warn(
          `  ⚠️  ${type} aggregation: skipping daily ${d.reportDate} — summaryJson JSON parse failed: ${err.message}`,
        );
        continue;
      }
      throw err;
    }
    if (!Array.isArray(parsed)) continue;
    for (const s of parsed as Array<Record<string, unknown>>) {
      allSessions.push({
        sessionId: (s.sessionId as string) ?? "",
        projectName: (s.projectName as string) ?? "",
        topic: (s.topic as string) ?? "",
        outcome: (s.outcome as string) ?? "",
        flow: (s.flow as string) ?? "",
        significance: (s.significance as string) ?? "",
        nextSteps: (s.nextSteps as string) ?? "",
        messageCount: (s.messageCount as number) ?? 0,
        totalTokens: (s.totalTokens as number) ?? 0,
        inputTokens: (s.inputTokens as number) ?? 0,
        outputTokens: (s.outputTokens as number) ?? 0,
        durationMinutes: (s.durationMinutes as number) ?? 0,
        model: (s.model as string) ?? "",
      });
    }
  }

  if (allSessions.length === 0) return false;

  // 4. 프로젝트 단위 통합 (이미 daily 내부에서 머지됐더라도, 다른 일자의 같은 프로젝트를 합침)
  const mergedSessions = mergeSummariesByTitle(allSessions);

  // 5. 집계
  const totalMessages = mergedSessions.reduce((s, m) => s + (m.messageCount ?? 0), 0);
  const totalTokens = mergedSessions.reduce((s, m) => s + (m.totalTokens ?? 0), 0);

  // 6. 기간 경계 타임스탬프
  const [fy, fm, fd] = rangeFrom.split("-").map(Number);
  const [ty, tm, td] = rangeTo.split("-").map(Number);
  const periodFrom = new Date(fy, fm - 1, fd, 0, 0, 0, 0).getTime();
  const periodTo = new Date(ty, tm - 1, td, 23, 59, 59, 999).getTime();

  // 7. status — 호출자가 today로부터 range를 파생하므로 항상 in_progress.
  // 기간 종료 후 전환은 `finalizePreviousReports`가 담당한다.
  const status = "in_progress";

  // 8. overview (heuristic baseline — SKILL.md가 덮어쓸 수 있음)
  const typeLabel = type === "weekly" ? "주간" : "월간";
  const topics = mergedSessions.map((s) => s.topic).filter(Boolean);
  const overview = topics.length > 0
    ? `${reportDate} ${typeLabel} 요약 초안: ${topics.join(", ")}`
    : null;

  const report: DailyReport = {
    reportDate,
    reportType: type,
    periodFrom,
    periodTo,
    sessionCount: mergedSessions.length,
    totalMessages,
    totalTokens,
    summaryJson: JSON.stringify(mergedSessions),
    overview,
    reportMarkdown: null,
    createdAt: Date.now(),
    emailedAt: null,
    emailTo: null,
    status,
    progressLabel: null,
    dataHash: null,
  };

  await storage.saveDailyReport(report);
  return true;
}

/**
 * 이번 주(월~일)의 daily_reports를 모아서 weekly row로 upsert.
 * 발송된 weekly는 건드리지 않음. 매번 실행 시 baseline 최신화.
 */
export async function autoSummarizeWeekly(
  storage: StorageAdapter,
  today: Date,
): Promise<boolean> {
  const { monday, sunday } = getWeekBoundary(today);
  return summarizeRangeInto(storage, "weekly", monday, sunday, monday);
}

/**
 * 이번 달(1일~말일)의 daily_reports를 모아서 monthly row로 upsert.
 * 발송된 monthly는 건드리지 않음. 매번 실행 시 baseline 최신화.
 */
export async function autoSummarizeMonthly(
  storage: StorageAdapter,
  today: Date,
): Promise<boolean> {
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-based
  const firstStr = toDateStr(new Date(year, month, 1));
  const lastDay = new Date(year, month + 1, 0); // 다음 달 0일 = 이번 달 마지막 날
  const lastStr = toDateStr(lastDay);
  return summarizeRangeInto(storage, "monthly", firstStr, lastStr, firstStr);
}

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
    // 이미 요약된 날짜는 스킵 (SKILL.md circle --save 등으로 저장된 경우)
    const existingReport = await storage.getDailyReport(date, "daily");
    if (existingReport?.summaryJson) continue;

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

    // 동일 제목 세션 통합 (개별 요약 → 재요약)
    const mergedSummaries = mergeSummariesByTitle(summaries);
    const mergeCount = summaries.length - mergedSummaries.length;
    if (mergeCount > 0) {
      console.log(`  🔗 ${date}: ${summaries.length} sessions → ${mergedSummaries.length} (${mergeCount} merged)`);
    }

    if (mergedSummaries.length > 0) {
      let overview: string | null = null;
      if (cfConfig && cfOverview) {
        // Workers AI overview 실패 시 null 반환 — null이면 세션 topic 조립으로 폴백
        overview = await cfOverview(cfConfig, date, mergedSummaries as any);
      }
      // overview 없으면 세션 topic만 조합 (AI 요약 결과를 조합한 것이므로 휴리스틱 아님)
      if (!overview) {
        const topics = mergedSummaries.map((s) => s.topic).filter(Boolean);
        overview = topics.length > 0 ? `${date} 작업: ${topics.join(", ")}` : null;
      }

      await circleSave(storage, {
        date,
        type: "daily",
        overview: overview ?? undefined,
        sessions: mergedSummaries,
      });
      summarized++;
      const providerLabel = cfConfig ? "Cloudflare AI" : provider;
      console.log(`  🤖 ${date} summary done (${mergedSummaries.length} sessions, ${providerLabel})`);
    }
  }

  return summarized;
}

/**
 * circle 메인 오케스트레이터 — air 실행 + finalize + 변경 날짜 목록 반환.
 * SKILL.md 흐름(--json/--save)이 아닌 경우, Cloudflare AI로 자동 요약.
 *
 * @param options.mode
 *   - "full" (기본): daily autoSummarize 이후 weekly/monthly도 매번 재생성
 *     (이번 주/이번 달 baseline 최신화, 발송된 보고서는 건드리지 않음)
 *   - "smart": 기존 동작 — daily만 요약, weekly/monthly는 out 레벨의
 *     요일 트리거 및 catchup에 맡김 (토큰 절약 모드)
 */
export async function runCircle(
  storage: StorageAdapter,
  options?: CircleOptions & {
    json?: boolean;
    save?: boolean;
    skipAutoSummarize?: boolean;
    mode?: PipelineMode;
  },
): Promise<CircleResult> {
  const airResult = await runAir(storage, options);
  const finalized = await finalizePreviousReports(storage, new Date());
  const summaryErrors: CircleSummaryError[] = [];

  // Auto-summarize (when not using SKILL.md --json/--save flow)
  if (!options?.json && !options?.save && !options?.skipAutoSummarize) {
    // AI 진입 가드 — provider 설정 불량이면 즉시 throw하여 sincenety 파이프라인 전체 중단
    const { assertAiReadyForCliPipeline } = await import("./ai-provider.js");
    await assertAiReadyForCliPipeline(storage);

    const summarized = await autoSummarize(storage, airResult.changedDates);
    if (summarized > 0) {
      console.log(`  🤖 ${summarized} day(s) summarized`);
    }

    // Full mode: weekly/monthly baseline 재생성 — 매번 덮어쓰되 발송본은 보호.
    // 각 타입의 실패는 summaryErrors에 기록되고, runOut이 해당 타입 발송을
    // 스킵하여 stale baseline 위 발송을 방지한다.
    const mode = options?.mode ?? "full";
    if (mode === "full") {
      const today = new Date();
      try {
        const wrote = await autoSummarizeWeekly(storage, today);
        if (wrote) console.log(`  📅 weekly baseline refreshed`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  weekly auto-summary failed: ${msg}`);
        summaryErrors.push({ type: "weekly", error: msg });
      }
      try {
        const wrote = await autoSummarizeMonthly(storage, today);
        if (wrote) console.log(`  📆 monthly baseline refreshed`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠️  monthly auto-summary failed: ${msg}`);
        summaryErrors.push({ type: "monthly", error: msg });
      }
    }
  }

  return {
    airResult,
    finalized,
    needsSummary: airResult.changedDates,
    summaryErrors,
  };
}
