/**
 * out — smart dispatch with weekday/catchup logic
 *
 * 보고서 유형(daily/weekly/monthly)을 요일과 미발송 상태에 따라 자동 결정하고,
 * 렌더링 → 발송 → DB 업데이트까지 수행한다.
 */

import type { StorageAdapter } from "../storage/adapter.js";
import { runCircle } from "./circle.js";
import { getWeekBoundary } from "./circle.js";
import { renderDailyEmail, type RenderedEmail } from "../email/renderer.js";
import { sendEmail } from "../email/provider.js";
import type { SessionData } from "../email/template.js";
import type { D1Client } from "../cloud/d1-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutOptions {
  /** 특정 보고서 타입만 강제 발송 */
  force?: "daily" | "weekly" | "monthly";
  /** 렌더링만 수행 (JSON stdout, Gmail MCP 등 외부 연동용) */
  renderOnly?: boolean;
  /** 터미널에 미리보기만 출력 (발송하지 않음) */
  preview?: boolean;
  /** 갈무리 범위: global(전체) 또는 project(특정 프로젝트만) */
  scope?: import("../config/scope.js").ScopeConfig;
  /** 대상 날짜 (yyyyMMdd, e.g. "20260409") — 미지정 시 오늘 */
  date?: string;
}

export interface OutResultEntry {
  type: "daily" | "weekly" | "monthly";
  dateKey: string;
  status: "sent" | "skipped" | "rendered" | "previewed" | "error";
  error?: string;
}

export interface OutResult {
  sent: number;
  skipped: number;
  errors: number;
  entries: OutResultEntry[];
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

/** yyyyMMdd → Date (로컬 자정). 유효하지 않으면 throw. */
export function parseDateArg(raw: string): Date {
  if (!/^\d{8}$/.test(raw)) {
    throw new Error(`Invalid date format: "${raw}" (expected yyyyMMdd, e.g. 20260409)`);
  }
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6)) - 1;
  const d = Number(raw.slice(6, 8));
  const date = new Date(y, m, d);
  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) {
    throw new Error(`Invalid date: "${raw}" does not represent a valid calendar date`);
  }
  return date;
}

/**
 * 해당 월의 마지막 날인지 판별
 */
export function isLastDayOfMonth(date: Date): boolean {
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return nextDay.getDate() === 1;
}

/**
 * 보고서 유형에 따른 date key 결정
 * - daily  → 오늘 YYYY-MM-DD
 * - weekly → 이번 주 월요일 YYYY-MM-DD
 * - monthly → 이번 달 1일 YYYY-MM-01
 */
export function getReportDateKey(
  type: "daily" | "weekly" | "monthly",
  today: Date,
): string {
  switch (type) {
    case "daily":
      return toDateStr(today);
    case "weekly": {
      const { monday } = getWeekBoundary(today);
      return monday;
    }
    case "monthly": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return toDateStr(first);
    }
  }
}

/**
 * 미발송 보고서 탐색 (catchup)
 *
 * - 지난주 weekly: finalized + emailedAt 없음 → unsent
 * - 전월 monthly: finalized + emailedAt 없음 → unsent
 */
export async function findUnsentReports(
  storage: StorageAdapter,
  today: Date,
): Promise<string[]> {
  const unsent: string[] = [];

  // 지난주 월요일 weekly
  const lastWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const { monday: lastWeekMonday } = getWeekBoundary(lastWeek);
  const weeklyReport = await storage.getDailyReport(lastWeekMonday, "weekly");
  if (weeklyReport && weeklyReport.status === "finalized" && !weeklyReport.emailedAt) {
    unsent.push("weekly");
  }

  // 전월 1일 monthly
  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const monthKey = toDateStr(prevMonth);
  const monthlyReport = await storage.getDailyReport(monthKey, "monthly");
  if (monthlyReport && monthlyReport.status === "finalized" && !monthlyReport.emailedAt) {
    unsent.push("monthly");
  }

  return unsent;
}

/**
 * 요일 + 미발송 상태를 기반으로 발송할 보고서 유형 결정
 *
 * - 항상 "daily" 포함
 * - 금요일(day===5) 또는 unsentTypes에 "weekly" → "weekly" 추가
 * - 월말 또는 unsentTypes에 "monthly" → "monthly" 추가
 * - 중복 제거
 */
export function determineReportTypes(
  today: Date,
  unsentTypes: string[],
): string[] {
  const types = new Set<string>(["daily"]);

  if (today.getDay() === 5 || unsentTypes.includes("weekly")) {
    types.add("weekly");
  }

  if (isLastDayOfMonth(today) || unsentTypes.includes("monthly")) {
    types.add("monthly");
  }

  return Array.from(types);
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * out 메인 — circle 실행 후 보고서 유형 결정 → 렌더링 → 발송
 */
export async function runOut(
  storage: StorageAdapter,
  options?: OutOptions,
): Promise<OutResult> {
  const result: OutResult = { sent: 0, skipped: 0, errors: 0, entries: [] };

  // 1. circle 실행으로 데이터 최신화
  // autoSummarize 내부에서 기존 daily_report가 있으면 스킵하므로 이중 요약 방지됨
  await runCircle(storage, { scope: options?.scope });

  const today = options?.date ? parseDateArg(options.date) : new Date();

  // 1.1. D1 pre-sync (내 데이터 먼저 올려서 다른 기기가 참조 가능하게)
  let d1Client: D1Client | null = null;
  let machineId = "";
  if (!options?.preview && !options?.renderOnly) {
    try {
      const { loadD1Client, pushToD1, getAutoMachineId } = await import("../cloud/sync.js");
      const { ensureD1Schema } = await import("../cloud/d1-schema.js");
      d1Client = await loadD1Client(storage);
      if (d1Client) {
        machineId = await getAutoMachineId(storage);
        await ensureD1Schema(d1Client);
        await pushToD1(storage, d1Client, machineId);
        console.error("  ☁️  D1 sync complete");
      }
    } catch (err) {
      console.warn(`  ⚠️  D1 pre-sync failed: ${err instanceof Error ? err.message : String(err)}`);
      d1Client = null;
    }
  }

  // 1.5. 휴가일 체크 — force가 아니면 스킵
  if (!options?.force) {
    const { isVacationDay } = await import("../vacation/manager.js");
    const todayStr = today.toISOString().slice(0, 10);
    if (await isVacationDay(storage, todayStr)) {
      console.log("  📅 Today is a vacation day. Skipping send.");
      console.log("  (Force send: sincenety outd)");
      return result;
    }
  }

  // 2. 발송할 보고서 유형 결정
  let reportTypes: string[];

  if (options?.force) {
    reportTypes = [options.force];
  } else {
    const unsent = await findUnsentReports(storage, today);
    reportTypes = determineReportTypes(today, unsent);
  }

  // 3. 각 유형별 렌더링 → 발송
  const renderOnlyResults: RenderedEmail[] = [];

  for (const type of reportTypes) {
    const reportType = type as "daily" | "weekly" | "monthly";
    const dateKey = getReportDateKey(reportType, today);

    // 3.1. 크로스 디바이스: 다른 기기의 세션 데이터 수집 (발신은 항상 수행)
    let crossDeviceSessions: SessionData[] | undefined;
    if (d1Client && machineId) {
      try {
        const { pullCrossDeviceReports } = await import("../cloud/sync.js");
        const remoteReports = await pullCrossDeviceReports(d1Client, machineId, dateKey, reportType);
        if (remoteReports.length > 0) {
          crossDeviceSessions = [];
          for (const remote of remoteReports) {
            try {
              const remoteSessions = JSON.parse(remote.summaryJson || "[]");
              for (const rs of remoteSessions) {
                crossDeviceSessions.push({
                  sessionId: rs.sessionId ?? "",
                  projectName: rs.projectName ?? rs.project ?? "",
                  startedAt: rs.startedAt ?? 0,
                  endedAt: rs.endedAt ?? 0,
                  durationMinutes: rs.durationMinutes ?? 0,
                  messageCount: rs.messageCount ?? 0,
                  userMessageCount: rs.userMessageCount ?? 0,
                  assistantMessageCount: rs.assistantMessageCount ?? 0,
                  inputTokens: rs.inputTokens ?? 0,
                  outputTokens: rs.outputTokens ?? 0,
                  totalTokens: rs.totalTokens ?? 0,
                  title: rs.topic ?? rs.title ?? "",
                  summary: rs.topic ?? rs.title ?? "",
                  description: rs.outcome ?? rs.description ?? "",
                  model: rs.model ?? "",
                  category: rs.category ?? "",
                  actions: [],
                  wrapUp: rs.outcome
                    ? { outcome: rs.outcome, significance: rs.significance ?? "", flow: rs.flow, nextSteps: rs.nextSteps }
                    : undefined,
                });
              }
            } catch {
              // 개별 리모트 파싱 실패 무시
            }
          }
          if (crossDeviceSessions.length > 0) {
            console.error(`  🔗 ${crossDeviceSessions.length} sessions merged from other devices`);
          }
        }
      } catch {
        // 크로스 디바이스 pull 실패 시 로컬 전용
      }
    }

    let rendered: RenderedEmail | null;
    try {
      rendered = await renderDailyEmail(storage, dateKey, reportType, crossDeviceSessions);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors++;
      result.entries.push({ type: reportType, dateKey, status: "error", error: message });
      continue;
    }

    if (!rendered) {
      result.skipped++;
      result.entries.push({ type: reportType, dateKey, status: "skipped" });
      continue;
    }

    // renderOnly → 결과 수집 (루프 종료 후 단일 JSON 출력)
    if (options?.renderOnly) {
      renderOnlyResults.push(rendered);
      result.entries.push({ type: reportType, dateKey, status: "rendered" });
      continue;
    }

    // preview → 터미널 요약
    if (options?.preview) {
      const sizeKB = Math.round(Buffer.byteLength(rendered.html, "utf8") / 1024);
      console.log(`[${reportType}] ${dateKey}`);
      console.log(`  Subject: ${rendered.subject}`);
      console.log(`  To: ${rendered.recipient}`);
      console.log(`  HTML size: ${sizeKB}KB`);
      console.log();
      result.entries.push({ type: reportType, dateKey, status: "previewed" });
      continue;
    }

    // 발송
    try {
      await sendEmail(storage, rendered);

      // emailedAt 업데이트
      const report = await storage.getDailyReport(dateKey, reportType);
      if (report?.id) {
        await storage.updateDailyReportEmail(report.id, Date.now(), rendered.recipient);
      }

      result.sent++;
      result.entries.push({ type: reportType, dateKey, status: "sent" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors++;
      result.entries.push({ type: reportType, dateKey, status: "error", error: message });
    }
  }

  // renderOnly → 단일 JSON 출력 (1개면 객체, 여러 개면 배열)
  if (options?.renderOnly && renderOnlyResults.length > 0) {
    const output = renderOnlyResults.length === 1 ? renderOnlyResults[0] : renderOnlyResults;
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  }

  // D1 post-sync: 이메일 발송 로그 push (pre-sync에서 이미 데이터는 올라감)
  if (!options?.preview && !options?.renderOnly && d1Client && machineId && result.sent > 0) {
    try {
      const { pushToD1 } = await import("../cloud/sync.js");
      await pushToD1(storage, d1Client, machineId);
      console.error("  ☁️  D1 sync complete");
    } catch (err) {
      console.warn(`  ⚠️  D1 post-sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
