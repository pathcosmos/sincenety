/**
 * 터미널 리포트 포매터
 */

import type { SessionGroup } from "../grouper/session.js";
import type { GatherResult } from "../core/gatherer.js";
import type { SessionRecord } from "../storage/adapter.js";

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function formatDuration(startMs: number, endMs: number): string {
  const minutes = Math.floor((endMs - startMs) / 60000);
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

export function formatGatherReport(result: GatherResult): string {
  const lines: string[] = [];
  const { sessions, fromTimestamp, toTimestamp, isFirstRun } = result;

  if (sessions.length === 0) {
    const since = formatTime(fromTimestamp);
    lines.push(`\n  갈무리할 작업이 없습니다. (${since} 이후 활동 없음)\n`);
    return lines.join("\n");
  }

  const dateStr = formatDate(toTimestamp);
  const fromTime = formatTime(fromTimestamp);
  const toTime = formatTime(toTimestamp);
  const totalMessages = sessions.reduce((s, g) => s + g.messageCount, 0);
  const totalInput = sessions.reduce((s, g) => s + (g.inputTokens ?? 0), 0);
  const totalOutput = sessions.reduce((s, g) => s + (g.outputTokens ?? 0), 0);

  lines.push("");
  lines.push(
    `  📋 ${dateStr} 작업 갈무리 (${fromTime} ~ ${toTime})${isFirstRun ? " [첫 실행]" : ""}`
  );
  let headerLine = `  총 ${sessions.length}개 세션, ${totalMessages}개 메시지`;
  if (totalInput + totalOutput > 0) {
    headerLine += ` | 토큰: ${fmtTokens(totalInput)}in / ${fmtTokens(totalOutput)}out`;
  }
  lines.push(headerLine);
  lines.push("  " + "─".repeat(56));

  for (const session of sessions) {
    const time = `${formatTime(session.startedAt)} ~ ${formatTime(session.endedAt)}`;
    const duration = formatDuration(session.startedAt, session.endedAt);
    const title = truncate(session.title ?? session.summary, 60);
    const tokens = (session.inputTokens ?? 0) + (session.outputTokens ?? 0);

    lines.push("");
    let sessionLine = `  [${session.projectName}] ${time} (${duration}, ${session.messageCount}msg`;
    if (tokens > 0) sessionLine += `, ${fmtTokens(tokens)}tok`;
    sessionLine += ")";
    lines.push(sessionLine);
    lines.push(`    ${title}`);
    if (session.model) {
      lines.push(`    모델: ${session.model}`);
    }
  }

  lines.push("");
  lines.push("  " + "─".repeat(56));
  lines.push(`  ✅ 갈무리 완료. 기록이 저장되었습니다.`);
  lines.push("");

  return lines.join("\n");
}

export function formatLogReport(
  records: SessionRecord[],
  dateLabel: string
): string {
  const lines: string[] = [];

  if (records.length === 0) {
    lines.push(`\n  ${dateLabel}에 기록된 작업이 없습니다.\n`);
    return lines.join("\n");
  }

  const totalMessages = records.reduce((s, r) => s + r.messageCount, 0);
  const totalTokens = records.reduce(
    (s, r) => s + r.inputTokens + r.outputTokens, 0
  );

  lines.push("");
  let header = `  📋 ${dateLabel} 작업 기록 — ${records.length}개 세션, ${totalMessages}msg`;
  if (totalTokens > 0) header += `, ${fmtTokens(totalTokens)}tok`;
  lines.push(header);
  lines.push("  " + "─".repeat(56));

  for (const r of records) {
    const time = `${formatTime(r.startedAt)} ~ ${formatTime(r.endedAt)}`;
    const duration = formatDuration(r.startedAt, r.endedAt);
    const title = truncate(r.title || r.summary, 60);
    const tokens = r.inputTokens + r.outputTokens;

    lines.push("");
    let line = `  [${r.projectName}] ${time} (${duration}, ${r.messageCount}msg`;
    if (tokens > 0) line += `, ${fmtTokens(tokens)}tok`;
    line += ")";
    lines.push(line);
    lines.push(`    ${title}`);
    if (r.model) lines.push(`    모델: ${r.model}`);
  }

  lines.push("");
  return lines.join("\n");
}
