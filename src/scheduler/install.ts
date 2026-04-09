/**
 * 플랫폼별 스케줄러 설치/해제 — macOS LaunchAgent 또는 crontab
 */

import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const PLIST_LABEL = "com.sincenety.daily";
const CRON_MARKER = "# sincenety-daily";

function getPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
}

function getLogDir(): string {
  return join(homedir(), ".sincenety", "logs");
}

function getDefaultCliPath(): string {
  // dist/scheduler/install.js -> dist/cli.js
  const thisFile = fileURLToPath(import.meta.url);
  // Go up from scheduler dir to dist, then cli.js
  const parts = thisFile.split("/");
  const distIdx = parts.lastIndexOf("dist");
  if (distIdx >= 0) {
    return [...parts.slice(0, distIdx + 1), "cli.js"].join("/");
  }
  // fallback: relative from src
  const srcIdx = parts.lastIndexOf("src");
  if (srcIdx >= 0) {
    return [...parts.slice(0, srcIdx), "dist", "cli.js"].join("/");
  }
  return join(process.cwd(), "dist", "cli.js");
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid time format: ${time} (e.g. 18:00)`);
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time: ${time}`);
  }
  return { hour, minute };
}

function buildPlist(options: {
  hour: number;
  minute: number;
  nodePath: string;
  cliPath: string;
}): string {
  const logDir = getLogDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${options.nodePath}</string>
    <string>${options.cliPath}</string>
    <string>--auto</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${options.hour}</integer>
    <key>Minute</key>
    <integer>${options.minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/daily-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/daily-stderr.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>`;
}

/**
 * 스케줄 설치
 */
export async function installSchedule(options?: {
  time?: string;
  nodePath?: string;
  cliPath?: string;
}): Promise<void> {
  const { hour, minute } = parseTime(options?.time ?? "18:00");
  const nodePath = options?.nodePath ?? process.execPath;
  const cliPath = options?.cliPath ?? getDefaultCliPath();

  if (process.platform === "darwin") {
    await installLaunchAgent({ hour, minute, nodePath, cliPath });
  } else {
    await installCrontab({ hour, minute, nodePath, cliPath });
  }
}

async function installLaunchAgent(opts: {
  hour: number;
  minute: number;
  nodePath: string;
  cliPath: string;
}): Promise<void> {
  const plistPath = getPlistPath();
  const logDir = getLogDir();

  // 로그 디렉토리 생성
  await mkdir(logDir, { recursive: true });

  // 기존 에이전트 언로드
  if (existsSync(plistPath)) {
    try {
      await execFileAsync("launchctl", ["unload", plistPath]);
    } catch {
      // 이미 언로드된 상태
    }
  }

  // plist 작성
  const plist = buildPlist(opts);
  await writeFile(plistPath, plist, "utf-8");

  // 로드
  await execFileAsync("launchctl", ["load", plistPath]);

  const timeStr = `${String(opts.hour).padStart(2, "0")}:${String(opts.minute).padStart(2, "0")}`;
  console.log(`  Schedule installed (macOS LaunchAgent)`);
  console.log(`  Daily auto-gather + email at ${timeStr}`);
  console.log(`  plist: ${plistPath}`);
  console.log(`  logs: ${logDir}/`);
}

async function installCrontab(opts: {
  hour: number;
  minute: number;
  nodePath: string;
  cliPath: string;
}): Promise<void> {
  const logDir = getLogDir();
  await mkdir(logDir, { recursive: true });

  // 기존 sincenety 항목 제거 후 추가
  let existingCron = "";
  try {
    const { stdout } = await execFileAsync("crontab", ["-l"]);
    existingCron = stdout;
  } catch {
    // crontab이 비어있을 수 있음
  }

  const lines = existingCron.split("\n").filter(
    (line) => !line.includes(CRON_MARKER) && line.trim() !== "",
  );

  const cronLine = `${opts.minute} ${opts.hour} * * * ${opts.nodePath} ${opts.cliPath} --auto >> ${logDir}/daily-stdout.log 2>> ${logDir}/daily-stderr.log ${CRON_MARKER}`;
  lines.push(cronLine);
  lines.push(""); // trailing newline

  const newCron = lines.join("\n");
  // pipe to crontab via stdin
  const proc = await execFileAsync("crontab", ["-"], {
    // @ts-expect-error input is valid
    input: newCron,
  });

  const timeStr = `${String(opts.hour).padStart(2, "0")}:${String(opts.minute).padStart(2, "0")}`;
  console.log(`  Schedule installed (crontab)`);
  console.log(`  Daily auto-gather + email at ${timeStr}`);
  console.log(`  logs: ${logDir}/`);
}

/**
 * 스케줄 해제
 */
export async function uninstallSchedule(): Promise<void> {
  if (process.platform === "darwin") {
    const plistPath = getPlistPath();
    if (existsSync(plistPath)) {
      try {
        await execFileAsync("launchctl", ["unload", plistPath]);
      } catch {
        // 이미 언로드 상태
      }
      await unlink(plistPath);
      console.log("  Schedule uninstalled (LaunchAgent removed)");
    } else {
      console.log("  No schedule installed.");
    }
  } else {
    let existingCron = "";
    try {
      const { stdout } = await execFileAsync("crontab", ["-l"]);
      existingCron = stdout;
    } catch {
      console.log("  No schedule installed.");
      return;
    }

    const lines = existingCron.split("\n").filter(
      (line) => !line.includes(CRON_MARKER),
    );

    if (lines.join("\n").trim() === existingCron.trim()) {
      console.log("  No schedule installed.");
      return;
    }

    const newCron = lines.filter((l) => l.trim() !== "").join("\n") + "\n";
    await execFileAsync("crontab", ["-"], {
      // @ts-expect-error input is valid
      input: newCron,
    });
    console.log("  Schedule uninstalled (crontab entry removed)");
  }
}

/**
 * 스케줄 상태 확인
 */
export async function getScheduleStatus(): Promise<string> {
  if (process.platform === "darwin") {
    const plistPath = getPlistPath();
    if (!existsSync(plistPath)) {
      return "not installed";
    }
    try {
      const content = await readFile(plistPath, "utf-8");
      const hourMatch = content.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
      const minMatch = content.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
      if (hourMatch && minMatch) {
        const h = hourMatch[1].padStart(2, "0");
        const m = minMatch[1].padStart(2, "0");
        return `installed — daily at ${h}:${m} (macOS LaunchAgent)`;
      }
      return "installed (macOS LaunchAgent)";
    } catch {
      return "failed to read plist";
    }
  } else {
    try {
      const { stdout } = await execFileAsync("crontab", ["-l"]);
      const line = stdout.split("\n").find((l) => l.includes(CRON_MARKER));
      if (line) {
        const match = line.match(/^(\d+)\s+(\d+)/);
        if (match) {
          const h = match[2].padStart(2, "0");
          const m = match[1].padStart(2, "0");
          return `installed — daily at ${h}:${m} (crontab)`;
        }
        return "installed (crontab)";
      }
      return "not installed";
    } catch {
      return "not installed";
    }
  }
}
