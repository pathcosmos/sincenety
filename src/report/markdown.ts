/**
 * 마크다운 리포트 생성 — 갈무리 결과를 저장/이메일 가능한 마크다운으로 변환
 */

import type { SessionGroup } from "../grouper/session.js";

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

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function generateMarkdownReport(
  sessions: SessionGroup[],
  fromTimestamp: number,
  toTimestamp: number,
): string {
  const lines: string[] = [];
  const dateStr = formatDate(toTimestamp);
  const fromTime = formatTime(fromTimestamp);
  const toTime = formatTime(toTimestamp);

  const totalMessages = sessions.reduce((s, g) => s + g.messageCount, 0);
  const totalInput = sessions.reduce((s, g) => s + (g.inputTokens ?? 0), 0);
  const totalOutput = sessions.reduce((s, g) => s + (g.outputTokens ?? 0), 0);
  const totalDuration = sessions.reduce(
    (s, g) => s + (g.durationMinutes ?? (g.endedAt - g.startedAt) / 60000), 0
  );

  lines.push(`# Work Session Report — ${dateStr} ${toTime}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- **Period**: ${fromTime} ~ ${toTime}`);
  lines.push(`- **Sessions**: ${sessions.length}`);
  lines.push(`- **Messages**: ${totalMessages}`);
  if (totalInput + totalOutput > 0) {
    lines.push(
      `- **Tokens**: in ${formatTokens(totalInput)} / out ${formatTokens(totalOutput)} (total ${formatTokens(totalInput + totalOutput)})`
    );
  }
  lines.push(`- **Duration**: ${formatDuration(totalDuration)}`);
  lines.push("");

  lines.push("## Session Details");
  lines.push("");

  for (const session of sessions) {
    const time = `${formatTime(session.startedAt)} ~ ${formatTime(session.endedAt)}`;
    const dur = session.durationMinutes ?? (session.endedAt - session.startedAt) / 60000;
    const title = session.title ?? session.summary;

    lines.push(`### [${session.projectName}] ${time} (${formatDuration(dur)})`);
    lines.push(`- **Title**: ${title}`);
    if (session.description) {
      lines.push(`- **Description**: ${session.description}`);
    }
    if ((session.inputTokens ?? 0) + (session.outputTokens ?? 0) > 0) {
      lines.push(
        `- **Tokens**: in ${formatTokens(session.inputTokens ?? 0)} / out ${formatTokens(session.outputTokens ?? 0)}`
      );
    }
    lines.push(
      `- **Messages**: user ${session.userMessageCount ?? "?"} / AI ${session.assistantMessageCount ?? "?"} (total ${session.messageCount})`
    );
    if (session.model) {
      lines.push(`- **Model**: ${session.model}`);
    }
    lines.push(`- **Category**: ${session.category ?? session.projectName}`);
    lines.push("");
  }

  return lines.join("\n");
}
