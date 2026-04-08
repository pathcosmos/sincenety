# Plan 3: Vacation Management + Config Wizard + Gmail MCP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining v0.3.x features: vacation detection (Google Calendar + manual), interactive `config --setup` wizard, and Gmail MCP email integration in SKILL.md.

**Architecture:** Vacation manager handles CRUD + Google Calendar keyword detection. Config wizard is a sequential prompt flow supporting 3 providers (Gmail/Resend/Custom SMTP) with connection test. SKILL.md Gmail MCP path uses `out --render-only` + `gmail_create_draft`.

**Tech Stack:** TypeScript ESM, commander, vitest

**Spec:** `docs/superpowers/specs/2026-04-08-cli-restructure-design.md` — Vacation + Config sections

**Depends on:** Plan 1 (DB v4 vacations table) + Plan 2 (out/provider)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/vacation/manager.ts` | Vacation CRUD (manual registration, query, delete) |
| Create | `src/vacation/detector.ts` | Google Calendar keyword detection (SKILL.md helper) |
| Create | `src/config/setup-wizard.ts` | Interactive config --setup flow |
| Modify | `src/cli.ts` | Wire config --setup to wizard, clean up vacation options |
| Modify | `src/core/circle.ts` | Integrate vacation info into report generation |
| Modify | `src/skill/SKILL.md` | Gmail MCP path, vacation detection step |
| Create | `tests/vacation.test.ts` | Vacation manager + detector tests |
| Create | `tests/setup-wizard.test.ts` | Setup wizard logic tests |

---

### Task 1: Vacation Manager

**Files:**
- Create: `src/vacation/manager.ts`
- Create: `tests/vacation.test.ts`

- [ ] **Step 1: Write vacation test**

```typescript
// tests/vacation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqlJsAdapter } from "../src/storage/sqljs-adapter.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

describe("vacation manager", () => {
  let tmpDir: string;
  let adapter: SqlJsAdapter;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sincenety-vac-"));
    adapter = new SqlJsAdapter({ dbPath: join(tmpDir, "test.db") });
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should register vacation days", async () => {
    const { registerVacation } = await import("../src/vacation/manager.js");
    await registerVacation(adapter, ["2026-04-10", "2026-04-11"], "vacation");
    const result = await adapter.getVacationsByRange("2026-04-01", "2026-04-30");
    expect(result).toHaveLength(2);
  });

  it("should register with type", async () => {
    const { registerVacation } = await import("../src/vacation/manager.js");
    await registerVacation(adapter, ["2026-04-15"], "sick");
    const result = await adapter.getVacationsByRange("2026-04-01", "2026-04-30");
    expect(result[0].type).toBe("sick");
  });

  it("should list vacations for period", async () => {
    const { registerVacation, listVacations } = await import("../src/vacation/manager.js");
    await registerVacation(adapter, ["2026-04-10", "2026-04-11"], "vacation");
    const list = await listVacations(adapter, "2026-04-01", "2026-04-30");
    expect(list).toHaveLength(2);
  });

  it("should delete vacation", async () => {
    const { registerVacation, removeVacation } = await import("../src/vacation/manager.js");
    await registerVacation(adapter, ["2026-04-10"], "vacation");
    await removeVacation(adapter, "2026-04-10");
    const result = await adapter.getVacationsByRange("2026-04-01", "2026-04-30");
    expect(result).toHaveLength(0);
  });

  it("should check if date is vacation", async () => {
    const { registerVacation, isVacationDay } = await import("../src/vacation/manager.js");
    await registerVacation(adapter, ["2026-04-10"], "vacation");
    expect(await isVacationDay(adapter, "2026-04-10")).toBe(true);
    expect(await isVacationDay(adapter, "2026-04-11")).toBe(false);
  });

  it("should get vacation stats for period", async () => {
    const { registerVacation, getVacationStats } = await import("../src/vacation/manager.js");
    await registerVacation(adapter, ["2026-04-10", "2026-04-11"], "vacation");
    await registerVacation(adapter, ["2026-04-15"], "sick");
    const stats = await getVacationStats(adapter, "2026-04-01", "2026-04-30");
    expect(stats.total).toBe(3);
    expect(stats.byType.vacation).toBe(2);
    expect(stats.byType.sick).toBe(1);
  });

  it("should detect vacation keywords", async () => {
    const { isVacationKeyword } = await import("../src/vacation/detector.js");
    expect(isVacationKeyword("연차")).toBe(true);
    expect(isVacationKeyword("Annual Vacation")).toBe(true);
    expect(isVacationKeyword("PTO")).toBe(true);
    expect(isVacationKeyword("병가")).toBe(true);
    expect(isVacationKeyword("Team meeting")).toBe(false);
    expect(isVacationKeyword("반차")).toBe(true);
  });

  it("should map keyword to vacation type", async () => {
    const { detectVacationType } = await import("../src/vacation/detector.js");
    expect(detectVacationType("연차")).toBe("vacation");
    expect(detectVacationType("병가")).toBe("sick");
    expect(detectVacationType("반차")).toBe("half");
    expect(detectVacationType("공휴일")).toBe("holiday");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vacation.test.ts`

- [ ] **Step 3: Create vacation/manager.ts**

```typescript
// src/vacation/manager.ts
import type { StorageAdapter, VacationRecord } from "../storage/adapter.js";

/** Register vacation days */
export async function registerVacation(
  storage: StorageAdapter,
  dates: string[],
  type: string = "vacation",
  source: string = "manual",
  label: string | null = null,
): Promise<void> {
  for (const date of dates) {
    await storage.saveVacation({
      date,
      type,
      source,
      label,
      createdAt: Date.now(),
    });
  }
}

/** List vacations in date range */
export async function listVacations(
  storage: StorageAdapter,
  from: string,
  to: string,
): Promise<VacationRecord[]> {
  return storage.getVacationsByRange(from, to);
}

/** Remove a vacation day */
export async function removeVacation(
  storage: StorageAdapter,
  date: string,
): Promise<void> {
  await storage.deleteVacation(date);
}

/** Check if a specific date is a vacation day */
export async function isVacationDay(
  storage: StorageAdapter,
  date: string,
): Promise<boolean> {
  const vacations = await storage.getVacationsByRange(date, date);
  return vacations.length > 0;
}

/** Get vacation statistics for a period */
export async function getVacationStats(
  storage: StorageAdapter,
  from: string,
  to: string,
): Promise<{ total: number; byType: Record<string, number>; dates: string[] }> {
  const vacations = await storage.getVacationsByRange(from, to);
  const byType: Record<string, number> = {};
  for (const v of vacations) {
    byType[v.type] = (byType[v.type] ?? 0) + 1;
  }
  return {
    total: vacations.length,
    byType,
    dates: vacations.map((v) => v.date),
  };
}
```

- [ ] **Step 4: Create vacation/detector.ts**

```typescript
// src/vacation/detector.ts

/** Vacation keyword patterns (Korean + English) */
const VACATION_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /휴가|vacation|연차|PTO|annual\s*leave/i, type: "vacation" },
  { pattern: /병가|sick\s*(leave|day)?/i, type: "sick" },
  { pattern: /공휴일|holiday|국경일/i, type: "holiday" },
  { pattern: /반차|half[\s-]?day/i, type: "half" },
  { pattern: /대휴|compensatory|보상휴가/i, type: "other" },
];

/** Check if text contains a vacation keyword */
export function isVacationKeyword(text: string): boolean {
  return VACATION_PATTERNS.some((p) => p.pattern.test(text));
}

/** Detect vacation type from text */
export function detectVacationType(text: string): string | null {
  for (const { pattern, type } of VACATION_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

/** Extract vacation info from Google Calendar event summary */
export function parseCalendarEvent(summary: string, isAllDay: boolean): {
  isVacation: boolean;
  type: string;
} | null {
  if (!isVacationKeyword(summary)) return null;
  const type = detectVacationType(summary) ?? "vacation";
  return { isVacation: true, type };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/vacation.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/vacation/manager.ts src/vacation/detector.ts tests/vacation.test.ts
git commit -m "feat: vacation manager + keyword detector (Korean/English)"
```

---

### Task 2: Config Setup Wizard

**Files:**
- Create: `src/config/setup-wizard.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create setup-wizard.ts**

```typescript
// src/config/setup-wizard.ts
import { createInterface } from "node:readline";
import { createTransport } from "nodemailer";
import type { StorageAdapter } from "../storage/adapter.js";

interface WizardResult {
  provider: string;
  success: boolean;
  message: string;
}

/** Interactive setup wizard for email configuration */
export async function runSetupWizard(storage: StorageAdapter): Promise<WizardResult> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  try {
    console.log("\n  sincenety 이메일 설정");
    console.log("  ─────────────────────");
    console.log("  발송 방식 선택:");
    console.log("    1. Gmail SMTP (앱 비밀번호 필요)");
    console.log("    2. Resend API (API 키 1개, 추천 ⭐)");
    console.log("    3. 커스텀 SMTP (직접 입력)");
    console.log("");

    const choice = (await ask("  선택 [1]: ")).trim() || "1";

    if (choice === "2") {
      return await setupResend(storage, ask);
    } else if (choice === "3") {
      return await setupCustomSMTP(storage, ask);
    } else {
      return await setupGmail(storage, ask);
    }
  } finally {
    rl.close();
  }
}

async function setupGmail(
  storage: StorageAdapter,
  ask: (q: string) => Promise<string>,
): Promise<WizardResult> {
  const email = (await ask("  Gmail 이메일 주소: ")).trim();
  if (!email) return { provider: "gmail", success: false, message: "이메일 미입력" };

  console.log("");
  console.log("  📋 Gmail 앱 비밀번호가 필요합니다:");
  console.log("     https://myaccount.google.com/apppasswords");
  console.log("");

  const password = (await ask("  앱 비밀번호 (16자리): ")).trim();
  if (!password) return { provider: "gmail", success: false, message: "비밀번호 미입력" };

  // Connection test
  console.log("\n  연결 테스트 중...");
  try {
    const transporter = createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: email, pass: password },
    });
    await transporter.verify();
    console.log("  ✅ Gmail SMTP 연결 성공!");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ 연결 실패: ${msg}`);
    console.log("  앱 비밀번호를 확인하고 다시 시도해 주세요.");
    return { provider: "gmail", success: false, message: msg };
  }

  // Save config
  await storage.setConfig("provider", "gmail");
  await storage.setConfig("email", email);
  await storage.setConfig("smtp_user", email);
  await storage.setConfig("smtp_pass", password);
  await storage.setConfig("smtp_host", "smtp.gmail.com");
  await storage.setConfig("smtp_port", "587");

  console.log("\n  ✅ 설정 완료! 'sincenety outd'로 테스트 발송해 보세요.\n");
  return { provider: "gmail", success: true, message: "Gmail SMTP 설정 완료" };
}

async function setupResend(
  storage: StorageAdapter,
  ask: (q: string) => Promise<string>,
): Promise<WizardResult> {
  console.log("");
  console.log("  📋 Resend API 키 발급:");
  console.log("     https://resend.com/api-keys");
  console.log("     (무료 — 100통/일, 카드 등록 불필요)");
  console.log("");

  const apiKey = (await ask("  API 키: ")).trim();
  if (!apiKey) return { provider: "resend", success: false, message: "API 키 미입력" };

  const email = (await ask("  수신 이메일: ")).trim();
  if (!email) return { provider: "resend", success: false, message: "이메일 미입력" };

  // Connection test
  console.log("\n  연결 테스트 중...");
  try {
    const res = await fetch("https://api.resend.com/api-keys", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log("  ✅ Resend 연결 성공!");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ 연결 실패: ${msg}`);
    return { provider: "resend", success: false, message: msg };
  }

  await storage.setConfig("provider", "resend");
  await storage.setConfig("resend_key", apiKey);
  await storage.setConfig("email", email);

  console.log("\n  ✅ 설정 완료! 'sincenety outd'로 테스트 발송해 보세요.\n");
  return { provider: "resend", success: true, message: "Resend 설정 완료" };
}

async function setupCustomSMTP(
  storage: StorageAdapter,
  ask: (q: string) => Promise<string>,
): Promise<WizardResult> {
  const host = (await ask("  SMTP 호스트: ")).trim();
  if (!host) return { provider: "smtp", success: false, message: "호스트 미입력" };

  const portStr = (await ask("  SMTP 포트 [587]: ")).trim() || "587";
  const port = parseInt(portStr, 10);

  const user = (await ask("  SMTP 사용자: ")).trim();
  if (!user) return { provider: "smtp", success: false, message: "사용자 미입력" };

  const password = (await ask("  SMTP 비밀번호: ")).trim();
  if (!password) return { provider: "smtp", success: false, message: "비밀번호 미입력" };

  const email = (await ask("  수신 이메일: ")).trim();
  if (!email) return { provider: "smtp", success: false, message: "이메일 미입력" };

  // Connection test
  console.log("\n  연결 테스트 중...");
  try {
    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
    });
    await transporter.verify();
    console.log("  ✅ SMTP 연결 성공!");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ❌ 연결 실패: ${msg}`);
    return { provider: "smtp", success: false, message: msg };
  }

  await storage.setConfig("provider", "smtp");
  await storage.setConfig("smtp_host", host);
  await storage.setConfig("smtp_port", String(port));
  await storage.setConfig("smtp_user", user);
  await storage.setConfig("smtp_pass", password);
  await storage.setConfig("email", email);

  console.log("\n  ✅ 설정 완료! 'sincenety outd'로 테스트 발송해 보세요.\n");
  return { provider: "smtp", success: true, message: "커스텀 SMTP 설정 완료" };
}
```

- [ ] **Step 2: Wire config --setup in cli.ts**

In `src/cli.ts`, replace the `--setup` stub with:

```typescript
if (options.setup) {
  const { runSetupWizard } = await import("./config/setup-wizard.js");
  await runSetupWizard(storage);
  return;
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/config/setup-wizard.ts src/cli.ts
git commit -m "feat: config --setup wizard — Gmail/Resend/Custom SMTP with connection test"
```

---

### Task 3: Vacation Integration in circle + out

**Files:**
- Modify: `src/core/circle.ts`
- Modify: `src/core/out.ts`

- [ ] **Step 1: Add vacation awareness to circle.ts**

In `circleSave`, when building the daily_reports entry, check if the date is a vacation day and add metadata:

```typescript
// At the top of circleSave, after determining the date:
const { isVacationDay } = await import("../vacation/manager.js");
const isVacation = await isVacationDay(storage, input.date);
// If vacation day and no sessions, set overview to include "[휴가]"
if (isVacation && input.sessions.length === 0) {
  input.overview = input.overview ?? "[휴가]";
}
```

- [ ] **Step 2: Add vacation skip to out.ts**

In `runOut`, before sending daily reports, check if today is vacation:

```typescript
// In runOut, after determining types but before the send loop:
const { isVacationDay } = await import("../vacation/manager.js");
const todayStr = today.toISOString().slice(0, 10);
if (await isVacationDay(storage, todayStr) && !options.force) {
  console.log("  📅 오늘은 휴가일입니다. 발신을 건너뜁니다.");
  console.log("  (강제 발신: sincenety outd)");
  return { sent: [], skipped: ["vacation"], errors: [] };
}
```

- [ ] **Step 3: Build and test**

Run: `npm run build && npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/core/circle.ts src/core/out.ts
git commit -m "feat: vacation integration — circle [휴가] label, out skip on vacation"
```

---

### Task 4: SKILL.md Gmail MCP Path + Vacation Detection

**Files:**
- Modify: `src/skill/SKILL.md`

- [ ] **Step 1: Update SKILL.md**

Add Gmail MCP detailed path in step 5:

```markdown
### 5단계: 이메일 발송 (설정된 경우)

발송 경로 자동 판단:

**경로 A: Gmail MCP (Claude Code 안, 설정 불필요)**
1. `gmail_get_profile` 호출 — 성공하면 Gmail MCP 사용 가능
2. `sincenety out --render-only` 실행 → JSON 출력 (subject, recipient, html)
3. JSON에서 subject, recipient, html 추출
4. `gmail_create_draft`로 이메일 초안 생성 (contentType: "text/html")
5. 사용자에게 발송 확인 후 발송

**경로 B: SMTP/Resend (설정 필요)**
```bash
sincenety out
```
```

Add vacation detection step in circle workflow:

```markdown
### 1.5단계: 휴가 감지 (Google Calendar MCP 있을 때)

Google Calendar MCP 사용 가능하면:
1. `gcal_list_events`로 해당 기간 일정 조회
2. 종일 이벤트 중 휴가/연차/PTO/병가 키워드 감지
3. 감지된 날짜를 휴가로 등록:
```bash
sincenety config --vacation YYYY-MM-DD --vacation-type vacation
```
```

- [ ] **Step 2: Commit**

```bash
git add src/skill/SKILL.md
git commit -m "docs: SKILL.md — Gmail MCP 상세 경로, 휴가 감지 단계 추가"
```

---

### Task 5: Integration Test + README Update + Final Build

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass (78 existing + new vacation tests)

- [ ] **Step 2: Smoke tests**

```bash
node dist/cli.js config --vacation 2026-04-10 2026-04-11
node dist/cli.js config --vacation-list
node dist/cli.js config --vacation-clear 2026-04-10
node dist/cli.js config --vacation-list
node dist/cli.js config
```

- [ ] **Step 3: Update README files**

Add to both README.md and README.ko.md:
- Vacation management section
- `config --setup` wizard description
- Gmail MCP integration note
- Updated test count
- v0.3.2 changelog entry

- [ ] **Step 4: Final build + commit**

```bash
npm run build
git add -A
git commit -m "feat: sincenety v0.3.2 — vacation, config wizard, Gmail MCP (Plan 3)"
```

---

## Plan Summary

| Task | Description | Est. Steps |
|------|-------------|------------|
| 1 | Vacation Manager + Detector | 6 |
| 2 | Config Setup Wizard | 4 |
| 3 | Vacation Integration (circle + out) | 4 |
| 4 | SKILL.md Gmail MCP + Vacation | 2 |
| 5 | Integration + README + Final | 4 |
| **Total** | | **20 steps** |
