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
  if (minutes < 60) return `${Math.round(minutes)}분`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
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

  lines.push(`# 작업 갈무리 — ${dateStr} ${toTime}`);
  lines.push("");
  lines.push("## 요약");
  lines.push(`- **기간**: ${fromTime} ~ ${toTime}`);
  lines.push(`- **세션**: ${sessions.length}개`);
  lines.push(`- **메시지**: ${totalMessages}개`);
  if (totalInput + totalOutput > 0) {
    lines.push(
      `- **토큰**: 입력 ${formatTokens(totalInput)} / 출력 ${formatTokens(totalOutput)} (합계 ${formatTokens(totalInput + totalOutput)})`
    );
  }
  lines.push(`- **작업 시간**: ${formatDuration(totalDuration)}`);
  lines.push("");

  lines.push("## 세션별 상세");
  lines.push("");

  for (const session of sessions) {
    const time = `${formatTime(session.startedAt)} ~ ${formatTime(session.endedAt)}`;
    const dur = session.durationMinutes ?? (session.endedAt - session.startedAt) / 60000;
    const title = session.title ?? session.summary;

    lines.push(`### [${session.projectName}] ${time} (${formatDuration(dur)})`);
    lines.push(`- **타이틀**: ${title}`);
    if (session.description) {
      lines.push(`- **설명**: ${session.description}`);
    }
    if ((session.inputTokens ?? 0) + (session.outputTokens ?? 0) > 0) {
      lines.push(
        `- **토큰**: 입력 ${formatTokens(session.inputTokens ?? 0)} / 출력 ${formatTokens(session.outputTokens ?? 0)}`
      );
    }
    lines.push(
      `- **메시지**: 사용자 ${session.userMessageCount ?? "?"} / AI ${session.assistantMessageCount ?? "?"} (총 ${session.messageCount})`
    );
    if (session.model) {
      lines.push(`- **모델**: ${session.model}`);
    }
    lines.push(`- **카테고리**: ${session.category ?? session.projectName}`);
    lines.push("");
  }

  return lines.join("\n");
}
