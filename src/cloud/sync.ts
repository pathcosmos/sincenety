/**
 * D1 Sync Engine — 로컬 DB ↔ Cloudflare D1 중앙 DB 동기화
 *
 * push: 로컬 → D1 (incremental, last_d1_sync 기반)
 * pull: D1 shared_config → 로컬 config
 */

import { platform, hostname } from "node:os";
import type { D1Client } from "./d1-client.js";
import { ensureD1Schema } from "./d1-schema.js";
import { getMachineId } from "../util/machine-id.js";
import type {
  StorageAdapter,
  SessionRecord,
  GatherReport,
  DailyReport,
  EmailLog,
  VacationRecord,
} from "../storage/adapter.js";

export interface SyncResult {
  pushed: {
    sessions: number;
    gatherReports: number;
    dailyReports: number;
    emailLogs: number;
    vacations: number;
    config: number;
  };
  errors: string[];
}

export interface SyncStatus {
  configured: boolean;
  lastSync: number | null;
  pendingRows: number;
  d1Reachable: boolean;
}

// ── Config keys for D1 connection ──

const D1_ACCOUNT_ID_KEY = "d1_account_id";
const D1_DATABASE_ID_KEY = "d1_database_id";
const D1_API_TOKEN_KEY = "d1_api_token";
const LAST_D1_SYNC_KEY = "last_d1_sync";

// Shared config keys to sync to D1
const SHARED_CONFIG_KEYS = [
  "email",
  "provider",
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_pass",
  "smtp_secure",
  "resend_key",
];

/**
 * D1 설정이 있으면 D1Client를 생성하여 반환, 없으면 null
 */
export async function loadD1Client(
  storage: StorageAdapter,
): Promise<D1Client | null> {
  const [accountId, databaseId, apiToken] = await Promise.all([
    storage.getConfig(D1_ACCOUNT_ID_KEY),
    storage.getConfig(D1_DATABASE_ID_KEY),
    storage.getConfig(D1_API_TOKEN_KEY),
  ]);

  if (!accountId || !databaseId || !apiToken) {
    return null;
  }

  // Dynamic import to avoid circular dependency issues
  const { D1Client } = await import("./d1-client.js");
  return new D1Client(accountId, databaseId, apiToken);
}

/**
 * Auto machine ID: config에 저장된 값 우선, 없으면 자동 감지 후 저장
 */
export async function getAutoMachineId(
  storage: StorageAdapter,
): Promise<string> {
  const existing = await storage.getConfig("machine_id");
  if (existing) return existing;

  const mid = getMachineId();
  await storage.setConfig("machine_id", mid);
  return mid;
}

/**
 * 로컬 DB → D1 incremental push
 *
 * last_d1_sync 이후의 데이터만 전송 (최초 실행 시 전체)
 */
export async function pushToD1(
  storage: StorageAdapter,
  client: D1Client,
  machineId: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    pushed: {
      sessions: 0,
      gatherReports: 0,
      dailyReports: 0,
      emailLogs: 0,
      vacations: 0,
      config: 0,
    },
    errors: [],
  };

  const now = Date.now();

  // 1. Read last sync timestamp
  const lastSyncStr = await storage.getConfig(LAST_D1_SYNC_KEY);
  const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;

  // 2. Ensure D1 schema
  try {
    await ensureD1Schema(client);
  } catch (err) {
    result.errors.push(`스키마 생성 실패: ${(err as Error).message}`);
    return result;
  }

  // 2.5. Upsert machine record
  try {
    const label = await storage.getConfig("machine_label") ?? null;
    await client.query(
      `INSERT INTO machines (machine_id, platform, hostname, label, first_seen_at, last_sync_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(machine_id) DO UPDATE SET
         hostname = excluded.hostname,
         last_sync_at = excluded.last_sync_at`,
      [machineId, platform(), hostname(), label, now, now],
    );
  } catch (err) {
    result.errors.push(`머신 등록 실패: ${(err as Error).message}`);
  }

  // 3. Push sessions
  try {
    const sessions = await storage.getSessionsByRange(lastSync, now);
    for (const s of sessions) {
      try {
        await pushSession(client, s, machineId, now);
        result.pushed.sessions++;
      } catch (err) {
        result.errors.push(
          `세션 push 실패 [${s.id}]: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(`세션 조회 실패: ${(err as Error).message}`);
  }

  // 4. Push gather_reports
  try {
    const dateRange = timestampToDateRange(lastSync, now);
    for (const dateStr of dateRange) {
      try {
        const report = await storage.getGatherReportByDate(dateStr);
        if (report) {
          await pushGatherReport(client, report, machineId, now);
          result.pushed.gatherReports++;
        }
      } catch (err) {
        result.errors.push(
          `갈무리 리포트 push 실패 [${dateStr}]: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(`갈무리 리포트 조회 실패: ${(err as Error).message}`);
  }

  // 5. Push daily_reports
  try {
    const dateRange = timestampToDateRange(lastSync, now);
    const fromDate = dateRange[0] ?? timestampToDateStr(lastSync);
    const toDate = dateRange[dateRange.length - 1] ?? timestampToDateStr(now);

    for (const type of ["daily", "weekly", "monthly"] as const) {
      try {
        const reports = await storage.getDailyReportsByRange(
          fromDate,
          toDate,
          type,
        );
        for (const r of reports) {
          try {
            await pushDailyReport(client, r, machineId, now);
            result.pushed.dailyReports++;
          } catch (err) {
            result.errors.push(
              `일일 리포트 push 실패 [${r.reportDate}/${r.reportType}]: ${(err as Error).message}`,
            );
          }
        }
      } catch (err) {
        result.errors.push(
          `일일 리포트 조회 실패 [${type}]: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(`일일 리포트 처리 실패: ${(err as Error).message}`);
  }

  // 6. Push email_logs (append only — get recent logs, push those after lastSync)
  try {
    const logs = await storage.getEmailLogs(1000);
    const newLogs = logs.filter((l) => l.sentAt > lastSync);
    for (const log of newLogs) {
      try {
        await pushEmailLog(client, log, machineId, now);
        result.pushed.emailLogs++;
      } catch (err) {
        result.errors.push(
          `이메일 로그 push 실패: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(`이메일 로그 조회 실패: ${(err as Error).message}`);
  }

  // 7. Push vacations (shared table — full replace)
  try {
    const vacations = await storage.getVacationsByRange(
      "2000-01-01",
      "2099-12-31",
    );
    for (const v of vacations) {
      try {
        await pushVacation(client, v, machineId, now);
        result.pushed.vacations++;
      } catch (err) {
        result.errors.push(
          `휴가 push 실패 [${v.date}]: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(`휴가 조회 실패: ${(err as Error).message}`);
  }

  // 8. Push shared config
  try {
    for (const key of SHARED_CONFIG_KEYS) {
      const value = await storage.getConfig(key);
      if (value) {
        try {
          await client.query(
            `INSERT INTO shared_config (key, value, updated_at, updated_by)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at,
               updated_by = excluded.updated_by`,
            [key, value, now, machineId],
          );
          result.pushed.config++;
        } catch (err) {
          result.errors.push(
            `설정 push 실패 [${key}]: ${(err as Error).message}`,
          );
        }
      }
    }
  } catch (err) {
    result.errors.push(`설정 조회 실패: ${(err as Error).message}`);
  }

  // 9. Save last sync timestamp
  try {
    await storage.setConfig(LAST_D1_SYNC_KEY, String(now));
  } catch (err) {
    result.errors.push(
      `last_d1_sync 저장 실패: ${(err as Error).message}`,
    );
  }

  return result;
}

/**
 * D1 shared_config → 로컬 config pull
 */
export async function pullConfigFromD1(
  storage: StorageAdapter,
  client: D1Client,
): Promise<string[]> {
  const changed: string[] = [];

  const res = await client.query<{ key: string; value: string }>(
    "SELECT key, value FROM shared_config",
  );

  for (const row of res.results) {
    const currentValue = await storage.getConfig(row.key);
    if (currentValue !== row.value) {
      await storage.setConfig(row.key, row.value);
      changed.push(row.key);
    }
  }

  return changed;
}

/**
 * 동기화 상태 조회
 */
export async function getSyncStatus(
  storage: StorageAdapter,
  client: D1Client,
  machineId: string,
): Promise<SyncStatus> {
  // Check if configured
  const [accountId, databaseId, apiToken] = await Promise.all([
    storage.getConfig(D1_ACCOUNT_ID_KEY),
    storage.getConfig(D1_DATABASE_ID_KEY),
    storage.getConfig(D1_API_TOKEN_KEY),
  ]);
  const configured = !!(accountId && databaseId && apiToken);

  // Read last sync
  const lastSyncStr = await storage.getConfig(LAST_D1_SYNC_KEY);
  const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : null;

  // Count pending rows (sessions since lastSync)
  let pendingRows = 0;
  try {
    const fromTs = lastSync ?? 0;
    const sessions = await storage.getSessionsByRange(fromTs, Date.now());
    pendingRows = sessions.length;
  } catch {
    // ignore — rough estimate
  }

  // Ping D1
  let d1Reachable = false;
  try {
    d1Reachable = await client.ping();
  } catch {
    // unreachable
  }

  return {
    configured,
    lastSync,
    pendingRows,
    d1Reachable,
  };
}

// ── Internal helpers ──

async function pushSession(
  client: D1Client,
  s: SessionRecord,
  machineId: string,
  syncedAt: number,
): Promise<void> {
  await client.query(
    `INSERT INTO sessions (
      id, project, project_name, started_at, ended_at, duration_minutes,
      message_count, user_message_count, assistant_message_count, tool_call_count,
      input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens,
      title, summary, description, category, tags, model, created_at,
      machine_id, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(machine_id, id, project) DO UPDATE SET
      ended_at = MAX(sessions.ended_at, excluded.ended_at),
      duration_minutes = excluded.duration_minutes,
      message_count = excluded.message_count,
      user_message_count = excluded.user_message_count,
      assistant_message_count = excluded.assistant_message_count,
      tool_call_count = excluded.tool_call_count,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      total_tokens = excluded.total_tokens,
      title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      category = excluded.category,
      tags = excluded.tags,
      model = excluded.model,
      synced_at = excluded.synced_at`,
    [
      s.id,
      s.project,
      s.projectName,
      s.startedAt,
      s.endedAt,
      s.durationMinutes,
      s.messageCount,
      s.userMessageCount,
      s.assistantMessageCount,
      s.toolCallCount,
      s.inputTokens,
      s.outputTokens,
      s.cacheCreationTokens,
      s.cacheReadTokens,
      s.totalTokens,
      s.title,
      s.summary,
      s.description,
      s.category,
      s.tags,
      s.model,
      s.createdAt,
      machineId,
      syncedAt,
    ],
  );
}

async function pushGatherReport(
  client: D1Client,
  r: GatherReport,
  machineId: string,
  syncedAt: number,
): Promise<void> {
  await client.query(
    `INSERT INTO gather_reports (
      gathered_at, from_timestamp, to_timestamp,
      session_count, total_messages, total_input_tokens, total_output_tokens,
      report_markdown, report_json, emailed_at, email_to,
      report_date, data_hash, updated_at,
      machine_id, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(machine_id, report_date) DO UPDATE SET
      gathered_at = excluded.gathered_at,
      from_timestamp = excluded.from_timestamp,
      to_timestamp = excluded.to_timestamp,
      session_count = excluded.session_count,
      total_messages = excluded.total_messages,
      total_input_tokens = excluded.total_input_tokens,
      total_output_tokens = excluded.total_output_tokens,
      report_markdown = excluded.report_markdown,
      report_json = excluded.report_json,
      emailed_at = excluded.emailed_at,
      email_to = excluded.email_to,
      data_hash = excluded.data_hash,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at`,
    [
      r.gatheredAt,
      r.fromTimestamp,
      r.toTimestamp,
      r.sessionCount,
      r.totalMessages,
      r.totalInputTokens,
      r.totalOutputTokens,
      r.reportMarkdown,
      r.reportJson,
      r.emailedAt,
      r.emailTo,
      r.reportDate,
      r.dataHash,
      r.updatedAt,
      machineId,
      syncedAt,
    ],
  );
}

async function pushDailyReport(
  client: D1Client,
  r: DailyReport,
  machineId: string,
  syncedAt: number,
): Promise<void> {
  await client.query(
    `INSERT INTO daily_reports (
      report_date, report_type, period_from, period_to,
      session_count, total_messages, total_tokens,
      summary_json, overview, report_markdown, created_at,
      emailed_at, email_to, status, progress_label, data_hash,
      machine_id, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(machine_id, report_date, report_type) DO UPDATE SET
      period_from = excluded.period_from,
      period_to = excluded.period_to,
      session_count = excluded.session_count,
      total_messages = excluded.total_messages,
      total_tokens = excluded.total_tokens,
      summary_json = excluded.summary_json,
      overview = excluded.overview,
      report_markdown = excluded.report_markdown,
      created_at = excluded.created_at,
      emailed_at = excluded.emailed_at,
      email_to = excluded.email_to,
      status = excluded.status,
      progress_label = excluded.progress_label,
      data_hash = excluded.data_hash,
      synced_at = excluded.synced_at`,
    [
      r.reportDate,
      r.reportType,
      r.periodFrom,
      r.periodTo,
      r.sessionCount,
      r.totalMessages,
      r.totalTokens,
      r.summaryJson,
      r.overview,
      r.reportMarkdown,
      r.createdAt,
      r.emailedAt,
      r.emailTo,
      r.status,
      r.progressLabel,
      r.dataHash,
      machineId,
      syncedAt,
    ],
  );
}

async function pushEmailLog(
  client: D1Client,
  log: EmailLog,
  machineId: string,
  syncedAt: number,
): Promise<void> {
  await client.query(
    `INSERT INTO email_logs (
      sent_at, report_type, report_date, period_from, period_to,
      recipient, subject, body_html, body_text,
      provider, status, error_message,
      machine_id, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.sentAt,
      log.reportType,
      log.reportDate,
      log.periodFrom,
      log.periodTo,
      log.recipient,
      log.subject,
      log.bodyHtml,
      log.bodyText,
      log.provider,
      log.status,
      log.errorMessage,
      machineId,
      syncedAt,
    ],
  );
}

async function pushVacation(
  client: D1Client,
  v: VacationRecord,
  machineId: string,
  _syncedAt: number,
): Promise<void> {
  await client.query(
    `INSERT INTO vacations (date, type, source, label, created_at, synced_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       type = excluded.type,
       source = excluded.source,
       label = excluded.label,
       created_at = excluded.created_at,
       synced_by = excluded.synced_by`,
    [v.date, v.type, v.source, v.label, v.createdAt, machineId],
  );
}

// ── Cross-device helpers (D1 pull) ──

export interface CrossDeviceReport {
  machineId: string;
  summaryJson: string;
  overview: string | null;
  sessionCount: number;
}

/**
 * D1에서 다른 기기의 daily_reports를 가져온다 (현재 기기 제외).
 * 세션 요약 데이터(summaryJson)만 반환하여 토큰/대역폭을 절약한다.
 */
export async function pullCrossDeviceReports(
  client: D1Client,
  machineId: string,
  date: string,
  reportType: string,
): Promise<CrossDeviceReport[]> {
  const res = await client.query<{
    machine_id: string;
    summary_json: string;
    overview: string | null;
    session_count: number;
  }>(
    `SELECT machine_id, summary_json, overview, session_count
     FROM daily_reports
     WHERE report_date = ? AND report_type = ? AND machine_id != ?`,
    [date, reportType, machineId],
  );
  return res.results.map((r) => ({
    machineId: r.machine_id,
    summaryJson: r.summary_json,
    overview: r.overview,
    sessionCount: r.session_count,
  }));
}

/**
 * D1에서 해당 날짜+유형의 이메일이 이미 발송되었는지 확인 (any machine).
 */
export async function checkCrossDeviceEmailSent(
  client: D1Client,
  date: string,
  reportType: string,
): Promise<boolean> {
  const res = await client.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM email_logs
     WHERE report_date = ? AND report_type = ? AND status = 'sent'
     LIMIT 1`,
    [date, reportType],
  );
  return (res.results[0]?.cnt ?? 0) > 0;
}

/**
 * timestamp를 YYYY-MM-DD 문자열로 변환
 */
function timestampToDateStr(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * from ~ to 사이의 날짜 문자열 배열 생성
 */
function timestampToDateRange(from: number, to: number): string[] {
  const dates: string[] = [];
  const startDate = new Date(from);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(to);
  endDate.setHours(23, 59, 59, 999);

  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(timestampToDateStr(current.getTime()));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
