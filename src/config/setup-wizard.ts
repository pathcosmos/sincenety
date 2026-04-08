/**
 * Config Setup Wizard — Gmail SMTP / Resend API / Custom SMTP 설정
 */

import { createInterface } from "node:readline";
import { createTransport } from "nodemailer";
import type { StorageAdapter } from "../storage/adapter.js";

export interface WizardResult {
  provider: string;
  success: boolean;
  message: string;
}

/** readline 기반 프롬프트 (한 줄 입력) */
function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/** 비밀번호 프롬프트 (TTY에서 에코 숨김) */
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      stdin.resume();
      let password = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString("utf8");
        if (c === "\n" || c === "\r") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          stdin.pause();
          process.stdout.write("\n");
          resolve(password);
        } else if (c === "\u0003") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          process.exit(0);
        } else if (c === "\u007f" || c === "\b") {
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += c;
        }
      };
      stdin.on("data", onData);
    } else {
      // Non-TTY fallback
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/** SMTP 연결 테스트 */
async function verifySMTP(host: string, port: number, user: string, pass: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 10000,
    });
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Resend API 키 검증 */
async function verifyResend(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/api-keys", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return { ok: true };
    }
    const body = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${body}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 설정 저장 헬퍼 */
async function saveConfigs(storage: StorageAdapter, configs: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(configs)) {
    await storage.setConfig(key, value);
  }
}

export async function runSetupWizard(storage: StorageAdapter): Promise<WizardResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("");
    console.log("  ┌──────────────────────────────────────────────┐");
    console.log("  │  sincenety 이메일 설정 위저드                │");
    console.log("  └──────────────────────────────────────────────┘");
    console.log("");
    console.log("  이메일 provider를 선택하세요:");
    console.log("");
    console.log("    1) Gmail SMTP  (앱 비밀번호 필요)");
    console.log("    2) Resend API  (resend.com API 키)");
    console.log("    3) Custom SMTP (직접 설정)");
    console.log("");

    const choice = await prompt(rl, "  선택 (1/2/3): ");

    if (choice === "1") {
      return await setupGmail(rl, storage);
    } else if (choice === "2") {
      return await setupResend(rl, storage);
    } else if (choice === "3") {
      return await setupCustomSMTP(rl, storage);
    } else {
      console.log("  잘못된 선택입니다. 1, 2, 3 중에서 선택해 주세요.");
      return { provider: "none", success: false, message: "잘못된 선택" };
    }
  } finally {
    rl.close();
  }
}

/** Gmail SMTP 설정 */
async function setupGmail(
  rl: ReturnType<typeof createInterface>,
  storage: StorageAdapter,
): Promise<WizardResult> {
  console.log("");
  console.log("  ── Gmail SMTP 설정 ──");
  console.log("");

  const email = await prompt(rl, "  Gmail 주소 (발신+수신): ");
  if (!email) {
    return { provider: "gmail", success: false, message: "이메일이 입력되지 않았습니다." };
  }

  console.log("");
  console.log("  앱 비밀번호가 필요합니다.");
  console.log("  생성: https://myaccount.google.com/apppasswords");
  console.log("");

  // readline을 일시 중지하고 secret 프롬프트 사용
  rl.pause();
  const password = await promptSecret("  앱 비밀번호: ");
  rl.resume();

  if (!password) {
    return { provider: "gmail", success: false, message: "비밀번호가 입력되지 않았습니다." };
  }

  console.log("");
  console.log("  연결 테스트 중...");

  const result = await verifySMTP("smtp.gmail.com", 587, email, password);
  if (!result.ok) {
    console.log(`  ❌ 연결 실패: ${result.error}`);
    return { provider: "gmail", success: false, message: `연결 실패: ${result.error}` };
  }

  await saveConfigs(storage, {
    provider: "gmail",
    email,
    smtp_user: email,
    smtp_pass: password,
    smtp_host: "smtp.gmail.com",
    smtp_port: "587",
  });

  console.log("  ✅ Gmail SMTP 설정 완료!");
  console.log("");
  return { provider: "gmail", success: true, message: "Gmail SMTP 설정 완료" };
}

/** Resend API 설정 */
async function setupResend(
  rl: ReturnType<typeof createInterface>,
  storage: StorageAdapter,
): Promise<WizardResult> {
  console.log("");
  console.log("  ── Resend API 설정 ──");
  console.log("");
  console.log("  API 키 생성: https://resend.com/api-keys");
  console.log("");

  // readline을 일시 중지하고 secret 프롬프트 사용
  rl.pause();
  const apiKey = await promptSecret("  Resend API 키: ");
  rl.resume();

  if (!apiKey) {
    return { provider: "resend", success: false, message: "API 키가 입력되지 않았습니다." };
  }

  const recipientEmail = await prompt(rl, "  수신 이메일 주소: ");
  if (!recipientEmail) {
    return { provider: "resend", success: false, message: "수신 이메일이 입력되지 않았습니다." };
  }

  console.log("");
  console.log("  API 키 검증 중...");

  const result = await verifyResend(apiKey);
  if (!result.ok) {
    console.log(`  ❌ 검증 실패: ${result.error}`);
    return { provider: "resend", success: false, message: `검증 실패: ${result.error}` };
  }

  await saveConfigs(storage, {
    provider: "resend",
    resend_key: apiKey,
    email: recipientEmail,
  });

  console.log("  ✅ Resend API 설정 완료!");
  console.log("");
  return { provider: "resend", success: true, message: "Resend API 설정 완료" };
}

/** Custom SMTP 설정 */
async function setupCustomSMTP(
  rl: ReturnType<typeof createInterface>,
  storage: StorageAdapter,
): Promise<WizardResult> {
  console.log("");
  console.log("  ── Custom SMTP 설정 ──");
  console.log("");

  const host = await prompt(rl, "  SMTP 호스트: ");
  if (!host) {
    return { provider: "custom_smtp", success: false, message: "호스트가 입력되지 않았습니다." };
  }

  const portStr = await prompt(rl, "  SMTP 포트 (587): ");
  const port = parseInt(portStr || "587", 10);

  const user = await prompt(rl, "  SMTP 사용자 (발신 이메일): ");
  if (!user) {
    return { provider: "custom_smtp", success: false, message: "사용자가 입력되지 않았습니다." };
  }

  rl.pause();
  const pass = await promptSecret("  SMTP 비밀번호: ");
  rl.resume();

  if (!pass) {
    return { provider: "custom_smtp", success: false, message: "비밀번호가 입력되지 않았습니다." };
  }

  const recipient = await prompt(rl, "  수신 이메일 주소: ");
  if (!recipient) {
    return { provider: "custom_smtp", success: false, message: "수신 이메일이 입력되지 않았습니다." };
  }

  console.log("");
  console.log("  연결 테스트 중...");

  const result = await verifySMTP(host, port, user, pass);
  if (!result.ok) {
    console.log(`  ❌ 연결 실패: ${result.error}`);
    return { provider: "custom_smtp", success: false, message: `연결 실패: ${result.error}` };
  }

  await saveConfigs(storage, {
    provider: "custom_smtp",
    email: recipient,
    smtp_host: host,
    smtp_port: String(port),
    smtp_user: user,
    smtp_pass: pass,
  });

  console.log("  ✅ Custom SMTP 설정 완료!");
  console.log("");
  return { provider: "custom_smtp", success: true, message: "Custom SMTP 설정 완료" };
}
