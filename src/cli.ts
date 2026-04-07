#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { gather } from "./core/gatherer.js";
import { SqlJsAdapter } from "./storage/sqljs-adapter.js";
import {
  formatGatherReport,
  formatLogReport,
} from "./report/terminal.js";
import { sendGatherEmail, isEmailConfigured } from "./email/sender.js";
import {
  installSchedule,
  uninstallSchedule,
  getScheduleStatus,
} from "./scheduler/install.js";

const program = new Command();

program
  .name("sincenety")
  .description("Claude Code 작업 갈무리 도구")
  .version("0.1.0");

// 기본 명령: 갈무리
program
  .argument("[dummy]", "", "") // commander requires this for default action
  .option("--since <time>", "갈무리 시작 시점 (예: '09:00', '2026-04-07 09:00')")
  .option("--history <path>", "history.jsonl 경로 (기본: ~/.claude/history.jsonl)")
  .option("--detail", "세션 JSONL 상세 모드 (토큰/시간 추출)", true)
  .option("--no-detail", "history.jsonl만 사용 (빠른 모드)")
  .option("--auto", "자동 갈무리 + 이메일 발송 (스케줄러용)")
  .action(async (_, options) => {
    // "log" 서브커맨드가 아닌 경우에만 갈무리 실행
    if (program.args[0] === "log") return;

    let sinceTimestamp: number | undefined;
    if (options.since) {
      sinceTimestamp = parseSinceOption(options.since);
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
      const result = await gather(storage, {
        sinceTimestamp,
        historyPath,
        useSessionJsonl: options.detail !== false,
      });
      console.log(formatGatherReport(result));

      // --auto: 갈무리 후 이메일 발송 (설정된 경우)
      if (options.auto) {
        const configured = await isEmailConfigured(storage);
        if (configured) {
          try {
            await sendGatherEmail(storage);
          } catch (emailErr) {
            console.error(
              `  이메일 발송 실패: ${emailErr instanceof Error ? emailErr.message : String(emailErr)}`
            );
          }
        }
      }
    } catch (err) {
      console.error(
        `  ❌ ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// log 서브커맨드: 저장된 기록 조회
program
  .command("log")
  .description("저장된 작업 기록 조회")
  .option("--date <date>", "조회 날짜 (예: today, 2026-04-07)", "today")
  .option("--week", "최근 7일 조회")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();

      if (options.week) {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        weekAgo.setHours(0, 0, 0, 0);
        const records = await storage.getSessionsByRange(
          weekAgo.getTime(),
          now.getTime()
        );
        console.log(formatLogReport(records, "최근 7일"));
      } else {
        const dateStr =
          options.date === "today"
            ? new Date().toISOString().slice(0, 10)
            : options.date;
        // 날짜 형식 검증
        if (isNaN(new Date(dateStr).getTime())) {
          console.error(`  ❌ 유효하지 않은 날짜 형식입니다: ${options.date}`);
          process.exit(1);
        }
        const records = await storage.getSessionsByDate(dateStr);
        console.log(formatLogReport(records, dateStr));
      }
    } catch (err) {
      console.error(
        `  ❌ ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// config 서브커맨드: 설정 관리
program
  .command("config")
  .description("설정 관리")
  // MariaDB/외부 DB 연결은 향후 개발 예정 — 현재 비활성화
  .option("--set-passphrase", "암호화 passphrase 설정")
  .option("--email <address>", "수신 이메일 주소 설정")
  .option("--smtp-host <host>", "SMTP 호스트 (기본: smtp.gmail.com)")
  .option("--smtp-port <port>", "SMTP 포트 (기본: 587)")
  .option("--smtp-user <user>", "SMTP 사용자 (발신 이메일)")
  .option("--smtp-pass", "SMTP 앱 비밀번호 설정 (프롬프트 입력)")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();
      let changed = false;

      if (options.setPassphrase) {
        console.log(
          "  Passphrase 설정은 아직 준비 중입니다. (coming soon)"
        );
      }

      if (options.email) {
        await storage.setConfig("email", options.email);
        console.log(`  email = ${options.email}`);
        changed = true;
      }

      if (options.smtpHost) {
        await storage.setConfig("smtp_host", options.smtpHost);
        console.log(`  smtp_host = ${options.smtpHost}`);
        changed = true;
      }

      if (options.smtpPort) {
        await storage.setConfig("smtp_port", options.smtpPort);
        console.log(`  smtp_port = ${options.smtpPort}`);
        changed = true;
      }

      if (options.smtpUser) {
        await storage.setConfig("smtp_user", options.smtpUser);
        console.log(`  smtp_user = ${options.smtpUser}`);
        changed = true;
      }

      if (options.smtpPass) {
        // 보안을 위해 프롬프트로 입력받음
        const password = await promptPassword("  SMTP 앱 비밀번호: ");
        if (password) {
          await storage.setConfig("smtp_pass", password);
          console.log("  smtp_pass = ********");
          changed = true;
        } else {
          console.log("  비밀번호가 입력되지 않았습니다.");
        }
      }

      if (changed) {
        console.log("  설정이 저장되었습니다.");
      }
    } finally {
      await storage.close();
    }
  });

// email 서브커맨드: 갈무리 리포트 이메일 발송
program
  .command("email")
  .description("갈무리 리포트 이메일 발송")
  .option("--date <date>", "특정 날짜 리포트 발송 (예: 2026-04-06)")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();

      if (options.date) {
        // 날짜로 리포트 조회
        const reports = await storage.getGatherReportsByDate(options.date);
        if (reports.length === 0) {
          console.log(`  ${options.date}에 해당하는 갈무리 리포트가 없습니다.`);
          return;
        }
        // 가장 최근 리포트 발송 (해당 날짜)
        // sendGatherEmail은 latest만 지원하므로 ID로 매칭
        const target = reports[0]; // 가장 최근 (DESC)
        await sendGatherEmail(storage, target.id);
      } else {
        await sendGatherEmail(storage);
      }
    } catch (err) {
      console.error(
        `  ❌ ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// schedule 서브커맨드: 자동 갈무리 스케줄 관리
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
        `  ❌ ${err instanceof Error ? err.message : String(err)}`
      );
      process.exit(1);
    }
  });

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // 비밀번호 입력 시 에코 숨기기
    if (process.stdin.isTTY) {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      let password = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString("utf8");
        if (c === "\n" || c === "\r") {
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(password);
        } else if (c === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener("data", onData);
          rl.close();
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
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

function parseSinceOption(value: string): number {
  if (!value || !value.trim()) {
    console.error("  ❌ --since 값이 비어 있습니다.");
    process.exit(1);
  }

  // "09:00" 형태 — 오늘 해당 시간으로 해석
  const timeMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const now = new Date();
    now.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
    return now.getTime();
  }

  // 일반 날짜/시간 문자열
  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) {
    return parsed.getTime();
  }

  console.error(`  ❌ 시간 형식을 인식할 수 없습니다: ${value}`);
  process.exit(1);
}

program.parse();
