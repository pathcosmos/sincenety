#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { runAir } from "./core/air.js";
import { runCircle, circleJson, circleSave } from "./core/circle.js";
import { SqlJsAdapter } from "./storage/sqljs-adapter.js";
import type { StorageAdapter } from "./storage/adapter.js";
import { readScope, promptScope } from "./config/scope.js";

const program = new Command();

program
  .name("sincenety")
  .description("Claude Code work session tracker")
  .version("0.7.2");

// ─── setup reminder ─────────────────────────────────────

/**
 * Setup guard — blocks execution when D1 token or SMTP/Resend is missing.
 * Called before all commands except config.
 */
async function requireSetup(storage: StorageAdapter): Promise<void> {
  const missing: string[] = [];

  const d1Token = await storage.getConfig("d1_api_token");
  if (!d1Token) {
    missing.push("D1");
  }

  const [smtpPass, resendKey] = await Promise.all([
    storage.getConfig("smtp_pass"),
    storage.getConfig("resend_key"),
  ]);
  if (!smtpPass && !resendKey) {
    missing.push("email");
  }

  if (missing.length === 0) return;

  console.log("");
  console.log("  ❌ Required setup incomplete");
  console.log("  ────────────────────────────");
  console.log("");
  console.log("  Quick start (npx one-liner, all 3 flags required):");
  console.log("");
  console.log("    npx sincenety --token <D1_TOKEN> --key <RESEND_KEY> --email <ADDRESS>");
  console.log("");
  console.log("  Missing:");
  if (missing.includes("D1")) {
    console.log("    ❌ D1 cloud sync");
    console.log("       Token: https://dash.cloudflare.com/profile/api-tokens");
  }
  if (missing.includes("email")) {
    console.log("    ❌ Email delivery");
    console.log("       Resend key: https://resend.com/api-keys");
  }
  console.log("");
  console.log("  Or configure individually:");
  console.log("    sincenety config --d1-token <TOKEN>");
  console.log("    sincenety config --resend-key <KEY> --email <ADDRESS>");
  console.log("    sincenety config --setup    (interactive wizard)");
  console.log("");
  process.exit(1);
}

// ─── config status table ────────────────────────────────

async function showConfigStatus(storage: StorageAdapter): Promise<void> {
  const keys = [
    { key: "provider", label: "provider", defaultVal: "gmail" },
    { key: "email", label: "email", defaultVal: null },
    { key: "smtp_host", label: "smtp_host", defaultVal: "smtp.gmail.com" },
    { key: "smtp_port", label: "smtp_port", defaultVal: "587" },
    { key: "smtp_user", label: "smtp_user", defaultVal: null },
    { key: "smtp_pass", label: "smtp_pass", defaultVal: null },
    { key: "resend_key", label: "resend_key", defaultVal: null },
  ];

  const rows: Array<{ label: string; value: string; status: string }> = [];

  for (const k of keys) {
    const val = await storage.getConfig(k.key);
    let displayVal: string;
    let status: string;

    if (val) {
      if (k.key === "smtp_pass" || k.key === "resend_key") {
        displayVal = "********";
      } else {
        displayVal = val;
      }
      status = "✅ set";
    } else if (k.defaultVal) {
      displayVal = k.defaultVal;
      status = "✅ default";
    } else {
      displayVal = "(not set)";
      status = "❌ required";
    }

    rows.push({ label: k.label, value: displayVal, status });
  }

  // 열 폭 계산 (표시 폭 기준)
  const labelW = Math.max(12, ...rows.map((r) => displayWidth(r.label)));
  const valueW = Math.max(20, ...rows.map((r) => displayWidth(r.value)));
  const statusW = Math.max(10, ...rows.map((r) => displayWidth(r.status)));

  const hLine = (l: string, m: string, r: string) =>
    l +
    "─".repeat(labelW + 2) +
    m +
    "─".repeat(valueW + 2) +
    m +
    "─".repeat(statusW + 2) +
    r;

  console.log("");
  console.log("  sincenety configuration");
  console.log("  " + hLine("┌", "┬", "┐"));
  console.log(
    "  │" +
      ` ${padEndW("Key", labelW)} │` +
      ` ${padEndW("Value", valueW)} │` +
      ` ${padEndW("Status", statusW)} │`,
  );
  console.log("  " + hLine("├", "┼", "┤"));

  for (const r of rows) {
    console.log(
      "  │" +
        ` ${padEndW(r.label, labelW)} │` +
        ` ${padEndW(r.value, valueW)} │` +
        ` ${padEndW(r.status, statusW)} │`,
    );
  }

  console.log("  " + hLine("└", "┴", "┘"));

  // D1 section
  const { getMachineId } = await import("./util/machine-id.js");
  const d1Keys = [
    { key: "d1_account_id", label: "d1_account_id" },
    { key: "d1_database_id", label: "d1_database_id" },
    { key: "d1_api_token", label: "d1_api_token" },
    { key: "machine_id", label: "machine_id" },
    { key: "last_d1_sync", label: "last_d1_sync" },
  ];

  const d1Rows: Array<{ label: string; value: string; status: string }> = [];

  for (const k of d1Keys) {
    const val = await storage.getConfig(k.key);
    let displayVal: string;
    let status: string;

    if (val) {
      if (k.key === "d1_api_token") {
        displayVal = "********";
      } else {
        displayVal = val;
      }
      status = "✅ set";
    } else if (k.key === "machine_id") {
      displayVal = getMachineId();
      status = "✅ auto";
    } else {
      displayVal = "(not set)";
      status = "─";
    }

    d1Rows.push({ label: k.label, value: displayVal, status });
  }

  const d1LabelW = Math.max(labelW, ...d1Rows.map((r) => displayWidth(r.label)));
  const d1ValueW = Math.max(valueW, ...d1Rows.map((r) => displayWidth(r.value)));
  const d1StatusW = Math.max(statusW, ...d1Rows.map((r) => displayWidth(r.status)));

  const d1HLine = (l: string, m: string, r: string) =>
    l +
    "─".repeat(d1LabelW + 2) +
    m +
    "─".repeat(d1ValueW + 2) +
    m +
    "─".repeat(d1StatusW + 2) +
    r;

  console.log("");
  console.log("  D1 cloud sync");
  console.log("  " + d1HLine("┌", "┬", "┐"));
  console.log(
    "  │" +
      ` ${padEndW("Key", d1LabelW)} │` +
      ` ${padEndW("Value", d1ValueW)} │` +
      ` ${padEndW("Status", d1StatusW)} │`,
  );
  console.log("  " + d1HLine("├", "┼", "┤"));

  for (const r of d1Rows) {
    console.log(
      "  │" +
        ` ${padEndW(r.label, d1LabelW)} │` +
        ` ${padEndW(r.value, d1ValueW)} │` +
        ` ${padEndW(r.status, d1StatusW)} │`,
    );
  }

  console.log("  " + d1HLine("└", "┴", "┘"));

  // AI provider section
  const { resolveAiProvider } = await import("./core/ai-provider.js");
  const aiProviderExplicit = await storage.getConfig("ai_provider");
  const resolved = await resolveAiProvider(storage);
  const aiVal = aiProviderExplicit ?? "auto";
  const aiResolved = aiProviderExplicit ? resolved : `auto → ${resolved}`;
  console.log(`  AI summary: ai_provider = ${aiVal} (${aiResolved})`);
  console.log("");
}

/** 표시 폭 계산 (한글/이모지=2, ASCII=1) */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd) ||
      // common emoji ranges
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x1f300 && code <= 0x1f9ff)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function padEndW(str: string, width: number): string {
  const diff = width - displayWidth(str);
  return diff > 0 ? str + " ".repeat(diff) : str;
}

// ─── air 명령 ───────────────────────────────────────────

program
  .command("air")
  .description("Collect sessions by date (history.jsonl → DB)")
  .option("--history <path>", "Path to history.jsonl")
  .option("--json", "Output JSON by date")
  .action(async (options) => {
    // --history 경로 검증
    let historyPath: string | undefined;
    if (options.history) {
      historyPath = resolve(options.history);
      if (!existsSync(historyPath)) {
        console.error(`  ❌ History file not found: ${historyPath}`);
        process.exit(1);
      }
    }

    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      await requireSetup(storage);

      const result = await runAir(storage, { historyPath });

      if (options.json) {
        const output: Record<string, unknown> = {};
        for (const dateStr of result.changedDates) {
          const report = await storage.getGatherReportByDate(dateStr);
          if (report?.reportJson) {
            try {
              output[dateStr] = JSON.parse(report.reportJson);
            } catch {
              output[dateStr] = [];
            }
          } else {
            output[dateStr] = [];
          }
        }
        console.log(JSON.stringify(output));
      } else {
        console.log("");
        console.log(`  📋 air complete`);
        console.log(`     Date range: ${result.dates.length} days (backfill ${result.backfillDays} days)`);
        console.log(`     Total sessions: ${result.totalSessions}`);
        console.log(`     Changed dates: ${result.changedDates.length}`);
        if (result.changedDates.length > 0) {
          console.log(`     Changed: ${result.changedDates.join(", ")}`);
        }
        if (result.isFirstRun) {
          console.log(`     [First run — 90-day backfill]`);
        }
        console.log("");
      }
    } catch (err) {
      console.error(
        `  ❌ ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// ─── circle 명령 ────────────────────────────────────────

program
  .command("circle")
  .description("Finalize with AI summary (JSON output/save)")
  .option("--json", "Output session data as JSON (for SKILL.md)")
  .option("--save", "Save stdin JSON → daily_reports")
  .option("--summarize", "Include Workers AI summaries (with --json)")
  .option("--type <type>", "Report type: daily | weekly | monthly", "daily")
  .option("--history <path>", "Path to history.jsonl")
  .action(async (options) => {
    if (options.save) {
      // stdin JSON 읽기
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      const input = Buffer.concat(chunks).toString("utf-8").trim();

      if (!input) {
        console.error("  ❌ No input data. Please pipe JSON via stdin.");
        process.exit(1);
      }

      let data: {
        date: string;
        overview?: string;
        sessions: Array<{
          sessionId: string;
          projectName?: string;
          topic?: string;
          outcome?: string;
          flow?: string;
          significance?: string;
          nextSteps?: string;
        }>;
      };

      try {
        data = JSON.parse(input);
        if (!data.date || !Array.isArray(data.sessions)) {
          throw new Error("'date' and 'sessions' fields are required");
        }
      } catch (err) {
        console.error(
          `  ❌ JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      const storage = new SqlJsAdapter();
      try {
        await storage.initialize();
        await circleSave(storage, {
          ...data,
          type: options.type as "daily" | "weekly" | "monthly",
        });
        console.log(
          `  ✅ ${options.type} report saved: ${data.date} (${data.sessions.length} sessions)`,
        );
      } catch (err) {
        console.error(
          `  ❌ ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      } finally {
        await storage.close();
      }
      return;
    }

    // --history 경로 검증
    let historyPath: string | undefined;
    if (options.history) {
      historyPath = resolve(options.history);
      if (!existsSync(historyPath)) {
        console.error(`  ❌ History file not found: ${historyPath}`);
        process.exit(1);
      }
    }

    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      await requireSetup(storage);

      if (options.json) {
        const jsonResult = await circleJson(storage, { historyPath, summarize: options.summarize });
        console.log(JSON.stringify(jsonResult));
      } else {
        const result = await runCircle(storage, { historyPath });
        console.log("");
        console.log(`  📋 circle complete`);
        console.log(`     Date range: ${result.airResult.dates.length} days`);
        console.log(`     Total sessions: ${result.airResult.totalSessions}`);
        console.log(`     Changed dates: ${result.airResult.changedDates.length}`);
        if (result.finalized.length > 0) {
          console.log(`     Finalized: ${result.finalized.join(", ")}`);
        }
        if (result.needsSummary.length > 0) {
          console.log(`     Needs summary: ${result.needsSummary.join(", ")}`);
        }
        console.log("");
      }
    } catch (err) {
      console.error(
        `  ❌ ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// ─── out 명령 ──────────────────────────────────────────

program
  .command("out")
  .description("Smart report dispatch (auto-detect daily/weekly/monthly)")
  .option("--preview", "Preview only, do not send")
  .option("--render-only", "Output HTML/subject/recipient JSON (for Gmail MCP)")
  .option("--date <yyyyMMdd>", "Target date (e.g. 20260409)")
  .option("--history", "Show recent send history")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();

      if (options.history) {
        const logs = await storage.getEmailLogs(20);
        if (logs.length === 0) {
          console.log("  No send history found.");
          return;
        }

        // ANSI table
        const dateW = 12;
        const typeW = 8;
        const recipW = 30;
        const statusW = 8;
        const hLine = (l: string, m: string, r: string) =>
          l +
          "─".repeat(dateW + 2) +
          m +
          "─".repeat(typeW + 2) +
          m +
          "─".repeat(recipW + 2) +
          m +
          "─".repeat(statusW + 2) +
          r;

        console.log("");
        console.log("  Recent send history");
        console.log("  " + hLine("┌", "┬", "┐"));
        console.log(
          "  │" +
            ` ${padEndW("Date", dateW)} │` +
            ` ${padEndW("Type", typeW)} │` +
            ` ${padEndW("Recipient", recipW)} │` +
            ` ${padEndW("Status", statusW)} │`,
        );
        console.log("  " + hLine("├", "┼", "┤"));

        for (const log of logs) {
          const dateStr = log.reportDate;
          const typeStr = log.reportType;
          const recip = log.recipient.length > recipW
            ? log.recipient.slice(0, recipW - 2) + ".."
            : log.recipient;
          const status = log.status;
          console.log(
            "  │" +
              ` ${padEndW(dateStr, dateW)} │` +
              ` ${padEndW(typeStr, typeW)} │` +
              ` ${padEndW(recip, recipW)} │` +
              ` ${padEndW(status, statusW)} │`,
          );
        }

        console.log("  " + hLine("└", "┴", "┘"));
        console.log("");
        return;
      }

      await requireSetup(storage);
      const { runOut } = await import("./core/out.js");
      const result = await runOut(storage, {
        preview: options.preview,
        renderOnly: options.renderOnly,
        date: options.date,
      });
      if (!options.renderOnly) {
        const parts = [`${result.sent} sent`, `${result.skipped} skipped`];
        if (result.errors > 0) parts.push(`${result.errors} errors`);
        console.log(`  ✅ out complete — ${parts.join(", ")}`);
      }
      for (const e of result.entries) {
        if (e.status === "error" && e.error) {
          console.error(`  ⚠️  [${e.type}] ${e.error}`);
        }
      }
    } catch (err) {
      console.error(
        `  ❌ ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// ─── outd / outw / outm 명령 ──────────────────────────

for (const [cmd, type, desc] of [
  ["outd", "daily", "Force send daily report"],
  ["outw", "weekly", "Force send weekly report"],
  ["outm", "monthly", "Force send monthly report"],
] as const) {
  program
    .command(cmd)
    .description(desc)
    .option("--preview", "Preview only, do not send")
    .option("--date <yyyyMMdd>", "Target date (e.g. 20260409)")
    .action(async (options) => {
      const storage = new SqlJsAdapter();
      try {
        await storage.initialize();
        await requireSetup(storage);
        const { runOut } = await import("./core/out.js");
        const result = await runOut(storage, {
          force: type,
          preview: options.preview,
          date: options.date,
        });
        const parts = [`${result.sent} sent`, `${result.skipped} skipped`];
        if (result.errors > 0) parts.push(`${result.errors} errors`);
        console.log(`  ✅ ${cmd} complete — ${parts.join(", ")}`);
        for (const e of result.entries) {
          if (e.status === "error" && e.error) {
            console.error(`  ⚠️  [${e.type}] ${e.error}`);
          }
        }
      } catch (err) {
        console.error(
          `  ❌ ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      } finally {
        await storage.close();
      }
    });
}

// ─── config 명령 ────────────────────────────────────────

program
  .command("config")
  .description("Configuration management")
  .option("--set-passphrase", "Set encryption passphrase")
  .option("--email <address>", "Set recipient email address")
  .option("--smtp-host <host>", "SMTP host (default: smtp.gmail.com)")
  .option("--smtp-port <port>", "SMTP port (default: 587)")
  .option("--smtp-user <user>", "SMTP user (sender email)")
  .option("--smtp-pass [pass]", "Set SMTP app password")
  .option("--provider <provider>", "Email provider (gmail | resend | custom_smtp)")
  .option("--resend-key <key>", "Set Resend API key")
  .option("--vacation <dates...>", "Register vacation (YYYY-MM-DD)")
  .option("--vacation-list", "List registered vacations")
  .option("--vacation-clear <date>", "Remove vacation (YYYY-MM-DD)")
  .option("--vacation-type <type>", "Vacation type (vacation | sick | holiday | half | other)", "vacation")
  .option("--d1-account <id>", "Cloudflare Account ID")
  .option("--d1-database <id>", "D1 Database ID")
  .option("--d1-token <token>", "Cloudflare API Token")
  .option("--machine-name <name>", "Machine identifier name")
  .option("--ai-provider <provider>", "AI summary provider (cloudflare | anthropic | claude-code | auto)")
  .option("--setup-d1", "D1 setup wizard")
  .option("--setup", "Run setup wizard")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      let changed = false;
      let hasAction = false;

      if (options.setup) {
        hasAction = true;
        const { runSetupWizard } = await import("./config/setup-wizard.js");
        await runSetupWizard(storage);
        return;
      }

      if (options.setPassphrase) {
        hasAction = true;
        console.log(
          "  Passphrase setup is not yet available. (coming soon)",
        );
      }

      if (options.email) {
        hasAction = true;
        await storage.setConfig("email", options.email);
        console.log(`  email = ${options.email}`);
        changed = true;
      }

      if (options.smtpHost) {
        hasAction = true;
        await storage.setConfig("smtp_host", options.smtpHost);
        console.log(`  smtp_host = ${options.smtpHost}`);
        changed = true;
      }

      if (options.smtpPort) {
        hasAction = true;
        await storage.setConfig("smtp_port", options.smtpPort);
        console.log(`  smtp_port = ${options.smtpPort}`);
        changed = true;
      }

      if (options.smtpUser) {
        hasAction = true;
        await storage.setConfig("smtp_user", options.smtpUser);
        console.log(`  smtp_user = ${options.smtpUser}`);
        changed = true;
      }

      if (options.smtpPass !== undefined) {
        hasAction = true;
        let password: string;
        if (typeof options.smtpPass === "string") {
          // 값이 직접 전달됨
          password = options.smtpPass;
        } else {
          // 플래그만 — 프롬프트로 입력
          password = await promptPassword("  SMTP app password: ");
        }
        if (password) {
          await storage.setConfig("smtp_pass", password);
          console.log("  smtp_pass = ********");
          changed = true;
        } else {
          console.log("  No password entered.");
        }
      }

      if (options.provider) {
        hasAction = true;
        await storage.setConfig("provider", options.provider);
        console.log(`  provider = ${options.provider}`);
        changed = true;
      }

      if (options.resendKey) {
        hasAction = true;
        await storage.setConfig("resend_key", options.resendKey);
        console.log("  resend_key = ********");
        changed = true;
      }

      if (options.vacation) {
        hasAction = true;
        const vacationType = options.vacationType || "vacation";
        for (const date of options.vacation) {
          await storage.saveVacation({
            date,
            type: vacationType,
            source: "manual",
            label: null,
            createdAt: Date.now(),
          });
          console.log(`  Vacation registered: ${date} (${vacationType})`);
        }
        changed = true;
      }

      if (options.vacationList) {
        hasAction = true;
        // 올해 범위로 조회
        const now = new Date();
        const yearStart = `${now.getFullYear()}-01-01`;
        const yearEnd = `${now.getFullYear()}-12-31`;
        const vacations = await storage.getVacationsByRange(yearStart, yearEnd);
        if (vacations.length === 0) {
          console.log("  No vacations registered.");
        } else {
          console.log(`\n  📅 Registered vacations (${vacations.length})`);
          for (const v of vacations) {
            console.log(`    ${v.date}  ${v.type}  (${v.source})`);
          }
          console.log("");
        }
      }

      if (options.vacationClear) {
        hasAction = true;
        await storage.deleteVacation(options.vacationClear);
        console.log(`  Vacation removed: ${options.vacationClear}`);
        changed = true;
      }

      if (options.d1Account) {
        hasAction = true;
        await storage.setConfig("d1_account_id", options.d1Account);
        console.log(`  d1_account_id = ${options.d1Account}`);
        changed = true;
      }
      if (options.d1Database) {
        hasAction = true;
        await storage.setConfig("d1_database_id", options.d1Database);
        console.log(`  d1_database_id = ${options.d1Database}`);
        changed = true;
      }
      if (options.d1Token) {
        hasAction = true;
        console.log("  Verifying Cloudflare account...");
        const { autoSetupD1 } = await import("./cloud/d1-auto-setup.js");
        try {
          const existingAccountId = await storage.getConfig("d1_account_id");
          const result = await autoSetupD1(options.d1Token, existingAccountId || undefined);
          await storage.setConfig("d1_api_token", options.d1Token);
          await storage.setConfig("d1_account_id", result.accountId);
          await storage.setConfig("d1_database_id", result.databaseId);
          console.log(`  ✅ Account: ${result.accountName} (${result.accountId.slice(0, 8)}...)`);
          if (result.created) {
            console.log(`  ✅ 'sincenety' DB created (${result.databaseId.slice(0, 8)}...)`);
          } else {
            console.log(`  ✅ 'sincenety' DB found (${result.databaseId.slice(0, 8)}...)`);
          }
          // Auto machine ID
          const { getMachineId } = await import("./util/machine-id.js");
          const mid = getMachineId();
          await storage.setConfig("machine_id", mid);
          console.log(`  ✅ machine_id: ${mid}`);
          // Schema setup
          const { D1Client } = await import("./cloud/d1-client.js");
          const client = new D1Client(result.accountId, result.databaseId, options.d1Token);
          const { ensureD1Schema } = await import("./cloud/d1-schema.js");
          await ensureD1Schema(client);
          console.log("  ✅ D1 schema setup complete!");
          changed = true;
        } catch (err) {
          console.error(`  ❌ D1 setup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (options.machineName) {
        hasAction = true;
        await storage.setConfig("machine_id", options.machineName);
        console.log(`  machine_id = ${options.machineName}`);
        changed = true;
      }
      if (options.aiProvider) {
        hasAction = true;
        const validProviders = ["cloudflare", "anthropic", "claude-code", "auto"];
        if (!validProviders.includes(options.aiProvider)) {
          console.log(`  ❌ Valid values: ${validProviders.join(", ")}`);
        } else {
          await storage.setConfig("ai_provider", options.aiProvider);
          console.log(`  ai_provider = ${options.aiProvider}`);
          changed = true;
        }
      }
      if (options.setupD1) {
        hasAction = true;
        console.log("  D1 setup: sincenety config --d1-token <API_TOKEN>");
        console.log("  Account/DB/machine auto-detected from token.");
        return;
      }

      if (changed) {
        console.log("  Configuration saved.");
      }

      // 아무 옵션도 없으면 상태 테이블 출력
      if (!hasAction) {
        await showConfigStatus(storage);
      }
    } finally {
      await storage.close();
    }
  });

// ─── schedule 명령 ──────────────────────────────────────

// schedule 명령 — 비활성화 (향후 재구현 예정)
// program.command("schedule") ...

// ─── sync 명령 ─────────────────────────────────────────

program
  .command("sync")
  .description("D1 cloud DB sync")
  .option("--push", "Push local → D1")
  .option("--pull-config", "Pull shared config from D1")
  .option("--status", "Check sync status")
  .option("--init", "Initialize D1 schema")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      await requireSetup(storage);

      const { loadD1Client, pushToD1, pullConfigFromD1, getSyncStatus, getAutoMachineId } = await import("./cloud/sync.js");
      const { ensureD1Schema } = await import("./cloud/d1-schema.js");

      const client = await loadD1Client(storage);
      if (!client) {
        console.log("  D1 setup required:");
        console.log("    sincenety config --d1-token <API_TOKEN>");
        console.log("  (Account/DB auto-detected from token)");
        return;
      }

      const machineId = await getAutoMachineId(storage);

      if (options.init) {
        console.log("  Creating D1 schema...");
        await ensureD1Schema(client);
        console.log("  ✅ D1 schema created");
        return;
      }

      if (options.status) {
        const status = await getSyncStatus(storage, client, machineId);
        console.log("\n  D1 sync status");
        console.log("  ┌────────────────┬──────────────────────┐");
        console.log(`  │ Configured     │ ${status.configured ? "✅ yes" : "❌ no"}${"".padEnd(14)} │`);
        console.log(`  │ D1 connection  │ ${status.d1Reachable ? "✅ ok" : "❌ fail"}${"".padEnd(14)} │`);
        console.log(`  │ Last sync      │ ${status.lastSync ? new Date(status.lastSync).toISOString().slice(0, 19) : "(none)"}${"".padEnd(Math.max(0, 20 - (status.lastSync ? 19 : 6)))} │`);
        console.log(`  │ Pending        │ ~${status.pendingRows} rows${"".padEnd(15)} │`);
        console.log(`  │ machine_id     │ ${machineId.padEnd(20)} │`);
        console.log("  └────────────────┴──────────────────────┘");

        // Show registered machines
        try {
          const machinesRes = await client.query<{machine_id: string; platform: string; label: string; last_sync_at: number}>(
            "SELECT machine_id, platform, label, last_sync_at FROM machines ORDER BY last_sync_at DESC"
          );
          if (machinesRes.results.length > 0) {
            console.log("\n  Registered machines:");
            for (const m of machinesRes.results) {
              const lastSync = m.last_sync_at ? new Date(m.last_sync_at).toISOString().slice(0, 19) : "(none)";
              const label = m.label ? ` (${m.label})` : "";
              console.log(`    ${m.machine_id}${label} — ${m.platform} — ${lastSync}`);
            }
          }
        } catch { /* ignore if machines table not yet created */ }
        console.log("");
        return;
      }

      if (options.pullConfig) {
        console.log("  Pulling shared config from D1...");
        const changed = await pullConfigFromD1(storage, client);
        if (changed.length > 0) {
          console.log(`  ✅ ${changed.length} config(s) pulled: ${changed.join(", ")}`);
        } else {
          console.log("  No config changes.");
        }
        return;
      }

      // Default: push
      console.log(`  Pushing to D1... (machine: ${machineId})`);
      await ensureD1Schema(client);
      const result = await pushToD1(storage, client, machineId);
      const total = result.pushed.sessions + result.pushed.gatherReports + result.pushed.dailyReports + result.pushed.emailLogs + result.pushed.vacations;
      console.log(`  ✅ D1 sync complete — ${total} rows pushed`);
      if (result.pushed.config > 0) console.log(`     ${result.pushed.config} shared config(s) synced`);
      if (result.errors.length > 0) {
        console.log(`  ⚠️  ${result.errors.length} error(s): ${result.errors.slice(0, 3).join(", ")}`);
      }
    } catch (err) {
      console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// ─── utils ──────────────────────────────────────────────

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      // TTY: raw mode로 에코 없이 직접 입력 받기
      process.stdout.write(prompt);
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
          // Ctrl+C
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          process.exit(0);
        } else if (c === "\u007f" || c === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += c;
        }
      };
      stdin.on("data", onData);
    } else {
      // Non-TTY: readline으로 한 줄 읽기
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

// ─── default action (no subcommand) ────────────────────
// sincenety (no args) = full pipeline: air → circle → out

program
  .option("--token <token>", "Cloudflare D1 API token (saves to config)")
  .option("--key <key>", "Resend API key (saves to config)")
  .option("--email <address>", "Recipient email address (saves to config)")
  .action(async (options) => {
  const storage = new SqlJsAdapter();
  try {
    await storage.initialize();

    // ── Scope check ──
    let scope = await readScope();
    if (!scope) {
      console.log("");
      console.log("  ── Choose scope ──");
      scope = await promptScope();
    }

    // Inline setup: --token / --key / --email → save to config and proceed
    if (options.token) {
      console.log("  Verifying Cloudflare account...");
      const { autoSetupD1 } = await import("./cloud/d1-auto-setup.js");
      try {
        const existingAccountId = await storage.getConfig("d1_account_id");
        const result = await autoSetupD1(options.token, existingAccountId || undefined);
        await storage.setConfig("d1_api_token", options.token);
        await storage.setConfig("d1_account_id", result.accountId);
        await storage.setConfig("d1_database_id", result.databaseId);
        const { getMachineId } = await import("./util/machine-id.js");
        await storage.setConfig("machine_id", getMachineId());
        const { D1Client } = await import("./cloud/d1-client.js");
        const client = new D1Client(result.accountId, result.databaseId, options.token);
        const { ensureD1Schema } = await import("./cloud/d1-schema.js");
        await ensureD1Schema(client);
        console.log(`  ✅ D1 ready (${result.accountName})`);
      } catch (err) {
        console.error(`  ❌ D1 setup failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    }
    if (options.key) {
      await storage.setConfig("resend_key", options.key);
      await storage.setConfig("provider", "resend");
      console.log("  ✅ Resend API key saved");
    }
    if (options.email) {
      await storage.setConfig("email", options.email);
      console.log(`  ✅ Email: ${options.email}`);
    }

    // Check required settings: D1 + email (SMTP or Resend)
    const [d1Token, smtpPass, resendKey] = await Promise.all([
      storage.getConfig("d1_api_token"),
      storage.getConfig("smtp_pass"),
      storage.getConfig("resend_key"),
    ]);

    const missingD1 = !d1Token;
    const missingEmail = !smtpPass && !resendKey;

    if (missingD1 || missingEmail) {
      console.log("");
      console.log("  ⚠️  Required setup incomplete");
      console.log("  ─────────────────────────────");
      console.log("");
      console.log("  Quick start (npx one-liner, all 3 flags required):");
      console.log("");
      console.log("    npx sincenety --token <D1_TOKEN> --key <RESEND_KEY> --email <ADDRESS>");
      console.log("");
      console.log("  How to create a D1 token:");
      console.log("  ─────────────────────────────────────────────────");
      console.log("  1. Sign up / Log in:  https://dash.cloudflare.com");
      console.log("  2. Go to token page:  https://dash.cloudflare.com/profile/api-tokens");
      console.log('  3. Click "Create Token" → "Create Custom Token"');
      console.log("  4. Set permissions:");
      console.log("       Account | Workers AI       | Read");
      console.log("       Account | D1               | Edit");
      console.log("       Account | Account Settings | Read");
      console.log("  5. Account Resources → Include → your account");
      console.log("  6. Create Token → Copy the token");
      console.log("  ─────────────────────────────────────────────────");
      console.log("");
      console.log("  Missing:");
      if (missingD1) {
        console.log("    ❌ D1 cloud sync");
      }
      if (missingEmail) {
        console.log("    ❌ Email delivery (Resend key: https://resend.com/api-keys)");
      }
      console.log("");
      console.log("  Or configure interactively:");
      console.log("    sincenety config --setup");
      console.log("");
      process.exit(1);
    }

    // Full pipeline: out internally runs circle → air
    const { runOut } = await import("./core/out.js");
    const result = await runOut(storage, { scope });
    const parts = [`${result.sent} sent`, `${result.skipped} skipped`];
    if (result.errors > 0) parts.push(`${result.errors} errors`);
    console.log(`  ✅ sincenety complete — ${parts.join(", ")}`);
    for (const e of result.entries) {
      if (e.status === "error" && e.error) {
        console.error(`  ⚠️  [${e.type}] ${e.error}`);
      }
    }
  } catch (err) {
    console.error(
      `  ❌ ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  } finally {
    await storage.close();
  }
});

program.parse();
