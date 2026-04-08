# Plan 2: Email Provider + `out` Commands

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `out`/`outd`/`outw`/`outm` commands with smart dispatch (weekday/catchup logic), email provider abstraction (SMTP/Resend), email_logs recording, and `--preview`/`--render-only`/`--history` options.

**Architecture:** `out` determines which reports to send based on weekday + unsent report detection. A provider abstraction layer routes to Resend API (fetch) or SMTP (nodemailer). Every send is logged to `email_logs`. The existing `sender.ts` HTML-building logic is extracted into a shared renderer; actual send is delegated to provider.

**Tech Stack:** TypeScript ESM, commander, nodemailer (SMTP), native fetch (Resend), vitest

**Spec:** `docs/superpowers/specs/2026-04-08-cli-restructure-design.md` — Phase 3 section

**Depends on:** Plan 1 (complete) — `air`, `circle`, DB v4 with `email_logs` table

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/email/resend.ts` | Resend API sender (fetch, zero deps) |
| Create | `src/email/provider.ts` | Provider abstraction: detect route, dispatch to SMTP or Resend |
| Create | `src/email/renderer.ts` | Build EmailData from daily_reports + gather_reports, render HTML/subject/text |
| Modify | `src/email/sender.ts` | Refactor: extract HTML building to renderer, keep SMTP send only |
| Create | `src/core/out.ts` | `out` orchestrator: smart dispatch, catchup, chain to circle |
| Modify | `src/cli.ts` | Add `out`/`outd`/`outw`/`outm` commands |
| Modify | `src/skill/SKILL.md` | Update step 5 to use `sincenety out` |
| Create | `tests/out.test.ts` | out smart dispatch logic tests |
| Create | `tests/provider.test.ts` | Provider routing tests |

---

### Task 1: Email Renderer — Extract HTML Building from sender.ts

**Files:**
- Create: `src/email/renderer.ts`
- Modify: `src/email/sender.ts`

- [ ] **Step 1: Create renderer.ts**

Extract the HTML/subject/text building logic from `sendGatherEmail` into a pure function:

```typescript
// src/email/renderer.ts
import type { StorageAdapter, DailyReport } from "../storage/adapter.js";
import { renderEmailHtml, type EmailData, type SessionData } from "./template.js";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  recipient: string;
  reportType: "daily" | "weekly" | "monthly";
  reportDate: string;
  periodFrom: string;
  periodTo: string;
}

/**
 * Render a daily report into email components (subject, html, text).
 * Merges gather_reports (raw sessions) with daily_reports (AI summaries).
 */
export async function renderDailyEmail(
  storage: StorageAdapter,
  date: string,
  reportType: "daily" | "weekly" | "monthly" = "daily",
): Promise<RenderedEmail | null> {
  const recipient = await storage.getConfig("email");
  if (!recipient) return null;

  // Get the daily_report (AI summary)
  const dailyReport = await storage.getDailyReport(date, reportType);
  
  // Get gather_report for session data
  const gatherReport = await storage.getGatherReportByDate(date);
  
  if (!dailyReport && !gatherReport) return null;

  // Build AI summary map from daily_report
  let aiSummaryMap: Map<string, any> | null = null;
  let overview: string | null = null;
  
  if (dailyReport) {
    try {
      const summaryJson = JSON.parse(dailyReport.summaryJson || "[]");
      aiSummaryMap = new Map();
      for (const s of summaryJson) {
        if (s.sessionId) aiSummaryMap.set(s.sessionId, s);
      }
      overview = dailyReport.overview;
    } catch { /* ignore */ }
  }

  // Build session data from gather_report
  let sessions: SessionData[] = [];
  if (gatherReport) {
    try {
      const sessionsJson = JSON.parse(gatherReport.reportJson || "[]");
      sessions = sessionsJson.map((s: any): SessionData => {
        const ai = aiSummaryMap?.get(s.sessionId);
        const wu = ai
          ? { outcome: ai.outcome, significance: ai.significance, flow: ai.flow, nextSteps: ai.nextSteps || undefined }
          : s.wrapUp
            ? { outcome: s.wrapUp.outcome ?? "", significance: s.wrapUp.significance ?? "", flow: s.wrapUp.flow, nextSteps: s.wrapUp.nextSteps }
            : undefined;
        return {
          sessionId: s.sessionId ?? "",
          projectName: s.projectName ?? "",
          startedAt: s.startedAt ?? 0,
          endedAt: s.endedAt ?? 0,
          durationMinutes: s.durationMinutes ?? 0,
          messageCount: s.messageCount ?? 0,
          userMessageCount: s.userMessageCount ?? 0,
          assistantMessageCount: s.assistantMessageCount ?? 0,
          inputTokens: s.inputTokens ?? 0,
          outputTokens: s.outputTokens ?? 0,
          totalTokens: s.totalTokens ?? 0,
          title: ai?.topic || s.title || "",
          summary: ai?.topic || s.title || "",
          description: ai?.outcome || s.description || "",
          model: s.model || "",
          category: s.category || "",
          actions: (s.actions || []).map((a: any) => ({
            time: a.time ?? "", input: a.input ?? "", result: a.result ?? "", significance: a.significance ?? "",
          })),
          wrapUp: wu,
        };
      });
    } catch { /* ignore */ }
  }

  // For weekly/monthly without gather data, build from dailyReport summaryJson
  if (sessions.length === 0 && dailyReport) {
    try {
      const summaryJson = JSON.parse(dailyReport.summaryJson || "[]");
      sessions = summaryJson.map((s: any): SessionData => ({
        sessionId: s.sessionId ?? "",
        projectName: s.projectName ?? "",
        startedAt: 0, endedAt: 0, durationMinutes: 0,
        messageCount: 0, userMessageCount: 0, assistantMessageCount: 0,
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        title: s.topic || "", summary: s.topic || "",
        description: s.outcome || "", model: "", category: "",
        actions: [],
        wrapUp: { outcome: s.outcome || "", significance: s.significance || "", flow: s.flow, nextSteps: s.nextSteps },
      }));
    } catch { /* ignore */ }
  }

  const totalTokens = sessions.reduce((s, g) => s + g.totalTokens, 0);
  const totalMsg = sessions.reduce((s, g) => s + g.messageCount, 0);
  const totalTokensK = Math.round(totalTokens / 1000);
  const typeLabel = reportType === "daily" ? "일일보고" : reportType === "weekly" ? "주간보고" : "월간보고";
  const subject = `[sincenety] ${date} ${typeLabel} — ${sessions.length}세션, ${totalMsg}msg, ${totalTokensK}Ktok`;

  const fromTs = gatherReport?.fromTimestamp ?? (dailyReport?.periodFrom ?? Date.now());
  const toTs = gatherReport?.toTimestamp ?? (dailyReport?.periodTo ?? Date.now());

  const emailData: EmailData = {
    sessions,
    fromTimestamp: fromTs,
    toTimestamp: toTs,
    gatheredAt: Date.now(),
    dailyOverview: overview ?? undefined,
  };

  let html: string;
  try {
    html = renderEmailHtml(emailData);
  } catch {
    html = `<pre>${overview ?? "No data"}</pre>`;
  }

  let text = overview ? `[${typeLabel}] ${date}\n\n${overview}` : `[${typeLabel}] ${date}`;
  if (gatherReport?.reportMarkdown) {
    text += "\n\n" + gatherReport.reportMarkdown;
  }

  return {
    subject,
    html,
    text,
    recipient,
    reportType,
    reportDate: date,
    periodFrom: date,
    periodTo: date,
  };
}
```

- [ ] **Step 2: Refactor sender.ts to use renderer**

Keep `sendGatherEmail` for backward compat but simplify: it should call `renderDailyEmail` then send via SMTP. Remove the inline HTML building code.

Also add a new export `sendEmailViaSMTP(config, rendered)` that takes a `RenderedEmail` and sends it.

```typescript
// Add to sender.ts
export async function sendEmailViaSMTP(
  storage: StorageAdapter,
  rendered: RenderedEmail,
): Promise<void> {
  const config = await getEmailConfig(storage);
  if (!config.smtpUser || !config.smtpPass) {
    throw new Error("SMTP 설정이 필요합니다. sincenety config --setup");
  }

  const transporter = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });

  await transporter.sendMail({
    from: config.smtpUser,
    to: rendered.recipient,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/email/renderer.ts src/email/sender.ts
git commit -m "refactor: extract email renderer from sender, add sendEmailViaSMTP"
```

---

### Task 2: Resend Provider + Provider Abstraction

**Files:**
- Create: `src/email/resend.ts`
- Create: `src/email/provider.ts`
- Create: `tests/provider.test.ts`

- [ ] **Step 1: Write provider test**

```typescript
// tests/provider.test.ts
import { describe, it, expect } from "vitest";

describe("email provider", () => {
  it("should detect provider from config", async () => {
    const { detectProvider } = await import("../src/email/provider.js");
    
    // No config = none
    expect(detectProvider({ provider: null, resendKey: null, smtpPass: null })).toBe("none");
    
    // Resend key = resend
    expect(detectProvider({ provider: null, resendKey: "re_xxx", smtpPass: null })).toBe("resend");
    
    // SMTP pass = gmail_smtp
    expect(detectProvider({ provider: null, resendKey: null, smtpPass: "xxxx" })).toBe("gmail_smtp");
    
    // Explicit provider override
    expect(detectProvider({ provider: "resend", resendKey: "re_xxx", smtpPass: "xxxx" })).toBe("resend");
    expect(detectProvider({ provider: "smtp", resendKey: null, smtpPass: "xxxx" })).toBe("custom_smtp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/provider.test.ts`
Expected: FAIL

- [ ] **Step 3: Create resend.ts**

```typescript
// src/email/resend.ts
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
```

- [ ] **Step 4: Create provider.ts**

```typescript
// src/email/provider.ts
import type { StorageAdapter, EmailLog } from "../storage/adapter.js";
import type { RenderedEmail } from "./renderer.js";

export type ProviderType = "gmail_mcp" | "resend" | "gmail_smtp" | "custom_smtp" | "none";

interface ProviderConfig {
  provider: string | null;
  resendKey: string | null;
  smtpPass: string | null;
}

/** Detect which email provider to use based on config */
export function detectProvider(config: ProviderConfig): ProviderType {
  if (config.provider === "resend" && config.resendKey) return "resend";
  if (config.provider === "smtp" && config.smtpPass) return "custom_smtp";
  if (config.provider === "gmail" && config.smtpPass) return "gmail_smtp";
  
  // Auto-detect
  if (config.resendKey) return "resend";
  if (config.smtpPass) return "gmail_smtp";
  return "none";
}

/** Load provider config from storage */
export async function loadProviderConfig(storage: StorageAdapter): Promise<ProviderConfig> {
  const [provider, resendKey, smtpPass] = await Promise.all([
    storage.getConfig("provider"),
    storage.getConfig("resend_key"),
    storage.getConfig("smtp_pass"),
  ]);
  return { provider, resendKey, smtpPass };
}

/** Send email via detected provider + log to email_logs */
export async function sendEmail(
  storage: StorageAdapter,
  rendered: RenderedEmail,
): Promise<void> {
  const config = await loadProviderConfig(storage);
  const providerType = detectProvider(config);

  if (providerType === "none") {
    throw new Error("이메일 설정이 필요합니다. sincenety config --setup");
  }

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
    provider: providerType,
    status: "sent",
    errorMessage: null,
  };

  try {
    if (providerType === "resend") {
      const { sendViaResend } = await import("./resend.js");
      await sendViaResend(config.resendKey!, rendered);
    } else {
      // gmail_smtp or custom_smtp
      const { sendEmailViaSMTP } = await import("./sender.js");
      await sendEmailViaSMTP(storage, rendered);
    }
  } catch (err) {
    log.status = "failed";
    log.errorMessage = err instanceof Error ? err.message : String(err);
    await storage.saveEmailLog(log);
    throw err;
  }

  await storage.saveEmailLog(log);
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/provider.test.ts`
Expected: PASS

- [ ] **Step 6: Build and commit**

```bash
npm run build
git add src/email/resend.ts src/email/provider.ts tests/provider.test.ts
git commit -m "feat: email provider abstraction — Resend API + SMTP routing + email_logs"
```

---

### Task 3: `out` Core — Smart Dispatch + Catchup

**Files:**
- Create: `src/core/out.ts`
- Create: `tests/out.test.ts`

- [ ] **Step 1: Write out test**

```typescript
// tests/out.test.ts
import { describe, it, expect } from "vitest";

describe("out smart dispatch", () => {
  it("should determine report types for weekday Mon-Thu", async () => {
    const { determineReportTypes } = await import("../src/core/out.js");
    // Wednesday, no unsent
    const types = determineReportTypes(new Date("2026-04-08T12:00:00"), []);
    expect(types).toEqual(["daily"]);
  });

  it("should add weekly on Friday", async () => {
    const { determineReportTypes } = await import("../src/core/out.js");
    // Friday
    const types = determineReportTypes(new Date("2026-04-10T12:00:00"), []);
    expect(types).toContain("daily");
    expect(types).toContain("weekly");
  });

  it("should add monthly on last day of month", async () => {
    const { determineReportTypes } = await import("../src/core/out.js");
    // April 30 (Thursday but last day of month)
    const types = determineReportTypes(new Date("2026-04-30T12:00:00"), []);
    expect(types).toContain("daily");
    expect(types).toContain("monthly");
  });

  it("should add weekly for unsent catchup", async () => {
    const { determineReportTypes } = await import("../src/core/out.js");
    // Monday with unsent weekly from last week
    const types = determineReportTypes(new Date("2026-04-13T12:00:00"), ["weekly"]);
    expect(types).toContain("daily");
    expect(types).toContain("weekly");
  });

  it("should detect last day of month correctly", async () => {
    const { isLastDayOfMonth } = await import("../src/core/out.js");
    expect(isLastDayOfMonth(new Date("2026-04-30"))).toBe(true);
    expect(isLastDayOfMonth(new Date("2026-04-29"))).toBe(false);
    expect(isLastDayOfMonth(new Date("2026-02-28"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/out.test.ts`

- [ ] **Step 3: Create out.ts**

```typescript
// src/core/out.ts
import type { StorageAdapter } from "../storage/adapter.js";
import { runCircle } from "./circle.js";
import { getWeekBoundary } from "./circle.js";
import { renderDailyEmail, type RenderedEmail } from "../email/renderer.js";
import { sendEmail } from "../email/provider.js";

export interface OutResult {
  sent: Array<{ type: string; date: string; subject: string }>;
  skipped: string[];
  errors: string[];
}

/** Check if date is last day of month */
export function isLastDayOfMonth(date: Date): boolean {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next.getDate() === 1;
}

/** Determine which report types to send */
export function determineReportTypes(
  today: Date,
  unsentTypes: string[],
): string[] {
  const types: string[] = ["daily"];
  
  const isFriday = today.getDay() === 5;
  const isMonthEnd = isLastDayOfMonth(today);
  
  if (isFriday || unsentTypes.includes("weekly")) types.push("weekly");
  if (isMonthEnd || unsentTypes.includes("monthly")) types.push("monthly");
  
  return [...new Set(types)];
}

/** Find unsent finalized reports */
async function findUnsentReports(storage: StorageAdapter): Promise<string[]> {
  const unsent: string[] = [];
  
  // Check last week's weekly
  const today = new Date();
  const { monday } = getWeekBoundary(today);
  const lastWeekMonday = new Date(monday);
  lastWeekMonday.setDate(lastWeekMonday.getDate() - 7);
  const lastWeekStr = lastWeekMonday.toISOString().slice(0, 10);
  
  const weeklyReport = await storage.getDailyReport(lastWeekStr, "weekly");
  if (weeklyReport && !weeklyReport.emailedAt && weeklyReport.status === "finalized") {
    unsent.push("weekly");
  }
  
  // Check last month's monthly
  const lastMonth = new Date(today);
  lastMonth.setMonth(today.getMonth() - 1);
  const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const monthlyReport = await storage.getDailyReport(lastMonthStr, "monthly");
  if (monthlyReport && !monthlyReport.emailedAt && monthlyReport.status === "finalized") {
    unsent.push("monthly");
  }
  
  return unsent;
}

/** Get the report date key for each type */
function getReportDateKey(type: string, today: Date): string {
  const todayStr = today.toISOString().slice(0, 10);
  if (type === "daily") return todayStr;
  if (type === "weekly") {
    const { monday } = getWeekBoundary(today);
    return monday;
  }
  // monthly
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
}

/** out main: smart dispatch */
export async function runOut(
  storage: StorageAdapter,
  options: { force?: "daily" | "weekly" | "monthly"; preview?: boolean; renderOnly?: boolean } = {},
): Promise<OutResult> {
  const result: OutResult = { sent: [], skipped: [], errors: [] };
  const today = new Date();
  
  // Ensure circle has run (which ensures air has run)
  await runCircle(storage);
  
  // Determine what to send
  let types: string[];
  if (options.force) {
    types = [options.force];
  } else {
    const unsent = await findUnsentReports(storage);
    types = determineReportTypes(today, unsent);
  }
  
  for (const type of types) {
    const dateKey = getReportDateKey(type, today);
    
    try {
      const rendered = await renderDailyEmail(storage, dateKey, type as any);
      if (!rendered) {
        result.skipped.push(`${type}: ${dateKey} (데이터 없음)`);
        continue;
      }
      
      if (options.renderOnly) {
        // stdout JSON output for Gmail MCP
        console.log(JSON.stringify({
          type, date: dateKey,
          subject: rendered.subject,
          recipient: rendered.recipient,
          html: rendered.html,
        }));
        result.sent.push({ type, date: dateKey, subject: rendered.subject });
        continue;
      }
      
      if (options.preview) {
        console.log(`\n  📧 [${type}] ${dateKey}`);
        console.log(`  제목: ${rendered.subject}`);
        console.log(`  수신: ${rendered.recipient}`);
        console.log(`  크기: ${Math.round(rendered.html.length / 1024)}KB`);
        result.sent.push({ type, date: dateKey, subject: rendered.subject });
        continue;
      }
      
      await sendEmail(storage, rendered);
      
      // Update emailedAt on the daily_report
      const report = await storage.getDailyReport(dateKey, type);
      if (report?.id) {
        await storage.updateDailyReportEmail(report.id, Date.now(), rendered.recipient);
      }
      
      result.sent.push({ type, date: dateKey, subject: rendered.subject });
      console.log(`  📧 ${type} 발송 완료: ${rendered.recipient}`);
      console.log(`     제목: ${rendered.subject}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${type}: ${msg}`);
      console.error(`  ❌ ${type} 발송 실패: ${msg}`);
    }
  }
  
  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/out.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/out.ts tests/out.test.ts
git commit -m "feat: out command — smart dispatch with weekday/catchup logic"
```

---

### Task 4: CLI — Add out/outd/outw/outm Commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add out commands to cli.ts**

Add after the `circle` command block:

```typescript
// ── out: 스마트 이메일 발신 ──
program
  .command("out")
  .description("스마트 이메일 발신 (요일 + 미발송 캐치업 자동 판단)")
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
        console.log("\n  최근 발송 내역");
        console.log("  ┌────────────┬────────┬──────────────────────────┬────────┐");
        console.log("  │ 날짜       │ 유형   │ 수신자                   │ 상태   │");
        console.log("  ├────────────┼────────┼──────────────────────────┼────────┤");
        for (const log of logs) {
          const date = new Date(log.sentAt).toISOString().slice(0, 10);
          console.log(`  │ ${date.padEnd(10)} │ ${log.reportType.padEnd(6)} │ ${log.recipient.padEnd(24)} │ ${log.status.padEnd(6)} │`);
        }
        console.log("  └────────────┴────────┴──────────────────────────┴────────┘\n");
        return;
      }

      const { runOut } = await import("./core/out.js");
      const result = await runOut(storage, {
        preview: options.preview,
        renderOnly: options.renderOnly,
      });

      if (!options.preview && !options.renderOnly) {
        console.log(`\n  ✅ out 완료 — ${result.sent.length}건 발송, ${result.skipped.length}건 스킵`);
        if (result.errors.length > 0) {
          console.log(`  ❌ 오류: ${result.errors.join(", ")}`);
        }
      }
    } catch (err) {
      console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    } finally {
      await storage.close();
    }
  });

// ── outd/outw/outm: 강제 발신 ──
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
        const { runOut } = await import("./core/out.js");
        const result = await runOut(storage, {
          force: type,
          preview: options.preview,
        });
        if (!options.preview) {
          console.log(`\n  ✅ ${cmd} 완료 — ${result.sent.length}건 발송`);
        }
      } catch (err) {
        console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      } finally {
        await storage.close();
      }
    });
}
```

- [ ] **Step 2: Build and smoke test**

Run:
```bash
npm run build
node dist/cli.js out --help
node dist/cli.js outd --help
node dist/cli.js outw --help
node dist/cli.js outm --help
```
Expected: Help text for all 4 commands

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: out/outd/outw/outm CLI commands with preview and history"
```

---

### Task 5: Update SKILL.md + Integration Test

**Files:**
- Modify: `src/skill/SKILL.md`

- [ ] **Step 1: Update SKILL.md step 5**

Replace the step 5 section:
```markdown
### 5단계: 이메일 발송 (설정된 경우)

발송 경로 자동 판단:
1. Gmail MCP 사용 가능? → `gmail_get_profile` 확인 후 `sincenety out --render-only`로 HTML 획득 → `gmail_create_draft`로 발송
2. SMTP/Resend 설정됨? → `sincenety out`으로 발송
3. 설정 없음? → 터미널 출력만 (이메일 스킵)

```bash
sincenety out
```
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Full smoke test**

```bash
node dist/cli.js out --preview
node dist/cli.js out --history
node dist/cli.js outd --preview
```

- [ ] **Step 4: Commit**

```bash
git add src/skill/SKILL.md
git commit -m "docs: SKILL.md step 5 — sincenety out 발송 경로"
```

---

## Plan Summary

| Task | Description | Est. Steps |
|------|-------------|------------|
| 1 | Email Renderer — extract from sender.ts | 4 |
| 2 | Resend + Provider Abstraction | 6 |
| 3 | `out` Core — smart dispatch + catchup | 5 |
| 4 | CLI — out/outd/outw/outm commands | 3 |
| 5 | SKILL.md + Integration Test | 4 |
| **Total** | | **22 steps** |

**Next:** Plan 3 (vacation management, config wizard, Gmail MCP integration)
