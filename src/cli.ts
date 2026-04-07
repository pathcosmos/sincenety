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
  .option("--json", "구조화 JSON 출력 (스킬 연동용, 대화 턴 포함)")
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

      // --json: 대화 턴 포함 구조화 JSON 출력 (Claude Code 스킬 연동용)
      if (options.json) {
        const jsonOutput = {
          fromTimestamp: result.fromTimestamp,
          toTimestamp: result.toTimestamp,
          isFirstRun: result.isFirstRun,
          sessions: result.sessions.map((s) => ({
            sessionId: s.sessionId,
            projectName: s.projectName,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            durationMinutes: s.durationMinutes ?? 0,
            messageCount: s.messageCount,
            userMessageCount: s.userMessageCount ?? 0,
            assistantMessageCount: s.assistantMessageCount ?? 0,
            toolCallCount: s.toolCallCount ?? 0,
            inputTokens: s.inputTokens ?? 0,
            outputTokens: s.outputTokens ?? 0,
            totalTokens: (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
            model: s.model ?? "",
            title: s.title ?? s.summary,
            description: s.description ?? "",
            // 대화 턴: 사용자 입력 + 어시스턴트 응답 쌍
            conversationTurns: (s.conversationTurns ?? []).map((t) => ({
              timestamp: t.timestamp,
              userInput: t.userInput,
              assistantOutput: t.assistantOutput,
            })),
          })),
        };
        console.log(JSON.stringify(jsonOutput));
        return;
      }

      console.log(formatGatherReport(result));

      // 이메일 설정 상태 확인
      const emailConfigured = await isEmailConfigured(storage);

      if (emailConfigured) {
        // --auto 또는 세션이 있을 때 자동 발송
        if (options.auto && result.sessions.length > 0) {
          try {
            await sendGatherEmail(storage);
          } catch (emailErr) {
            console.error(
              `  이메일 발송 실패: ${emailErr instanceof Error ? emailErr.message : String(emailErr)}`
            );
          }
        }
      } else if (result.isFirstRun) {
        // 첫 실행 시 이메일 설정 안내
        console.log("  ────────────────────────────────────────────────────────");
        console.log("  📧 이메일 발송을 설정하면 갈무리 리포트를 메일로 받을 수 있습니다.");
        console.log("");
        console.log("  1. Google 앱 비밀번호 생성 (2단계 인증 필요):");
        console.log("     https://myaccount.google.com/apppasswords");
        console.log("");
        console.log("  2. sincenety에 이메일 설정:");
        console.log("     sincenety config --email    you@gmail.com");
        console.log("     sincenety config --smtp-user you@gmail.com");
        console.log("     sincenety config --smtp-pass");
        console.log("");
        console.log("  설정 후 'sincenety email'로 발송하거나,");
        console.log("  'sincenety --auto'로 갈무리+발송을 한 번에 실행할 수 있습니다.");
        console.log("  (이메일 없이도 터미널 출력은 항상 동작합니다)");
        console.log("");
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
  // .option("--api-key", "Anthropic API 키 설정 (프롬프트 입력, 세션 요약용)") // 비활성화: 내부 실행 전용
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

// save-daily 서브커맨드: AI 요약 일일보고 저장
program
  .command("save-daily")
  .description("AI 요약 일일보고를 DB에 저장 (stdin으로 JSON 입력)")
  .option("--type <type>", "보고 유형: daily | weekly | monthly", "daily")
  .action(async (options) => {
    // stdin 읽기
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
        startedAt?: number;
        endedAt?: number;
        durationMinutes?: number;
        messageCount?: number;
        totalTokens?: number;
      }>;
    };

    try {
      data = JSON.parse(input);
      if (!data.date || !Array.isArray(data.sessions)) {
        throw new Error("date와 sessions 필드가 필요합니다");
      }
    } catch (err) {
      console.error(`  ❌ JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();

      // 세션 통계 보완: DB에서 해당 날짜 세션 데이터 가져오기
      const dbSessions = await storage.getSessionsByDate(data.date);
      let totalMessages = 0;
      let totalTokens = 0;

      // 각 요약에 DB 통계 병합
      for (const summary of data.sessions) {
        const dbSession = dbSessions.find(
          (s) => s.id === summary.sessionId
        );
        if (dbSession) {
          summary.startedAt ??= dbSession.startedAt;
          summary.endedAt ??= dbSession.endedAt;
          summary.durationMinutes ??= dbSession.durationMinutes;
          summary.messageCount ??= dbSession.messageCount;
          summary.totalTokens ??= dbSession.totalTokens;
          summary.projectName ??= dbSession.projectName;
        }
        totalMessages += summary.messageCount ?? 0;
        totalTokens += summary.totalTokens ?? 0;
      }

      // 기간 계산
      const dateObj = new Date(data.date);
      const periodFrom = dateObj.getTime();
      const periodTo = periodFrom + 86400000; // +1일

      await storage.saveDailyReport({
        reportDate: data.date,
        reportType: options.type as "daily" | "weekly" | "monthly",
        periodFrom,
        periodTo,
        sessionCount: data.sessions.length,
        totalMessages,
        totalTokens,
        summaryJson: JSON.stringify(data.sessions),
        overview: data.overview ?? null,
        reportMarkdown: null,
        createdAt: Date.now(),
        emailedAt: null,
        emailTo: null,
      });

      console.log(`  ✅ ${options.type === "daily" ? "일일" : options.type === "weekly" ? "주간" : "월간"}보고 저장 완료: ${data.date} (${data.sessions.length}세션)`);
    } catch (err) {
      console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// report 서브커맨드: 주간/월간 보고 조회
program
  .command("report")
  .description("일일보고 조회/집계")
  .option("--date <date>", "특정 날짜 일일보고 조회")
  .option("--week", "이번 주 일일보고 집계")
  .option("--month", "이번 달 일일보고 집계")
  .option("--from <date>", "시작 날짜 (YYYY-MM-DD)")
  .option("--to <date>", "종료 날짜 (YYYY-MM-DD)")
  .option("--json", "JSON 출력 (스킬 연동용)")
  .action(async (options) => {
    const storage = new SqlJsAdapter();
    try {
      await storage.initialize();

      let from: string;
      let to: string;
      let label: string;

      if (options.date) {
        // 단일 날짜
        const report = await storage.getDailyReport(options.date);
        if (!report) {
          console.log(`  ${options.date}에 일일보고가 없습니다.`);
          return;
        }
        if (options.json) {
          console.log(JSON.stringify(report));
        } else {
          console.log(`\n  📋 ${options.date} 일일보고 (${report.sessionCount}세션)`);
          if (report.overview) console.log(`  ${report.overview}`);
          const sessions = JSON.parse(report.summaryJson || "[]");
          for (const s of sessions) {
            console.log(`\n  [${s.projectName}] ${s.topic ?? ""}`);
            if (s.outcome) console.log(`    결과: ${s.outcome}`);
            if (s.flow) console.log(`    흐름: ${s.flow}`);
          }
          console.log("");
        }
        return;
      }

      if (options.week) {
        const now = new Date();
        const day = now.getDay();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
        from = monday.toISOString().slice(0, 10);
        to = now.toISOString().slice(0, 10);
        label = `이번 주 (${from} ~ ${to})`;
      } else if (options.month) {
        const now = new Date();
        from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        to = now.toISOString().slice(0, 10);
        label = `이번 달 (${from} ~ ${to})`;
      } else if (options.from && options.to) {
        from = options.from;
        to = options.to;
        label = `${from} ~ ${to}`;
      } else {
        // 기본: 오늘
        from = new Date().toISOString().slice(0, 10);
        to = from;
        label = `오늘 (${from})`;
      }

      const reports = await storage.getDailyReportsByRange(from, to);

      if (reports.length === 0) {
        console.log(`  ${label}에 일일보고가 없습니다.`);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(reports));
        return;
      }

      // 터미널 출력
      const totalSessions = reports.reduce((s, r) => s + r.sessionCount, 0);
      const totalTokens = reports.reduce((s, r) => s + r.totalTokens, 0);
      console.log(`\n  📋 ${label} — ${reports.length}일, ${totalSessions}세션`);
      console.log("  " + "─".repeat(56));

      for (const r of reports) {
        console.log(`\n  📅 ${r.reportDate} (${r.sessionCount}세션)`);
        if (r.overview) console.log(`    ${r.overview}`);
        const sessions = JSON.parse(r.summaryJson || "[]");
        for (const s of sessions) {
          console.log(`    • [${s.projectName}] ${s.topic ?? ""}`);
        }
      }
      console.log("");
    } catch (err) {
      console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      await storage.close();
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
