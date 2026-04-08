#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { runAir } from "./core/air.js";
import { runCircle, circleJson, circleSave } from "./core/circle.js";
import { SqlJsAdapter } from "./storage/sqljs-adapter.js";
import type { StorageAdapter } from "./storage/adapter.js";
import {
  installSchedule,
  uninstallSchedule,
  getScheduleStatus,
} from "./scheduler/install.js";

const program = new Command();

program
  .name("sincenety")
  .description("Claude Code 작업 갈무리 도구")
  .version("0.3.0");

// ─── setup reminder ─────────────────────────────────────

/**
 * 필수 설정 가드 — D1 토큰 + SMTP(또는 Resend) 미설정 시 실행 차단.
 * 모든 커맨드(config 제외) 실행 전에 호출.
 */
async function requireSetup(storage: StorageAdapter): Promise<void> {
  const missing: string[] = [];

  // 1. D1 토큰 체크
  const d1Token = await storage.getConfig("d1_api_token");
  if (!d1Token) {
    missing.push("D1");
  }

  // 2. 이메일 발송 체크 (SMTP 또는 Resend)
  const [smtpPass, resendKey] = await Promise.all([
    storage.getConfig("smtp_pass"),
    storage.getConfig("resend_key"),
  ]);
  if (!smtpPass && !resendKey) {
    missing.push("이메일");
  }

  if (missing.length === 0) return;

  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────────┐");
  console.log("  │ ❌ 필수 설정이 완료되지 않았습니다                      │");
  console.log("  ├──────────────────────────────────────────────────────────┤");
  if (missing.includes("D1")) {
    console.log("  │ 1. D1 클라우드 동기화 (필수)                            │");
    console.log("  │    sincenety config --d1-token <API_TOKEN>              │");
    console.log("  │    토큰 생성: https://dash.cloudflare.com/profile/api-tokens │");
  }
  if (missing.includes("이메일")) {
    console.log("  │ 2. 이메일 발송 (필수)                                   │");
    console.log("  │    sincenety config --setup                             │");
    console.log("  │    Gmail 앱 비밀번호: https://myaccount.google.com/apppasswords │");
  }
  console.log("  └──────────────────────────────────────────────────────────┘");
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
      status = "✅ 설정됨";
    } else if (k.defaultVal) {
      displayVal = k.defaultVal;
      status = "✅ 기본값";
    } else {
      displayVal = "(미설정)";
      status = "❌ 필요";
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
  console.log("  sincenety 설정 상태");
  console.log("  " + hLine("┌", "┬", "┐"));
  console.log(
    "  │" +
      ` ${padEndW("항목", labelW)} │` +
      ` ${padEndW("값", valueW)} │` +
      ` ${padEndW("상태", statusW)} │`,
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
      status = "✅ 설정됨";
    } else if (k.key === "machine_id") {
      displayVal = getMachineId();
      status = "✅ 자동감지";
    } else {
      displayVal = "(미설정)";
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
  console.log("  D1 클라우드 동기화");
  console.log("  " + d1HLine("┌", "┬", "┐"));
  console.log(
    "  │" +
      ` ${padEndW("항목", d1LabelW)} │` +
      ` ${padEndW("값", d1ValueW)} │` +
      ` ${padEndW("상태", d1StatusW)} │`,
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
  console.log(`  AI 요약: ai_provider = ${aiVal} (${aiResolved})`);
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
  .description("환기 — 날짜별 갈무리 (history.jsonl → DB)")
  .option("--history <path>", "history.jsonl 경로")
  .option("--json", "날짜별 JSON 출력")
  .action(async (options) => {
    // --history 경로 검증
    let historyPath: string | undefined;
    if (options.history) {
      historyPath = resolve(options.history);
      if (!existsSync(historyPath)) {
        console.error(`  ❌ history 파일을 찾을 수 없습니다: ${historyPath}`);
        process.exit(1);
      }
    }

    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      await requireSetup(storage);

      const result = await runAir(storage, { historyPath });

      if (options.json) {
        // 변경된 날짜의 gather_reports JSON 출력
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
        // 터미널 요약
        console.log("");
        console.log(`  📋 air 갈무리 완료`);
        console.log(`     날짜 범위: ${result.dates.length}일 (백필 ${result.backfillDays}일)`);
        console.log(`     총 세션: ${result.totalSessions}개`);
        console.log(`     변경 날짜: ${result.changedDates.length}일`);
        if (result.changedDates.length > 0) {
          console.log(`     변경: ${result.changedDates.join(", ")}`);
        }
        if (result.isFirstRun) {
          console.log(`     [첫 실행 — 90일 백필]`);
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
  .description("마무리 — AI 요약 연동 (JSON 출력/저장)")
  .option("--json", "요약 필요 세션 데이터 JSON 출력 (SKILL.md용)")
  .option("--save", "stdin JSON → daily_reports 저장")
  .option("--summarize", "Workers AI로 세션 요약 포함 (--json과 함께 사용)")
  .option("--type <type>", "보고 유형: daily | weekly | monthly", "daily")
  .option("--history <path>", "history.jsonl 경로")
  .action(async (options) => {
    if (options.save) {
      // stdin JSON 읽기
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      const input = Buffer.concat(chunks).toString("utf-8").trim();

      if (!input) {
        console.error("  ❌ 입력 데이터가 없습니다. stdin으로 JSON을 전달해 주세요.");
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
          throw new Error("date와 sessions 필드가 필요합니다");
        }
      } catch (err) {
        console.error(
          `  ❌ JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
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
        const typeLabel =
          options.type === "daily"
            ? "일일"
            : options.type === "weekly"
              ? "주간"
              : "월간";
        console.log(
          `  ✅ ${typeLabel}보고 저장 완료: ${data.date} (${data.sessions.length}세션)`,
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
        console.error(`  ❌ history 파일을 찾을 수 없습니다: ${historyPath}`);
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
        console.log(`  📋 circle 마무리 완료`);
        console.log(`     날짜 범위: ${result.airResult.dates.length}일`);
        console.log(`     총 세션: ${result.airResult.totalSessions}개`);
        console.log(`     변경 날짜: ${result.airResult.changedDates.length}일`);
        if (result.finalized.length > 0) {
          console.log(`     finalized: ${result.finalized.join(", ")}`);
        }
        if (result.needsSummary.length > 0) {
          console.log(`     요약 필요: ${result.needsSummary.join(", ")}`);
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
  .description("보고서 자동 발신 (요일/미발송 상태에 따라 유형 결정)")
  .option("--preview", "발송 안 하고 미리보기만")
  .option("--render-only", "HTML/제목/수신자 JSON 출력 (Gmail MCP용)")
  .option("--history", "최근 발송 내역 조회")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();

      if (options.history) {
        const logs = await storage.getEmailLogs(20);
        if (logs.length === 0) {
          console.log("  발송 내역이 없습니다.");
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
        console.log("  최근 발송 내역");
        console.log("  " + hLine("┌", "┬", "┐"));
        console.log(
          "  │" +
            ` ${padEndW("날짜", dateW)} │` +
            ` ${padEndW("유형", typeW)} │` +
            ` ${padEndW("수신자", recipW)} │` +
            ` ${padEndW("상태", statusW)} │`,
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
      });
      if (!options.renderOnly) {
        const parts = [`${result.sent}건 발송`, `${result.skipped}건 스킵`];
        if (result.errors > 0) parts.push(`${result.errors}건 오류`);
        console.log(`  ✅ out 완료 — ${parts.join(", ")}`);
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
  ["outd", "daily", "일일보고 강제 발신"],
  ["outw", "weekly", "주간보고 강제 발신"],
  ["outm", "monthly", "월간보고 강제 발신"],
] as const) {
  program
    .command(cmd)
    .description(desc)
    .option("--preview", "발송 안 하고 미리보기만")
    .action(async (options) => {
      const storage = new SqlJsAdapter();
      try {
        await storage.initialize();
        await requireSetup(storage);
        const { runOut } = await import("./core/out.js");
        const result = await runOut(storage, {
          force: type,
          preview: options.preview,
        });
        const parts = [`${result.sent}건 발송`, `${result.skipped}건 스킵`];
        if (result.errors > 0) parts.push(`${result.errors}건 오류`);
        console.log(`  ✅ ${cmd} 완료 — ${parts.join(", ")}`);
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
  .description("설정 관리")
  .option("--set-passphrase", "암호화 passphrase 설정")
  .option("--email <address>", "수신 이메일 주소 설정")
  .option("--smtp-host <host>", "SMTP 호스트 (기본: smtp.gmail.com)")
  .option("--smtp-port <port>", "SMTP 포트 (기본: 587)")
  .option("--smtp-user <user>", "SMTP 사용자 (발신 이메일)")
  .option("--smtp-pass [pass]", "SMTP 앱 비밀번호 설정")
  .option("--provider <provider>", "이메일 provider (gmail | resend | custom_smtp)")
  .option("--resend-key <key>", "Resend API 키 설정")
  .option("--vacation <dates...>", "휴가 등록 (YYYY-MM-DD)")
  .option("--vacation-list", "등록된 휴가 목록 조회")
  .option("--vacation-clear <date>", "휴가 삭제 (YYYY-MM-DD)")
  .option("--vacation-type <type>", "휴가 유형 (vacation | sick | holiday | half | other)", "vacation")
  .option("--d1-account <id>", "Cloudflare Account ID")
  .option("--d1-database <id>", "D1 Database ID")
  .option("--d1-token <token>", "Cloudflare API Token")
  .option("--machine-name <name>", "이 머신의 식별 이름")
  .option("--ai-provider <provider>", "AI 요약 provider (cloudflare | anthropic | claude-code | auto)")
  .option("--setup-d1", "D1 설정 위저드")
  .option("--setup", "설정 위저드 실행")
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
          "  Passphrase 설정은 아직 준비 중입니다. (coming soon)",
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
          password = await promptPassword("  SMTP 앱 비밀번호: ");
        }
        if (password) {
          await storage.setConfig("smtp_pass", password);
          console.log("  smtp_pass = ********");
          changed = true;
        } else {
          console.log("  비밀번호가 입력되지 않았습니다.");
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
          console.log(`  휴가 등록: ${date} (${vacationType})`);
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
          console.log("  등록된 휴가가 없습니다.");
        } else {
          console.log(`\n  📅 등록된 휴가 (${vacations.length}건)`);
          for (const v of vacations) {
            console.log(`    ${v.date}  ${v.type}  (${v.source})`);
          }
          console.log("");
        }
      }

      if (options.vacationClear) {
        hasAction = true;
        await storage.deleteVacation(options.vacationClear);
        console.log(`  휴가 삭제: ${options.vacationClear}`);
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
        console.log("  Cloudflare 계정 확인 중...");
        const { autoSetupD1 } = await import("./cloud/d1-auto-setup.js");
        try {
          const existingAccountId = await storage.getConfig("d1_account_id");
          const result = await autoSetupD1(options.d1Token, existingAccountId || undefined);
          await storage.setConfig("d1_api_token", options.d1Token);
          await storage.setConfig("d1_account_id", result.accountId);
          await storage.setConfig("d1_database_id", result.databaseId);
          console.log(`  ✅ 계정: ${result.accountName} (${result.accountId.slice(0, 8)}...)`);
          if (result.created) {
            console.log(`  ✅ 'sincenety' DB 생성 (${result.databaseId.slice(0, 8)}...)`);
          } else {
            console.log(`  ✅ 'sincenety' DB 발견 (${result.databaseId.slice(0, 8)}...)`);
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
          console.log("  ✅ D1 스키마 세팅 완료!");
          changed = true;
        } catch (err) {
          console.error(`  ❌ D1 설정 실패: ${err instanceof Error ? err.message : String(err)}`);
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
          console.log(`  ❌ 유효한 값: ${validProviders.join(", ")}`);
        } else {
          await storage.setConfig("ai_provider", options.aiProvider);
          console.log(`  ai_provider = ${options.aiProvider}`);
          changed = true;
        }
      }
      if (options.setupD1) {
        hasAction = true;
        console.log("  D1 설정: sincenety config --d1-token <API_TOKEN>");
        console.log("  토큰만으로 계정/DB/머신 자동 감지됩니다.");
        return;
      }

      if (changed) {
        console.log("  설정이 저장되었습니다.");
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

program
  .command("schedule")
  .description("자동 갈무리 스케줄 관리")
  .option("--install", "스케줄 설치 (기본 18:00)")
  .option("--uninstall", "스케줄 해제")
  .option("--status", "스케줄 상태 확인")
  .option("--time <time>", "실행 시간 (예: 19:00)", "18:00")
  .action(async (options) => {
    try {
      if (options.uninstall) {
        await uninstallSchedule();
      } else if (options.status) {
        const status = await getScheduleStatus();
        console.log(`  스케줄 상태: ${status}`);
      } else if (options.install) {
        await installSchedule({ time: options.time });
      } else {
        console.log("  사용법:");
        console.log("    sincenety schedule --install");
        console.log("    sincenety schedule --install --time 19:00");
        console.log("    sincenety schedule --uninstall");
        console.log("    sincenety schedule --status");
      }
    } catch (err) {
      console.error(
        `  ❌ ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  });

// ─── sync 명령 ─────────────────────────────────────────

program
  .command("sync")
  .description("D1 중앙 DB 동기화")
  .option("--push", "로컬 → D1 push")
  .option("--pull-config", "D1 → 로컬 공유 설정 가져오기")
  .option("--status", "동기화 상태 확인")
  .option("--init", "D1 스키마 초기 생성")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      await requireSetup(storage);

      const { loadD1Client, pushToD1, pullConfigFromD1, getSyncStatus, getAutoMachineId } = await import("./cloud/sync.js");
      const { ensureD1Schema } = await import("./cloud/d1-schema.js");

      const client = await loadD1Client(storage);
      if (!client) {
        console.log("  D1 설정이 필요합니다:");
        console.log("    sincenety config --d1-token <API_TOKEN>");
        console.log("  (토큰만으로 계정/DB 자동 감지)");
        return;
      }

      const machineId = await getAutoMachineId(storage);

      if (options.init) {
        console.log("  D1 스키마 생성 중...");
        await ensureD1Schema(client);
        console.log("  ✅ D1 스키마 생성 완료");
        return;
      }

      if (options.status) {
        const status = await getSyncStatus(storage, client, machineId);
        console.log("\n  D1 동기화 상태");
        console.log("  ┌────────────────┬──────────────────────┐");
        console.log(`  │ 설정           │ ${status.configured ? "✅ 완료" : "❌ 미설정"}${"".padEnd(14)} │`);
        console.log(`  │ D1 연결        │ ${status.d1Reachable ? "✅ 정상" : "❌ 불가"}${"".padEnd(14)} │`);
        console.log(`  │ 마지막 sync    │ ${status.lastSync ? new Date(status.lastSync).toLocaleString("ko-KR") : "(없음)"}${"".padEnd(Math.max(0, 20 - (status.lastSync ? new Date(status.lastSync).toLocaleString("ko-KR").length : 4)))} │`);
        console.log(`  │ 미동기화       │ ~${status.pendingRows}건${"".padEnd(17)} │`);
        console.log(`  │ machine_id     │ ${machineId.padEnd(20)} │`);
        console.log("  └────────────────┴──────────────────────┘");

        // Show registered machines
        try {
          const machinesRes = await client.query<{machine_id: string; platform: string; label: string; last_sync_at: number}>(
            "SELECT machine_id, platform, label, last_sync_at FROM machines ORDER BY last_sync_at DESC"
          );
          if (machinesRes.results.length > 0) {
            console.log("\n  등록된 머신:");
            for (const m of machinesRes.results) {
              const lastSync = m.last_sync_at ? new Date(m.last_sync_at).toLocaleString("ko-KR") : "(없음)";
              const label = m.label ? ` (${m.label})` : "";
              console.log(`    ${m.machine_id}${label} — ${m.platform} — ${lastSync}`);
            }
          }
        } catch { /* ignore if machines table not yet created */ }
        console.log("");
        return;
      }

      if (options.pullConfig) {
        console.log("  D1에서 공유 설정 가져오는 중...");
        const changed = await pullConfigFromD1(storage, client);
        if (changed.length > 0) {
          console.log(`  ✅ ${changed.length}개 설정 가져옴: ${changed.join(", ")}`);
        } else {
          console.log("  변경된 설정이 없습니다.");
        }
        return;
      }

      // Default: push
      console.log(`  D1 push 중... (machine: ${machineId})`);
      await ensureD1Schema(client);
      const result = await pushToD1(storage, client, machineId);
      const total = result.pushed.sessions + result.pushed.gatherReports + result.pushed.dailyReports + result.pushed.emailLogs + result.pushed.vacations;
      console.log(`  ✅ D1 sync 완료 — ${total}건 push`);
      if (result.pushed.config > 0) console.log(`     공유 설정 ${result.pushed.config}건 동기화`);
      if (result.errors.length > 0) {
        console.log(`  ⚠️  ${result.errors.length}건 오류: ${result.errors.slice(0, 3).join(", ")}`);
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

program.parse();
