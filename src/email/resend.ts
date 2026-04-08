/**
 * Resend API 이메일 발송 — native fetch (Node 18+, 의존성 없음)
 */

import type { RenderedEmail } from "./renderer.js";

export async function sendViaResend(
  apiKey: string,
  rendered: RenderedEmail,
  fromAddress?: string,
): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress ?? "sincenety <onboarding@resend.dev>",
      to: rendered.recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<{ id: string }>;
}
