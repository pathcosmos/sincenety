/**
 * 터미널 리포트 포매터 — 테이블 형식
 */

import type { SessionGroup } from "../grouper/session.js";
import type { GatherResult } from "../core/gatherer.js";

// ─── 유틸리티 ──────────────────────────────────────────

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

/** 문자열의 표시 폭 계산 (한글=2, ASCII=1) */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK Unified, Hangul Syllables, Fullwidth forms
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** 표시 폭 기준으로 오른쪽 패딩 */
function padEnd(str: string, width: number): string {
  const diff = width - displayWidth(str);
  return diff > 0 ? str + " ".repeat(diff) : str;
}

/** 표시 폭 기준으로 왼쪽 패딩 (숫자 정렬용) */
function padStart(str: string, width: number): string {
  const diff = width - displayWidth(str);
  return diff > 0 ? " ".repeat(diff) + str : str;
}

function truncate(str: string, maxWidth: number): string {
  let w = 0;
  let i = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0;
    const cw =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd)
        ? 2
        : 1;
    if (w + cw > maxWidth - 1) {
      return str.slice(0, i) + "…";
    }
    w += cw;
    i += ch.length;
  }
  return str;
}

// ─── 테이블 그리기 ──────────────────────────────────────

interface TableColumn {
  header: string;
  width: number;
  align: "left" | "right";
}

function drawLine(cols: TableColumn[], left: string, mid: string, right: string, fill: string): string {
  return left + cols.map((c) => fill.repeat(c.width + 2)).join(mid) + right;
}

function drawRow(cols: TableColumn[], values: string[]): string {
  const cells = cols.map((col, i) => {
    const val = values[i] ?? "";
    const padded = col.align === "right" ? padStart(val, col.width) : padEnd(val, col.width);
    return ` ${padded} `;
  });
  return "│" + cells.join("│") + "│";
}

// ─── 갈무리 리포트 ──────────────────────────────────────

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
  const totalTokens = totalInput + totalOutput;

  // 헤더
  lines.push("");
  lines.push(
    `  📋 ${dateStr} 작업 갈무리 (${fromTime} ~ ${toTime})${isFirstRun ? " [첫 실행]" : ""}`
  );
  lines.push("");

  // ─── 요약 테이블 ───
  const summaryRows = [
    ["총 세션", `${sessions.length}개`],
    ["총 메시지", `${totalMessages}개`],
    ["입력 토큰", fmtTokens(totalInput)],
    ["출력 토큰", fmtTokens(totalOutput)],
    ["총 토큰", fmtTokens(totalTokens)],
  ];

  const skWidth = Math.max(...summaryRows.map(([k]) => displayWidth(k)));
  const svWidth = Math.max(...summaryRows.map(([, v]) => displayWidth(v)));

  const sumCols: TableColumn[] = [
    { header: "항목", width: skWidth, align: "left" },
    { header: "값", width: svWidth, align: "right" },
  ];

  lines.push("  " + drawLine(sumCols, "┌", "┬", "┐", "─"));
  lines.push("  " + drawRow(sumCols, [sumCols[0].header, sumCols[1].header]));
  lines.push("  " + drawLine(sumCols, "├", "┼", "┤", "─"));
  for (const [k, v] of summaryRows) {
    lines.push("  " + drawRow(sumCols, [k, v]));
  }
  lines.push("  " + drawLine(sumCols, "└", "┴", "┘", "─"));

  lines.push("");

  // ─── 세션 상세 테이블 ───
  const rows = sessions.map((s) => {
    const dur = formatDuration(s.startedAt, s.endedAt);
    const time = `${formatTime(s.startedAt)}~${formatTime(s.endedAt)}`;
    const tokens = (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
    const userMsg = s.userMessageCount ?? 0;
    const assistMsg = s.assistantMessageCount ?? 0;
    const toolCalls = s.toolCallCount ?? 0;
    const title = s.title ?? s.summary;
    return {
      project: s.projectName,
      time,
      duration: dur,
      messages: `${s.messageCount}`,
      userMsg: `${userMsg}`,
      assistMsg: `${assistMsg}`,
      toolCalls: `${toolCalls}`,
      tokens: fmtTokens(tokens),
      model: s.model ?? "-",
      title,
    };
  });

  // 작업 내용 최대 폭: 전체에서 다른 열 빼고 남은 공간 (최소 20, 최대 40)
  const titleMaxWidth = 36;

  const cols: TableColumn[] = [
    { header: "#",        width: Math.max(1, String(rows.length).length), align: "right" },
    { header: "프로젝트", width: Math.max(8, ...rows.map((r) => displayWidth(r.project))), align: "left" },
    { header: "시간",     width: Math.max(4, ...rows.map((r) => displayWidth(r.time))), align: "left" },
    { header: "소요",     width: Math.max(4, ...rows.map((r) => displayWidth(r.duration))), align: "right" },
    { header: "메시지",   width: Math.max(6, ...rows.map((r) => displayWidth(r.messages))), align: "right" },
    { header: "사용자",   width: Math.max(6, ...rows.map((r) => displayWidth(r.userMsg))), align: "right" },
    { header: "어시",     width: Math.max(4, ...rows.map((r) => displayWidth(r.assistMsg))), align: "right" },
    { header: "도구",     width: Math.max(4, ...rows.map((r) => displayWidth(r.toolCalls))), align: "right" },
    { header: "토큰",     width: Math.max(4, ...rows.map((r) => displayWidth(r.tokens))), align: "right" },
    { header: "모델",     width: Math.max(4, ...rows.map((r) => displayWidth(r.model))), align: "left" },
  ];

  lines.push("  " + drawLine(cols, "┌", "┬", "┐", "─"));
  lines.push("  " + drawRow(cols, cols.map((c) => c.header)));
  lines.push("  " + drawLine(cols, "├", "┼", "┤", "─"));

  rows.forEach((r, i) => {
    lines.push("  " + drawRow(cols, [
      String(i + 1),
      r.project,
      r.time,
      r.duration,
      r.messages,
      r.userMsg,
      r.assistMsg,
      r.toolCalls,
      r.tokens,
      r.model,
    ]));
  });

  lines.push("  " + drawLine(cols, "└", "┴", "┘", "─"));

  // ─── 작업 내용 상세 ───
  lines.push("");
  lines.push("  📝 세션별 작업 내용");
  lines.push("  " + "─".repeat(60));

  sessions.forEach((s, i) => {
    const title = truncate(s.title ?? s.summary, 70);
    lines.push(`  ${i + 1}. [${s.projectName}] ${title}`);
    if (s.description) {
      const desc = truncate(s.description, 74);
      lines.push(`     ${desc}`);
    }
  });

  lines.push("");
  lines.push("  " + "─".repeat(60));
  lines.push(`  ✅ 갈무리 완료. 기록이 저장되었습니다.`);
  lines.push("");

  return lines.join("\n");
}

