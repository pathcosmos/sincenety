/**
 * 이메일 렌더러 — DB 데이터로부터 이메일 컴포넌트(subject, html, text)를 생성하는 순수 함수
 */

import type { StorageAdapter } from "../storage/adapter.js";
import { renderEmailHtml, type EmailData, type SessionData } from "./template.js";
import { mergeSessionsByTopic } from "./merge-sessions.js";
import { getProjectWeights, resolveWeight } from "../core/weights.js";
import { resolveAiProvider } from "../core/ai-provider.js";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  recipient: string;
  reportType: "daily" | "weekly" | "monthly";
  reportDate: string;
  periodFrom: string;
  periodTo: string;
}

interface AiSummary {
  topic: string;
  outcome: string;
  flow: string;
  significance: string;
  nextSteps: string;
}

const TYPE_LABELS: Record<string, string> = {
  daily: "Daily Report",
  weekly: "Weekly Report",
  monthly: "Monthly Report",
};

/**
 * DB 데이터로부터 이메일 컴포넌트를 렌더링
 * @returns RenderedEmail 또는 null (수신자 미설정 또는 데이터 없음)
 */
export async function renderDailyEmail(
  storage: StorageAdapter,
  date: string,
  reportType: "daily" | "weekly" | "monthly" = "daily",
  crossDeviceSessions?: SessionData[],
): Promise<RenderedEmail | null> {
  // 1. 수신자 확인
  const recipient = await storage.getConfig("email");
  if (!recipient) return null;

  // 2. AI 요약 보고서 조회
  const dailyReport = await storage.getDailyReport(date, reportType);

  // 3. raw 갈무리 데이터 조회
  const gatherReport = await storage.getGatherReportByDate(date);

  // 4. 둘 다 없으면 null
  if (!dailyReport && !gatherReport) return null;

  // 5. AI summary map 구성
  let aiSummaryMap: Map<string, AiSummary> | null = null;
  let dailyOverview: string | null = null;

  if (dailyReport) {
    try {
      const summaryJson = JSON.parse(dailyReport.summaryJson || "[]");
      aiSummaryMap = new Map();
      for (const s of summaryJson) {
        if (s.sessionId) {
          aiSummaryMap.set(s.sessionId, {
            topic: s.topic ?? "",
            outcome: s.outcome ?? "",
            flow: s.flow ?? "",
            significance: s.significance ?? "",
            nextSteps: s.nextSteps ?? "",
          });
        }
      }
      dailyOverview = dailyReport.overview;
    } catch {
      // AI 요약 파싱 실패 시 무시
    }
  }

  // 6-7. 세션 데이터 구성
  let sessions: SessionData[];
  let fromTimestamp: number;
  let toTimestamp: number;
  let gatheredAt: number;

  if (gatherReport) {
    // gatherReport 기반 세션 구성 + AI 요약 머지
    fromTimestamp = gatherReport.fromTimestamp;
    toTimestamp = gatherReport.toTimestamp;
    gatheredAt = gatherReport.gatheredAt;

    try {
      const sessionsJson = JSON.parse(gatherReport.reportJson || "[]");
      sessions = sessionsJson.map((s: Record<string, unknown>): SessionData => {
        const sid = (s.sessionId as string) ?? "";
        // 정확 매칭 우선, 실패 시 prefix 매칭 (sessionId 잘림 방어)
        let ai = aiSummaryMap?.get(sid);
        if (!ai && aiSummaryMap && sid) {
          for (const [key, val] of aiSummaryMap) {
            if (key.startsWith(sid.slice(0, 12)) || sid.startsWith(key.slice(0, 12))) {
              ai = val;
              break;
            }
          }
        }
        const wu = ai
          ? { outcome: ai.outcome, significance: ai.significance, flow: ai.flow, nextSteps: ai.nextSteps || undefined }
          : (s.wrapUp as Record<string, string> | undefined)
            ? { outcome: (s.wrapUp as any).outcome ?? "", significance: (s.wrapUp as any).significance ?? "", flow: (s.wrapUp as any).flow, nextSteps: (s.wrapUp as any).nextSteps }
            : undefined;
        return {
          sessionId: sid,
          projectName: (s.projectName as string) ?? "",
          startedAt: (s.startedAt as number) ?? fromTimestamp,
          endedAt: (s.endedAt as number) ?? toTimestamp,
          durationMinutes: (s.durationMinutes as number) ?? 0,
          messageCount: (s.messageCount as number) ?? 0,
          userMessageCount: (s.userMessageCount as number) ?? 0,
          assistantMessageCount: (s.assistantMessageCount as number) ?? 0,
          inputTokens: (s.inputTokens as number) ?? 0,
          outputTokens: (s.outputTokens as number) ?? 0,
          totalTokens: (s.totalTokens as number) ?? 0,
          title: ai?.topic || ((s.title as string) ?? ""),
          summary: ai?.topic || ((s.title as string) ?? ""),
          description: ai?.outcome || ((s.description as string) ?? ""),
          model: (s.model as string) ?? "",
          category: (s.category as string) ?? "",
          actions: ((s.actions as unknown[]) ?? []).map((a: any) => ({
            time: a.time ?? "",
            input: a.input ?? "",
            result: a.result ?? "",
            significance: a.significance ?? "",
          })),
          wrapUp: wu,
        };
      });
    } catch {
      sessions = [];
    }
  } else if (dailyReport) {
    // 7. weekly/monthly 등 gather 데이터 없이 dailyReport.summaryJson으로 세션 구성
    fromTimestamp = dailyReport.periodFrom;
    toTimestamp = dailyReport.periodTo;
    gatheredAt = dailyReport.createdAt;

    try {
      const summaryJson = JSON.parse(dailyReport.summaryJson || "[]");
      sessions = summaryJson.map((s: any): SessionData => ({
        sessionId: s.sessionId ?? "",
        projectName: s.projectName ?? s.project ?? "",
        startedAt: s.startedAt ?? fromTimestamp,
        endedAt: s.endedAt ?? toTimestamp,
        durationMinutes: s.durationMinutes ?? 0,
        messageCount: s.messageCount ?? 0,
        userMessageCount: s.userMessageCount ?? 0,
        assistantMessageCount: s.assistantMessageCount ?? 0,
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        totalTokens: s.totalTokens ?? 0,
        title: s.topic ?? s.title ?? "",
        summary: s.topic ?? s.title ?? "",
        description: s.outcome ?? s.description ?? "",
        model: s.model ?? "",
        category: s.category ?? "",
        actions: [],
        wrapUp: s.outcome
          ? { outcome: s.outcome, significance: s.significance ?? "", flow: s.flow, nextSteps: s.nextSteps }
          : undefined,
      }));
    } catch {
      sessions = [];
    }
  } else {
    return null;
  }

  // 7.5. 크로스 디바이스 세션 머지 (다른 기기의 세션 추가)
  if (crossDeviceSessions && crossDeviceSessions.length > 0) {
    const localIds = new Set(sessions.map((s) => s.sessionId));
    for (const cs of crossDeviceSessions) {
      if (!localIds.has(cs.sessionId)) {
        sessions.push(cs);
      }
    }
  }

  // 7.6. 동일 프로젝트+제목 세션 머지
  sessions = mergeSessionsByTopic(sessions);

  // 7.7. #12 프로젝트 가중치 적용 — low = 1줄 축약, high는 그대로
  const weights = await getProjectWeights(storage);
  sessions = sessions.map((s) => {
    const w = resolveWeight(weights, s.projectName);
    if (w === "low") {
      // low: description/actions/wrapUp 상세 축약 (1줄만 남김)
      const compact = s.wrapUp?.significance || s.title || s.summary;
      return {
        ...s,
        description: compact,
        actions: [],
        wrapUp: s.wrapUp
          ? { outcome: compact, significance: compact, flow: undefined, nextSteps: undefined }
          : undefined,
      };
    }
    return s;
  });

  if (sessions.length === 0) return null;

  // 8. 제목 구성
  const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
  const totalTokens = sessions.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0);
  const totalTokensK = Math.round(totalTokens / 1000);
  const typeLabel = TYPE_LABELS[reportType] ?? reportType;
  const subject = `[sincenety] ${date} ${typeLabel} — ${sessions.length} sessions, ${totalMessages}msg, ${totalTokensK}Ktok`;

  // 9. HTML 렌더 (#5 배지 메타데이터 포함)
  const aiProvider = await resolveAiProvider(storage).catch(() => null);
  const summaryUpdatedAt = dailyReport?.createdAt;
  let html: string;
  try {
    const emailData: EmailData = {
      sessions,
      fromTimestamp,
      toTimestamp,
      gatheredAt,
      dailyOverview: dailyOverview ?? undefined,
      aiProvider: aiProvider && aiProvider !== "heuristic" ? aiProvider : undefined,
      summaryUpdatedAt,
    };
    html = renderEmailHtml(emailData);
  } catch {
    // fallback: 마크다운이 있으면 pre로 감싸기
    const md = gatherReport?.reportMarkdown || dailyReport?.reportMarkdown || "";
    html = `<pre style="font-family:monospace;white-space:pre-wrap">${md.replace(/</g, "&lt;")}</pre>`;
  }

  // 10. plain text 구성
  let text = gatherReport?.reportMarkdown || dailyReport?.reportMarkdown || "";
  if (dailyOverview) {
    text = `[${typeLabel}] ${date}\n\n${dailyOverview}\n\n${text}`;
  }

  // periodFrom/periodTo 문자열
  const periodFrom = new Date(fromTimestamp).toISOString().slice(0, 10);
  const periodTo = new Date(toTimestamp).toISOString().slice(0, 10);

  return {
    subject,
    html,
    text,
    recipient,
    reportType,
    reportDate: date,
    periodFrom,
    periodTo,
  };
}
