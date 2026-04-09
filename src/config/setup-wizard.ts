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

/**
 * 비밀번호 프롬프트 — readline을 close한 뒤 raw stdin으로 입력받고 readline을 재생성.
 * 기존 readline과 raw stdin이 동시에 stdin을 점유하면 Linux에서 프로세스가 종료되는 문제 방지.
 */
async function promptSecret(
  question: string,
  rl: ReturnType<typeof createInterface>,
): Promise<{ password: string; rl: ReturnType<typeof createInterface> }> {
  // readline을 완전히 닫아 stdin 점유 해제
  rl.close();

  const password = await new Promise<string>((resolve) => {
    if (process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      stdin.resume();
      let pw = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString("utf8");
        if (c === "\n" || c === "\r") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          stdin.pause();
          process.stdout.write("\n");
          resolve(pw);
        } else if (c === "\u0003") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          process.exit(0);
        } else if (c === "\u007f" || c === "\b") {
          if (pw.length > 0) pw = pw.slice(0, -1);
        } else {
          pw += c;
        }
      };
      stdin.on("data", onData);
    } else {
      const tmpRl = createInterface({ input: process.stdin, output: process.stdout });
      tmpRl.question(question, (answer) => {
        tmpRl.close();
        resolve(answer.trim());
      });
    }
  });

  // readline 재생성
  const newRl = createInterface({ input: process.stdin, output: process.stdout });
  return { password, rl: newRl };
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
  let rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("");
    console.log("  ┌──────────────────────────────────────────────┐");
    console.log("  │  sincenety Email Setup Wizard                │");
    console.log("  └──────────────────────────────────────────────┘");
    console.log("");
    console.log("  Select an email provider:");
    console.log("");
    console.log("    1) Gmail SMTP  (app password required)");
    console.log("    2) Resend API  (resend.com API key)");
    console.log("    3) Custom SMTP (manual setup)");
    console.log("");

    const choice = await prompt(rl, "  Choice (1/2/3): ");

    if (choice === "1") {
      return await setupGmail(rl, storage);
    } else if (choice === "2") {
      return await setupResend(rl, storage);
    } else if (choice === "3") {
      return await setupCustomSMTP(rl, storage);
    } else {
      console.log("  Invalid choice. Please select 1, 2, or 3.");
      return { provider: "none", success: false, message: "Invalid choice" };
    }
  } finally {
    rl.close();
  }
}

/** Gmail SMTP 설정 */
async function setupGmail(
  _rl: ReturnType<typeof createInterface>,
  storage: StorageAdapter,
): Promise<WizardResult> {
  let rl = _rl;
  console.log("");
  console.log("  ── Gmail SMTP Setup ──");
  console.log("");

  const email = await prompt(rl, "  Gmail address (send+receive): ");
  if (!email) {
    return { provider: "gmail", success: false, message: "No email provided." };
  }

  console.log("");
  console.log("  An app password is required.");
  console.log("  Create one: https://myaccount.google.com/apppasswords");
  console.log("");

  // readline close → raw stdin → readline recreate
  const secretResult = await promptSecret("  App password: ", rl);
  const password = secretResult.password;
  rl = secretResult.rl;

  if (!password) {
    return { provider: "gmail", success: false, message: "No password provided." };
  }

  console.log("");
  console.log("  Testing connection...");

  const result = await verifySMTP("smtp.gmail.com", 587, email, password);
  if (!result.ok) {
    console.log(`  ❌ Connection failed: ${result.error}`);
    return { provider: "gmail", success: false, message: `Connection failed: ${result.error}` };
  }

  await saveConfigs(storage, {
    provider: "gmail",
    email,
    smtp_user: email,
    smtp_pass: password,
    smtp_host: "smtp.gmail.com",
    smtp_port: "587",
  });

  console.log("  ✅ Gmail SMTP setup complete!");
  console.log("");
  return { provider: "gmail", success: true, message: "Gmail SMTP setup complete" };
}

/** Resend API 설정 */
async function setupResend(
  _rl: ReturnType<typeof createInterface>,
  storage: StorageAdapter,
): Promise<WizardResult> {
  let rl = _rl;
  console.log("");
  console.log("  ── Resend API Setup ──");
  console.log("");
  console.log("  Create API key: https://resend.com/api-keys");
  console.log("");

  const secretResult = await promptSecret("  Resend API key: ", rl);
  const apiKey = secretResult.password;
  rl = secretResult.rl;

  if (!apiKey) {
    return { provider: "resend", success: false, message: "No API key provided." };
  }

  const recipientEmail = await prompt(rl, "  Recipient email: ");
  if (!recipientEmail) {
    return { provider: "resend", success: false, message: "No recipient email provided." };
  }

  console.log("");
  console.log("  Verifying API key...");

  const result = await verifyResend(apiKey);
  if (!result.ok) {
    console.log(`  ❌ Verification failed: ${result.error}`);
    return { provider: "resend", success: false, message: `Verification failed: ${result.error}` };
  }

  await saveConfigs(storage, {
    provider: "resend",
    resend_key: apiKey,
    email: recipientEmail,
  });

  console.log("  ✅ Resend API setup complete!");
  console.log("");
  return { provider: "resend", success: true, message: "Resend API setup complete" };
}

/** Custom SMTP 설정 */
async function setupCustomSMTP(
  _rl: ReturnType<typeof createInterface>,
  storage: StorageAdapter,
): Promise<WizardResult> {
  let rl = _rl;
  console.log("");
  console.log("  ── Custom SMTP Setup ──");
  console.log("");

  const host = await prompt(rl, "  SMTP host: ");
  if (!host) {
    return { provider: "custom_smtp", success: false, message: "No host provided." };
  }

  const portStr = await prompt(rl, "  SMTP port (587): ");
  const port = parseInt(portStr || "587", 10);

  const user = await prompt(rl, "  SMTP user (sender email): ");
  if (!user) {
    return { provider: "custom_smtp", success: false, message: "No user provided." };
  }

  const secretResult = await promptSecret("  SMTP password: ", rl);
  const pass = secretResult.password;
  rl = secretResult.rl;

  if (!pass) {
    return { provider: "custom_smtp", success: false, message: "No password provided." };
  }

  const recipient = await prompt(rl, "  Recipient email: ");
  if (!recipient) {
    return { provider: "custom_smtp", success: false, message: "No recipient email provided." };
  }

  console.log("");
  console.log("  Testing connection...");

  const result = await verifySMTP(host, port, user, pass);
  if (!result.ok) {
    console.log(`  ❌ Connection failed: ${result.error}`);
    return { provider: "custom_smtp", success: false, message: `Connection failed: ${result.error}` };
  }

  await saveConfigs(storage, {
    provider: "custom_smtp",
    email: recipient,
    smtp_host: host,
    smtp_port: String(port),
    smtp_user: user,
    smtp_pass: pass,
  });

  console.log("  ✅ Custom SMTP setup complete!");
  console.log("");
  return { provider: "custom_smtp", success: true, message: "Custom SMTP setup complete" };
}
