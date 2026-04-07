/**
 * 이메일 발송 — nodemailer + Gmail SMTP
 */

import { createTransport } from "nodemailer";
import type { StorageAdapter } from "../storage/adapter.js";
import { renderEmailHtml, type EmailData, type SessionData } from "./template.js";

/** 이메일 설정을 storage에서 읽어옴 */
async function getEmailConfig(storage: StorageAdapter) {
  const [email, smtpHost, smtpPort, smtpUser, smtpPass] = await Promise.all([
    storage.getConfig("email"),
    storage.getConfig("smtp_host"),
    storage.getConfig("smtp_port"),
    storage.getConfig("smtp_user"),
    storage.getConfig("smtp_pass"),
  ]);

  return {
    email,
    smtpHost: smtpHost ?? "smtp.gmail.com",
    smtpPort: parseInt(smtpPort ?? "587", 10),
    smtpUser,
    smtpPass,
  };
}

/**
 * 갈무리 리포트를 이메일로 발송
 * @param storage - StorageAdapter 인스턴스 (초기화 완료 상태)
 * @param reportId - 특정 리포트 ID (없으면 최신)
 */
export async function sendGatherEmail(
  storage: StorageAdapter,
  reportId?: number,
): Promise<void> {
  const config = await getEmailConfig(storage);

  if (!config.email || !config.smtpUser || !config.smtpPass) {
    console.log(
      "  이메일이 설정되지 않았습니다. 아래 명령으로 설정해 주세요:\n" +
        "\n" +
        "    sincenety config --email 수신자@gmail.com\n" +
        "    sincenety config --smtp-user 발신자@gmail.com\n" +
        "    sincenety config --smtp-pass   (프롬프트에서 앱 비밀번호 입력)\n" +
        "\n" +
        "  Gmail 앱 비밀번호 생성: https://myaccount.google.com/apppasswords",
    );
    return;
  }

  // gather_reports (raw) 가져오기
  let report;
  if (reportId != null) {
    const latest = await storage.getLatestGatherReport();
    if (latest && latest.id === reportId) {
      report = latest;
    } else {
      throw new Error(`리포트 ID ${reportId}를 찾을 수 없습니다.`);
    }
  } else {
    report = await storage.getLatestGatherReport();
  }

  if (!report) {
    console.log("  발송할 갈무리 리포트가 없습니다. 먼저 갈무리를 실행해 주세요.");
    return;
  }

  // 이미 발송된 리포트인지 확인
  if (report.emailedAt) {
    const sentDate = new Date(report.emailedAt).toLocaleString("ko-KR");
    console.log(`  이 리포트는 이미 ${sentDate}에 ${report.emailTo}로 발송되었습니다.`);
    return;
  }

  // daily_reports (AI 요약)가 있으면 가져와서 wrapUp에 매핑
  const dateStr = new Date(report.gatheredAt).toISOString().slice(0, 10);
  const dailyReport = await storage.getDailyReport(dateStr, "daily");
  let aiSummaryMap: Map<string, { topic: string; outcome: string; flow: string; significance: string; nextSteps: string }> | null = null;
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

  // 제목 구성
  const totalTokensK = Math.round(
    (report.totalInputTokens + report.totalOutputTokens) / 1000,
  );
  const subject = `[sincenety] ${dateStr} 일일보고 — ${report.sessionCount}세션, ${report.totalMessages}msg, ${totalTokensK}Ktok`;

  // HTML 생성 — AI 요약이 있으면 wrapUp에 매핑
  let html: string;
  try {
    const sessionsJson = JSON.parse(report.reportJson || "[]");
    const emailData: EmailData = {
      sessions: sessionsJson.map((s: Record<string, unknown>): SessionData => {
        const sid = (s.sessionId as string) ?? "";
        const ai = aiSummaryMap?.get(sid);
        const wu = ai
          ? { outcome: ai.outcome, significance: ai.significance, flow: ai.flow, nextSteps: ai.nextSteps || undefined }
          : (s.wrapUp as Record<string, string> | undefined)
            ? { outcome: (s.wrapUp as any).outcome ?? "", significance: (s.wrapUp as any).significance ?? "", flow: (s.wrapUp as any).flow, nextSteps: (s.wrapUp as any).nextSteps }
            : undefined;
        return {
          sessionId: sid,
          projectName: (s.projectName as string) ?? "",
          startedAt: (s.startedAt as number) ?? report.fromTimestamp,
          endedAt: (s.endedAt as number) ?? report.toTimestamp,
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
      }),
      fromTimestamp: report.fromTimestamp,
      toTimestamp: report.toTimestamp,
      gatheredAt: report.gatheredAt,
      dailyOverview: dailyOverview ?? undefined,
    };
    html = renderEmailHtml(emailData);
  } catch {
    // JSON 파싱 실패 시 마크다운을 plain text로
    html = `<pre style="font-family:monospace;white-space:pre-wrap">${report.reportMarkdown.replace(/</g, "&lt;")}</pre>`;
  }

  // plain text 본문도 AI 요약 기반으로 구성
  let plainText = report.reportMarkdown;
  if (dailyOverview) {
    plainText = `[일일보고] ${dateStr}\n\n${dailyOverview}\n\n${plainText}`;
  }

  // 전송
  const transporter = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  await transporter.sendMail({
    from: config.smtpUser,
    to: config.email,
    subject,
    text: plainText,
    html,
  });

  // 발송 기록 업데이트 (gather_reports + daily_reports 모두)
  await storage.updateReportEmail(report.id!, Date.now(), config.email);
  if (dailyReport?.id) {
    await storage.updateDailyReportEmail(dailyReport.id, Date.now(), config.email);
  }

  console.log(`  이메일 발송 완료: ${config.email}`);
  console.log(`  제목: ${subject}`);
}

/**
 * 이메일 설정 여부만 확인 (--auto 모드에서 사용)
 */
export async function isEmailConfigured(storage: StorageAdapter): Promise<boolean> {
  const config = await getEmailConfig(storage);
  return !!(config.email && config.smtpUser && config.smtpPass);
}
