/**
 * 이메일 Provider 추상화 — Resend API / SMTP 자동 감지 및 라우팅
 */

import type { StorageAdapter, EmailLog } from "../storage/adapter.js";
import type { RenderedEmail } from "./renderer.js";
import { sendViaResend } from "./resend.js";
import { sendEmailViaSMTP } from "./sender.js";

export type EmailProvider = "resend" | "gmail_smtp" | "custom_smtp" | "none";

export interface ProviderConfig {
  provider: string | null;
  resendKey: string | null;
  smtpPass: string | null;
  smtpHost: string | null;
  smtpPort: string | null;
  smtpUser: string | null;
  email: string | null;
}

/**
 * 설정으로부터 이메일 provider 감지
 *
 * 우선순위:
 * 1. 명시적 provider 설정 ("resend" | "smtp" | "gmail")
 * 2. 자동 감지: resend_key → "resend", smtp_pass → "gmail_smtp"
 * 3. 없으면 "none"
 */
export function detectProvider(config: ProviderConfig): EmailProvider {
  const explicit = config.provider?.toLowerCase();

  if (explicit) {
    if (explicit === "resend" && config.resendKey) return "resend";
    if (explicit === "smtp" && config.smtpPass) return "custom_smtp";
    if (explicit === "gmail" && config.smtpPass) return "gmail_smtp";
  }

  // 자동 감지
  if (config.resendKey) return "resend";
  if (config.smtpPass) return "gmail_smtp";

  return "none";
}

/**
 * DB에서 provider 관련 설정을 일괄 로드
 */
export async function loadProviderConfig(
  storage: StorageAdapter,
): Promise<ProviderConfig> {
  const [provider, resendKey, smtpPass, smtpHost, smtpPort, smtpUser, email] =
    await Promise.all([
      storage.getConfig("provider"),
      storage.getConfig("resend_key"),
      storage.getConfig("smtp_pass"),
      storage.getConfig("smtp_host"),
      storage.getConfig("smtp_port"),
      storage.getConfig("smtp_user"),
      storage.getConfig("email"),
    ]);

  return { provider, resendKey, smtpPass, smtpHost, smtpPort, smtpUser, email };
}

/**
 * Provider를 감지하여 이메일 발송 + email_logs에 기록
 *
 * 성공 시 status="sent", 실패 시 status="failed" + errorMessage 기록 후 re-throw
 */
export async function sendEmail(
  storage: StorageAdapter,
  rendered: RenderedEmail,
): Promise<void> {
  const config = await loadProviderConfig(storage);
  const provider = detectProvider(config);

  if (provider === "none") {
    throw new Error(
      "이메일 provider가 설정되지 않았습니다. " +
        "sincenety config --resend-key 또는 --smtp-pass 로 설정하세요.",
    );
  }

  // EmailLog 초기 구성
  const log: EmailLog = {
    sentAt: Date.now(),
    reportType: rendered.reportType,
    reportDate: rendered.reportDate,
    periodFrom: rendered.periodFrom,
    periodTo: rendered.periodTo,
    recipient: rendered.recipient,
    subject: rendered.subject,
    bodyHtml: rendered.html,
    bodyText: rendered.text,
    provider,
    status: "sent",
    errorMessage: null,
  };

  try {
    if (provider === "resend") {
      await sendViaResend(config.resendKey!, rendered);
    } else {
      // gmail_smtp | custom_smtp — 둘 다 SMTP 경로
      await sendEmailViaSMTP(storage, rendered);
    }

    log.status = "sent";
    await storage.saveEmailLog(log);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.status = "failed";
    log.errorMessage = message;
    await storage.saveEmailLog(log);
    throw err;
  }
}
