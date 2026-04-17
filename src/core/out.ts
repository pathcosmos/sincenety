/**
 * out — smart dispatch with weekday/catchup logic
 *
 * 보고서 유형(daily/weekly/monthly)을 요일과 미발송 상태에 따라 자동 결정하고,
 * 렌더링 → 발송 → DB 업데이트까지 수행한다.
 */

import type { StorageAdapter } from "../storage/adapter.js";
import { runCircle, type CircleSummaryError } from "./circle.js";
import { getWeekBoundary } from "./circle.js";
import { renderDailyEmail, type RenderedEmail } from "../email/renderer.js";
import { sendEmail } from "../email/provider.js";
import type { SessionData } from "../email/template.js";
import type { D1Client } from "../cloud/d1-client.js";
import { padEndW } from "../util/display-width.js";

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
  /** #4 --verify: 발송하지 않고 체크리스트만 출력 */
  verify?: boolean;
  /** #2 claude-code provider 감지 시 needs_skill JSON으로 종료시킬 CLI 명령명 */
  needsSkillCommand?: string;
}

/** #4 verify 체크리스트 항목 */
export interface VerifyCheck {
  type: "daily" | "weekly" | "monthly";
  dateKey: string;
  summary: "OK" | "MISSING" | "STALE" | "EMAILED";
  baseline: "OK" | "MISSING";
  recipient: "OK" | "MISSING";
  gatherUpdatedAt: number | null;
  dailyCreatedAt: number | null;
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
 * circleResult.summaryErrors 중 렌더 루프에 의해 아직 OutResultEntry로
 * 기록되지 않은 것을 error entry 배열로 변환.
 *
 * - 발송 루프는 `reportTypes`에 포함된 타입의 에러만 기록하므로,
 *   수요일 `out --mode full` 같은 상황에서 weekly 실패가 조용히 묻힘.
 * - 이 함수로 잔여 summaryError를 전부 건져 `result.errors`에 반영하여
 *   cron에서 exit code로 실패를 감지할 수 있게 한다.
 *
 * 순수 함수 — 테스트 용이성을 위해 추출.
 */
export function collectUnrecordedSummaryErrors(
  summaryErrors: readonly CircleSummaryError[],
  existingEntries: readonly OutResultEntry[],
  today: Date,
): OutResultEntry[] {
  const unrecorded: OutResultEntry[] = [];
  for (const se of summaryErrors) {
    const alreadyRecorded = existingEntries.some(
      (e) => e.type === se.type && e.status === "error",
    );
    if (alreadyRecorded) continue;
    unrecorded.push({
      type: se.type,
      dateKey: getReportDateKey(se.type, today),
      status: "error",
      error: `${se.type} baseline auto-summary failed: ${se.error}`,
    });
  }
  return unrecorded;
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

/** #4 verify 체크리스트 테이블 출력 */
export function printVerifyTable(checks: VerifyCheck[]): void {
  const mark = (s: VerifyCheck["summary"] | "OK" | "MISSING") => {
    if (s === "OK") return "✅ OK";
    if (s === "STALE") return "⚠️  STALE";
    if (s === "EMAILED") return "📧 SENT";
    return "❌ " + s;
  };
  console.log("");
  console.log("  Verify report readiness");
  console.log("  ┌──────────┬────────────┬────────────┬────────────┬────────────┐");
  console.log(
    "  │ Type     │ Date       │ Summary    │ Baseline   │ Recipient  │",
  );
  console.log("  ├──────────┼────────────┼────────────┼────────────┼────────────┤");
  for (const c of checks) {
    const row =
      "  │ " +
      c.type.padEnd(8) +
      " │ " +
      c.dateKey.padEnd(10) +
      " │ " +
      padEndW(mark(c.summary), 10) +
      " │ " +
      padEndW(mark(c.baseline), 10) +
      " │ " +
      padEndW(mark(c.recipient), 10) +
      " │";
    console.log(row);
  }
  console.log("  └──────────┴────────────┴────────────┴────────────┴────────────┘");
  console.log("");
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

  // v0.8.8: pipeline mode 제거됨. circle은 항상 daily만 요약한다.
  // weekly/monthly는 skill 경로의 `circle --save --type <type>`로만 생성된다.

  // #4 verify 모드: circle 없이 체크리스트만
  if (options?.verify) {
    const today = options?.date ? parseDateArg(options.date) : new Date();
    const types: Array<"daily" | "weekly" | "monthly"> = options?.force
      ? [options.force]
      : ["daily", "weekly", "monthly"];
    const checks: VerifyCheck[] = [];
    const recipient = (await storage.getConfig("email")) ? "OK" : "MISSING";
    for (const type of types) {
      const dateKey = getReportDateKey(type, today);
      const f = await storage.getDailyReportFreshness(dateKey, type);
      let summary: VerifyCheck["summary"];
      if (!f || !f.hasDailyReport) summary = "MISSING";
      else if (f.emailed) summary = "EMAILED";
      else if (f.stale) summary = "STALE";
      else summary = "OK";
      checks.push({
        type,
        dateKey,
        summary,
        baseline: f?.hasDailyReport || f?.hasGatherReport ? "OK" : "MISSING",
        recipient,
        gatherUpdatedAt: f?.gatherUpdatedAt ?? null,
        dailyCreatedAt: f?.dailyCreatedAt ?? null,
      });
    }
    printVerifyTable(checks);
    // verify는 발송하지 않으므로 result는 entries만 채움 (skipped로 처리)
    for (const c of checks) {
      result.entries.push({ type: c.type, dateKey: c.dateKey, status: "previewed" });
    }
    return result;
  }

  // 2. circle 실행으로 daily 데이터 최신화
  const circleResult = await runCircle(storage, {
    scope: options?.scope,
    needsSkillCommand: options?.needsSkillCommand,
  });
  const failedAutoSummaryTypes = new Set(
    circleResult.summaryErrors.map((e) => e.type),
  );

  const today = options?.date ? parseDateArg(options.date) : new Date();

  // 2.5. auto-summary 실패를 result에 조기 반영.
  // 이후 휴가 체크/force/reportTypes 필터 어떤 경로로 빠져도 cron이
  // exit code로 감지할 수 있게 가장 먼저 기록한다. collectUnrecordedSummaryErrors가
  // 중복(같은 type의 error entry)을 제거하므로 아래 발송 루프에서도 안전.
  {
    const orphans = collectUnrecordedSummaryErrors(
      circleResult.summaryErrors,
      result.entries,
      today,
    );
    for (const entry of orphans) {
      result.errors++;
      result.entries.push(entry);
    }
  }

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

    // 3.0. auto-summary 실패한 타입은 stale baseline 위 발송 방지 — 발송 스킵.
    // (에러 entry는 이미 2.5 단계에서 early 수집되었음 — 중복 기록 안 함)
    if (reportType !== "daily" && failedAutoSummaryTypes.has(reportType)) {
      continue;
    }

    // #1 신선도 가드 — 요약이 원본보다 오래됐고 아직 발송 안 된 경우 경고 로그
    // (발송은 계속 진행하되 사용자가 감지 가능하게 하며, cron에서도 경고가 남는다)
    const freshness = await storage.getDailyReportFreshness(dateKey, reportType);
    if (freshness?.stale && !freshness.emailed) {
      console.warn(
        `  ⚠️  [${reportType}] ${dateKey} summary is stale ` +
          `(gather updated ${new Date(freshness.gatherUpdatedAt!).toISOString()} > ` +
          `summary ${new Date(freshness.dailyCreatedAt!).toISOString()}) — ` +
          `run \`sincenety circle --rerun ${dateKey}\` to refresh.`,
      );
    }

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
      // weekly/monthly가 비어 있으면 스킵이 아니라 에러로 처리 — v0.8.8에서
      // 휴리스틱 baseline을 없앴으므로 row 생성은 skill의 `circle --save` 경로로만
      // 이루어진다. 사용자에게 다음 행동을 명확히 안내.
      if (reportType !== "daily") {
        const dailyReport = await storage.getDailyReport(dateKey, reportType);
        const hasSessions =
          dailyReport?.summaryJson
            ? (() => {
                try {
                  const arr = JSON.parse(dailyReport.summaryJson!);
                  return Array.isArray(arr) && arr.length > 0;
                } catch {
                  return false;
                }
              })()
            : false;
        const msg = !dailyReport
          ? `${reportType} report row for ${dateKey} not found. Run \`/sincenety\` in Claude Code to generate a high-quality summary first.`
          : !hasSessions
            ? `${reportType} report for ${dateKey} has no sessions. Run \`/sincenety\` to rebuild the summary.`
            : `${reportType} render produced no output for ${dateKey} — summary data may be malformed.`;
        result.errors++;
        result.entries.push({ type: reportType, dateKey, status: "error", error: msg });
        continue;
      }
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
