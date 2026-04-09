/**
 * merge-sessions — 동일 프로젝트 세션을 통합하는 유틸리티
 *
 * 같은 날짜 내에서 projectName이 동일한 세션을 하나로 합친다.
 * 통계(메시지, 토큰, 시간)는 합산, wrapUp은 가장 상세한 것을 채택한다.
 */

import type { SessionData } from "./template.js";

/**
 * 제목을 정규화: 소문자, 공백 정리, 프로젝트명 접미사 제거
 */
function normalizeTitle(title: string, projectName: string): string {
  let t = title.toLowerCase().trim();
  // 프로젝트명이 제목 끝에 붙어 있으면 제거
  const pn = projectName.toLowerCase();
  if (t.endsWith(pn)) {
    t = t.slice(0, -pn.length).trim();
  }
  // 슬래시 커맨드 제거 (/sincenety 등)
  t = t.replace(/^\/\S+\s*/, "").trim();
  // 연속 공백 축소
  t = t.replace(/\s+/g, " ");
  return t;
}

/**
 * wrapUp의 "상세도" 점수 (채워진 필드 길이 합산)
 */
function wrapUpScore(wu?: SessionData["wrapUp"]): number {
  if (!wu) return 0;
  return (
    (wu.outcome?.length ?? 0) +
    (wu.significance?.length ?? 0) +
    (wu.flow?.length ?? 0) +
    (wu.nextSteps?.length ?? 0)
  );
}

/**
 * 동일 프로젝트 세션을 머지
 *
 * - projectName 기준 그룹핑
 * - 그룹 내 세션: 통계 합산, 시간 범위 확장, wrapUp 중 가장 상세한 것 채택
 * - 제목에 "(×N)" 머지 카운트 표시 (2개 이상일 때)
 * - 1개짜리 그룹은 그대로 통과
 */
export function mergeSessionsByTopic(sessions: SessionData[]): SessionData[] {
  if (sessions.length <= 1) return sessions;

  // 그룹핑
  const groups = new Map<string, SessionData[]>();
  for (const s of sessions) {
    const key = s.projectName;
    const group = groups.get(key);
    if (group) {
      group.push(s);
    } else {
      groups.set(key, [s]);
    }
  }

  const merged: SessionData[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    // 시간순 정렬
    group.sort((a, b) => a.startedAt - b.startedAt);

    const base = group[0];

    // 가장 상세한 wrapUp 채택
    let bestWrapUp = base.wrapUp;
    let bestScore = wrapUpScore(bestWrapUp);
    for (let i = 1; i < group.length; i++) {
      const score = wrapUpScore(group[i].wrapUp);
      if (score > bestScore) {
        bestWrapUp = group[i].wrapUp;
        bestScore = score;
      }
    }

    // flow를 합산 (각 세션의 flow를 연결)
    const flows = group
      .map((s) => s.wrapUp?.flow)
      .filter((f): f is string => !!f && f.length > 0);
    const mergedFlow =
      flows.length > 1 ? flows.join(" → ") : flows[0] ?? bestWrapUp?.flow;

    const m: SessionData = {
      sessionId: base.sessionId,
      projectName: base.projectName,
      startedAt: Math.min(...group.map((s) => s.startedAt)),
      endedAt: Math.max(...group.map((s) => s.endedAt)),
      durationMinutes: group.reduce((sum, s) => sum + s.durationMinutes, 0),
      messageCount: group.reduce((sum, s) => sum + s.messageCount, 0),
      userMessageCount: group.reduce((sum, s) => sum + s.userMessageCount, 0),
      assistantMessageCount: group.reduce(
        (sum, s) => sum + s.assistantMessageCount,
        0,
      ),
      inputTokens: group.reduce((sum, s) => sum + s.inputTokens, 0),
      outputTokens: group.reduce((sum, s) => sum + s.outputTokens, 0),
      totalTokens: group.reduce((sum, s) => sum + s.totalTokens, 0),
      title: `${base.title} (×${group.length})`,
      summary: base.summary,
      description: base.description,
      model: base.model,
      category: base.category,
      actions: group.flatMap((s) => s.actions),
      wrapUp: bestWrapUp
        ? { ...bestWrapUp, flow: mergedFlow }
        : undefined,
    };

    merged.push(m);
  }

  return merged;
}
