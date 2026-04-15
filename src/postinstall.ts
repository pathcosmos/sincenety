#!/usr/bin/env node

/**
 * postinstall — npm install -g 후 실행되는 통합 셋업 위저드
 *
 * Step 1: Scope 선택 (global / project)
 * Step 2: D1 Cloud Sync (Cloudflare API token)
 * Step 3: Email Delivery (Gmail / Resend / Custom SMTP)
 *
 * TTY가 없으면 (CI/Docker) 안내 메시지만 출력하고 종료.
 * 이미 설정 완료 상태면 스킵.
 */

import { createInterface } from "node:readline";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readScope, promptScope } from "./config/scope.js";
import { SqlJsAdapter } from "./storage/sqljs-adapter.js";
import { runSetupWizard } from "./config/setup-wizard.js";
import { autoSetupD1 } from "./cloud/d1-auto-setup.js";

/**
 * Claude Code skill 설치 — ~/.claude/skills/sincenety/SKILL.md로 복사.
 * TTY 여부와 무관하게 항상 실행 (CI, Docker, 일반 설치 모두).
 */
function installSkill(): void {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // 후보: 패키지 루트의 src/skill/SKILL.md (npm 배포본) 또는 dist 옆 (개발용)
    const candidates = [
      resolve(here, "..", "src", "skill", "SKILL.md"),
      resolve(here, "..", "..", "src", "skill", "SKILL.md"),
    ];
    const source = candidates.find((p) => existsSync(p));
    if (!source) return;

    const destDir = join(homedir(), ".claude", "skills", "sincenety");
    const dest = join(destDir, "SKILL.md");
    mkdirSync(destDir, { recursive: true });
    copyFileSync(source, dest);
    console.log(`  ✓ Claude Code skill installed: ${dest}`);
  } catch (err) {
    console.log(`  ⚠️  Skill install skipped: ${(err as Error).message}`);
  }
}

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * 비밀번호 프롬프트 — readline close → raw stdin → readline recreate
 */
async function promptSecret(
  question: string,
  rl: ReturnType<typeof createInterface>,
): Promise<{ value: string; rl: ReturnType<typeof createInterface> }> {
  rl.close();

  const value = await new Promise<string>((resolve) => {
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

  const newRl = createInterface({ input: process.stdin, output: process.stdout });
  return { value, rl: newRl };
}

async function main(): Promise<void> {
  // Claude Code skill 설치는 TTY 여부와 무관하게 항상 실행
  installSkill();

  // TTY 체크 — CI/Docker 등 비대화형 환경
  if (!process.stdin.isTTY) {
    console.log("  sincenety installed. Run 'sincenety config --setup' to configure.");
    return;
  }

  // 이미 설정 완료 상태 체크
  const existingScope = await readScope();
  if (existingScope) {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      const [d1Token, smtpPass, resendKey] = await Promise.all([
        storage.getConfig("d1_api_token"),
        storage.getConfig("smtp_pass"),
        storage.getConfig("resend_key"),
      ]);
      if (d1Token && (smtpPass || resendKey)) {
        console.log("  ✅ sincenety updated. Configuration preserved.");
        return;
      }
    } catch {
      // DB가 없거나 깨진 경우 — 셋업 진행
    } finally {
      await storage.close();
    }
  }

  // ─── 셋업 시작 ─────────────────────────────────
  console.log("");
  console.log("  ┌──────────────────────────────────────────────┐");
  console.log("  │  sincenety — Initial Setup                   │");
  console.log("  └──────────────────────────────────────────────┘");

  let rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // ── Step 1/3: Scope ──
    console.log("");
    console.log("  ── Step 1/3: Scope ─────────────────────────────");
    await promptScope(rl);

    // ── Step 2/3: D1 Cloud Sync ──
    console.log("");
    console.log("  ── Step 2/3: D1 Cloud Sync ─────────────────────");
    console.log("");
    console.log("  sincenety uses Cloudflare D1 for cloud sync.");
    console.log("  You need a Cloudflare API token with custom permissions.");
    console.log("");
    console.log("  How to create a token:");
    console.log("  ─────────────────────────────────────────────────");
    console.log("  1. Sign up / Log in:  https://dash.cloudflare.com");
    console.log("  2. Go to token page:  https://dash.cloudflare.com/profile/api-tokens");
    console.log('  3. Click "Create Token"');
    console.log('  4. Select "Create Custom Token"');
    console.log("  5. Token name: my-sincenety-token (or anything)");
    console.log("  6. Set permissions:");
    console.log("       Account | Workers AI       | Read");
    console.log("       Account | D1               | Edit");
    console.log("       Account | Account Settings | Read");
    console.log("  7. Account Resources → Include → your account");
    console.log("  8. Create Token → Copy the token");
    console.log("  ─────────────────────────────────────────────────");
    console.log("");

    const storage = new SqlJsAdapter();
    await storage.initialize();

    try {
      let d1Success = false;

      while (!d1Success) {
        const secretResult = await promptSecret("  D1 API token: ", rl);
        const token = secretResult.value;
        rl = secretResult.rl;

        if (!token) {
          console.log("  ⚠️  Skipped D1 setup. Configure later: sincenety config --d1-token <TOKEN>");
          break;
        }

        console.log("  Verifying Cloudflare account...");

        try {
          const existingAccountId = await storage.getConfig("d1_account_id");
          const result = await autoSetupD1(token, existingAccountId || undefined);
          await storage.setConfig("d1_api_token", token);
          await storage.setConfig("d1_account_id", result.accountId);
          await storage.setConfig("d1_database_id", result.databaseId);

          const { getMachineId } = await import("./util/machine-id.js");
          await storage.setConfig("machine_id", getMachineId());

          const { D1Client } = await import("./cloud/d1-client.js");
          const client = new D1Client(result.accountId, result.databaseId, token);
          const { ensureD1Schema } = await import("./cloud/d1-schema.js");
          await ensureD1Schema(client);

          const dbStatus = result.created ? "created" : "found";
          console.log(`  ✅ D1 ready — account: ${result.accountName}, database: sincenety (${dbStatus})`);
          d1Success = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);

          if (msg.includes("No Cloudflare account found")) {
            console.log("  ❌ No Cloudflare account found.");
            console.log('     Token may lack "Account Settings > Read" permission.');
            console.log("");
            console.log("  You can provide your Account ID manually.");
            console.log("  Find it in your Cloudflare dashboard URL:");
            console.log("    dash.cloudflare.com/<ACCOUNT_ID>/...");
            console.log("");

            const accountId = await prompt(rl, "  Account ID: ");
            if (accountId) {
              console.log("  Retrying with account ID...");
              try {
                const result = await autoSetupD1(token, accountId);
                await storage.setConfig("d1_api_token", token);
                await storage.setConfig("d1_account_id", result.accountId);
                await storage.setConfig("d1_database_id", result.databaseId);

                const { getMachineId } = await import("./util/machine-id.js");
                await storage.setConfig("machine_id", getMachineId());

                const { D1Client } = await import("./cloud/d1-client.js");
                const client = new D1Client(result.accountId, result.databaseId, token);
                const { ensureD1Schema } = await import("./cloud/d1-schema.js");
                await ensureD1Schema(client);

                console.log(`  ✅ D1 ready — database: sincenety`);
                d1Success = true;
              } catch (retryErr) {
                console.log(`  ❌ ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
              }
            }
          } else {
            console.log(`  ❌ ${msg}`);
            console.log("");
            console.log("  Possible causes:");
            console.log("    • Token does not have required permissions");
            console.log("    • Token expired or revoked");
            console.log("");
          }

          if (!d1Success) {
            const retry = await prompt(rl, "  Retry? (y/n): ");
            if (retry.toLowerCase() !== "y") {
              console.log("  ⚠️  Skipped D1 setup. Configure later: sincenety config --d1-token <TOKEN>");
              break;
            }
          }
        }
      }

      // ── Step 3/3: Email Delivery ──
      console.log("");
      console.log("  ── Step 3/3: Email Delivery ────────────────────");
      const emailResult = await runSetupWizard(storage);

      // ── Summary ──
      console.log("");
      console.log("  ═══════════════════════════════════════════════");

      const scope = await readScope();
      const scopeLabel = scope?.mode === "project"
        ? `project — ${(scope as { mode: "project"; path: string }).path}`
        : "global (all projects)";

      const d1Account = await storage.getConfig("d1_account_id");
      const email = await storage.getConfig("email");
      const provider = await storage.getConfig("provider");

      if (d1Account || emailResult.success) {
        console.log("  ✅ sincenety is ready!");
      } else {
        console.log("  ⚠️  sincenety partially configured.");
      }
      console.log("");
      console.log(`  Scope:    ${scopeLabel}`);
      console.log(`  D1:       ${d1Account ? "configured" : "not set"}`);
      console.log(`  Email:    ${email ? `${provider ?? "smtp"} → ${email}` : "not set"}`);
      console.log("");
      console.log("  Run 'sincenety' to start.");
      console.log("  ═══════════════════════════════════════════════");
      console.log("");
    } finally {
      await storage.close();
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  // postinstall 실패가 npm install 자체를 깨뜨리면 안 됨
  console.warn(`  ⚠️  Setup wizard error: ${err instanceof Error ? err.message : String(err)}`);
  console.log("  Run 'sincenety config --setup' to configure manually.");
});
