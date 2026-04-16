# sincenety

**Automatic work session tracker for Claude Code** — A 3-phase pipeline that retroactively collects, summarizes, and reports all Claude Code activity. No start/stop needed.

> **[한국어 문서 (Korean)](./README.ko.md)** | **[Sample Report](https://pathcosmos.github.io/sincenety/sample-report.html)** | **[CLI Report (Workers AI)](https://pathcosmos.github.io/sincenety/sample-report-cli.html)**

```
$ sincenety

  ☁️  D1 sync complete
  ☁️  D1 sync complete
  ✅ sincenety complete — 1 sent, 0 skipped

$ sincenety air

  📋 air complete
     Date range: 3 days (backfill 2 days)
     Total sessions: 12
     Changed dates: 2
     Changed: 2026-04-06, 2026-04-07

$ sincenety circle

  📋 circle complete
     Date range: 3 days
     Total sessions: 12
     Changed dates: 2
     Finalized: 2026-04-06
     Needs summary: 2026-04-07
```

---

## Features

### Default Command: Full Pipeline

**v0.7.0** — Running `sincenety` with no arguments executes the entire pipeline automatically: **air → circle → out**. This is the recommended way to use sincenety — one command does everything.

If D1 or email is not configured, it shows help + setup instructions instead.

### 3-Phase Pipeline: air → circle → out

The pipeline can also be run in individual phases:

1. **`sincenety air`** — Collect and store work records by date
   - Date-based grouping (midnight boundary, startedAt-based)
   - Automatic backfill: checkpoint-based, collects empty dates too
   - Change detection: data hash skips unchanged dates
   - Empty day records (no sessions = still recorded)
   - `--json` outputs per-date JSON

2. **`sincenety circle`** — LLM-powered summaries
   - Internally runs `air` first
   - `--json`: outputs session data for AI summary (SKILL.md integration)
   - `--save`: saves stdin JSON to `daily_reports`
   - `--type daily|weekly|monthly`
   - Auto-finalization: midnight finalizes previous day, Monday finalizes previous week, 1st finalizes previous month
   - Change detection: data hash comparison saves tokens
   - Vacation days get a [vacation] label automatically
   - **Project-level session merge**: all sessions within the same `projectName` are individually summarized, then consolidated into a single merged summary per project — eliminates duplicate entries and improves report coherence

3. **`sincenety out`** — Smart email delivery
   - `out`: daily always, +weekly on Friday, +monthly on month-end
   - Unsent catchup: missed Friday → Monday auto-sends weekly
   - 4 providers: Gmail MCP / Resend / Gmail SMTP / Custom SMTP
   - `outd` / `outw` / `outm`: force daily / weekly / monthly
   - `--preview`, `--render-only`, `--history`

### CLI Commands

| Command | Description |
|---------|-------------|
| `sincenety` | **Full pipeline** — air → circle → out in one command |
| `sincenety air` | Collect — date-grouped auto-backfill gathering |
| `sincenety circle` | Summarize — LLM summary (--json/--save/--type) |
| `sincenety out` | Smart dispatch (weekday + unsent catchup) |
| `sincenety outd` | Force send daily report |
| `sincenety outw` | Force send weekly report |
| `sincenety outm` | Force send monthly report |
| `sincenety sync` | D1 central cloud sync |
| `sincenety config` | Settings (--setup, --vacation, --d1-*) |

### Retroactive Work Gathering

No need to remember to start/stop tracking. `sincenety` parses `~/.claude/` data at runtime and reconstructs everything:

- **Session JSONL parsing** — Extracts token usage, model names, millisecond-precision timestamps, and conversation turns from `~/.claude/projects/[project]/[sessionId].jsonl`
- **Checkpoint-based backfill** — Automatically fills gaps from last checkpoint; first run backfills 90 days

### Rich Work Records

| Field | Description |
|-------|-------------|
| Title | Auto-extracted from first user message |
| Description | Top 3-5 user messages joined |
| Token usage | Per-message input/output/cache token aggregation |
| Duration | First message → last message precise measurement |
| Model | Extracted from assistant responses |
| Category | Auto-classified from project path |

### AI Summarization Engine

Unified AI provider system — **`ai_provider` config is respected in all environments** (CLI, cron, Claude Code):

| `ai_provider` | `circle` auto-summary | `gatherer` summary | Typical use case |
|----------------|----------------------|-------------------|-----------------|
| `cloudflare` | Workers AI (Qwen3-30B) → heuristic fallback | Workers AI | CLI / cron |
| `anthropic` | Skip (no auto-summary) | Claude API (Haiku) | API key available |
| `claude-code` | Skip (SKILL.md handles it) | Heuristic | Claude Code `/sincenety` |
| `auto` (default) | Auto-detect: cloudflare only | Auto-detect | First-time setup |

```bash
# AI provider configuration (controls behavior in ALL environments)
sincenety config --ai-provider cloudflare   # Use Workers AI
sincenety config --ai-provider anthropic    # Use Claude API
sincenety config --ai-provider claude-code  # Claude Code direct summary (SKILL.md)
sincenety config --ai-provider auto         # Auto-detect (default)

# Check current settings
sincenety config
# → AI summary: ai_provider = auto (auto → cloudflare)
```

- **Cloudflare Workers AI (Qwen3-30B)** for Korean text summarization
- D1 token only needed — no separate API key required
- `circle` auto-summarizes when `ai_provider` is `cloudflare`: per-session topic/outcome/flow/significance + daily overview
- `circle --json --summarize`: Workers AI summaries included in JSON output (requires `ai_provider = cloudflare`)
- Free tier: 10,000 neurons/day (sufficient for personal use, ~300 summaries/day)
- **Heuristic fallback**: if Workers AI call fails for a session, falls back to heuristic summary (no data loss)

### Email AI Summary Integration

Email reports include AI-generated summaries from `daily_reports`:
- **Overview section** at the top of each email with a full-day summary
- **Per-session mapping**: `daily_reports` wrapUp data maps to each session's topic/outcome/flow/significance
- **Gmail 102KB clip prevention**: actions capped at 5 per session, text length optimized to stay under Gmail's clipping threshold

### Required Setup (Mandatory)

sincenety requires **two configurations** before any command can run:

1. **D1 Cloud Sync** — Cloudflare API token (enables Workers AI + cloud sync)
2. **Email Delivery** — SMTP or Resend (enables report email delivery)

```bash
# Step 1: D1 token (auto-detects account, creates DB, enables Workers AI)
sincenety config --d1-token <API_TOKEN>

# Step 2: Email setup (interactive wizard)
sincenety config --setup
# → Gmail app password: https://myaccount.google.com/apppasswords
```

All commands (`air`, `circle`, `out`, `sync`, etc.) will refuse to run until both are configured. Only `config` is exempt.

### Vacation Management

- **Google Calendar auto-detection** — SKILL.md instructs Claude Code to check Google Calendar for vacation events
- **CLI manual registration** — `config --vacation 2026-04-10 2026-04-11`
- **Vacation keywords** (Korean + English): 휴가/vacation/연차/PTO/병가/sick/반차/half-day
- **Vacation types**: vacation / sick / holiday / half / other
- **Report integration** — vacation days get a [vacation] label in `circle`; `out` skips vacation days automatically

### Config Setup Wizard

Run `sincenety config --setup` for an interactive 3-choice wizard:
1. Gmail SMTP (with app password URL guidance)
2. Resend API
3. Custom SMTP

Connection test runs automatically on setup completion.

### Gmail MCP Integration

Zero-config email delivery inside Claude Code via `gmail_create_draft` MCP tool. No SMTP credentials needed — Claude Code drafts the email directly in Gmail. Use `out --render-only` to get HTML output for the MCP path.

### Config Management

Run `sincenety config` with no arguments to see a formatted settings status table. Supports vacation registration, email provider selection (Gmail/Resend/custom SMTP), and more.

### Scope Selection (Global / Project)

Choose whether to track **all projects** on this machine or a **specific project only**:

- **Global mode** — collects all Claude Code sessions across all projects
- **Project mode** — filters to sessions from a single project path

Scope is set during initial setup (`npm install -g`) or on first `npx sincenety` run. Stored at `~/.sincenety/scope.json`.

### Cloud Sync (Cloudflare D1)

Multi-machine data aggregation via Cloudflare D1:

- **Local-first**: encrypted local DB remains the source of truth
- **`sincenety sync`** pushes local data to a central D1 database (push / pull-config / status / init)
- **Auto-sync** after `out` completes (non-fatal — network errors don't block email delivery)
- **Shared config**: SMTP settings set once, `sync --pull-config` on new machines to pull shared config
- **Machine ID**: hardware-based auto-detection (see below), `config --machine-name` override for custom identification
- **Zero new dependencies**: uses native `fetch` for D1 REST API — no extra packages added

### Pipeline Mode Switch & Auto Weekly/Monthly Baseline

**v0.8.4** — `out`/`outd`/`outw`/`outm` now **always** have a fresh weekly/monthly baseline in the DB, closing the gap where `outw`/`outm` could silently produce empty results:

- **Auto baseline generation**: On every run, the pipeline aggregates this week's (Mon–Sun) and this month's (1st–last day) `daily_reports`, runs project-level consolidation, and upserts the weekly/monthly row
- **Emailed-report protection**: Rows with `emailedAt != null` are never overwritten, preserving already-delivered reports
- **`--mode=full|smart` switch**: `full` (default) regenerates baselines every run; `smart` preserves v0.8.3 behavior (weekly only on Friday, monthly only on month-end — token-saving)
- **Config-level default**: `sincenety config --pipeline-mode <full|smart>` stores a persistent default
- **Silent failure hardening**: Auto-summary failures are structured into `CircleResult.summaryErrors`, promoted to `result.errors` by `runOut`, and propagated to CLI exit code (`process.exitCode = 1`) — cron environments can now detect weekly/monthly refresh failures via exit code
- **`emailedAt === 0` falsy guard fixed**: Explicit `!= null` comparison prevents edge-case overwrite of already-sent reports
- **JSON.parse warnings**: Corrupted `summaryJson` in a daily row now emits a warning with the failing `reportDate` instead of silently dropping data

### Cross-Device Consolidated Reports

**v0.8.0** — When working on multiple machines (e.g., Mac + Linux), sessions from all devices are automatically merged into a single daily report:

- **Push-before-pull**: local data is pushed to D1 first, then other devices' sessions are pulled for consolidation
- **Circle cross-device merge**: `circle` (AI summarization) pulls other devices' sessions from D1 and generates a unified summary covering all machines — not just local work
- **Always-send policy**: `out` always sends email regardless of whether another device already sent — no skip, no dedup
- **Session merge by topic**: sessions with identical `projectName + title` are automatically merged — stats aggregated, best wrapUp selected, flow narratives concatenated
- **Graceful fallback**: if D1 is unreachable, falls back to single-device local-only behavior
- **Title extraction improvement**: sessions starting with slash commands (e.g., `/sincenety`) now get meaningful fallback titles instead of empty strings

### Cloudflare API Token Setup

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. **"Create Token"** → **"Custom token"** (click "Get started" at the bottom)
3. **Set permissions**:

| Permission | Access | Purpose |
|-----------|--------|---------|
| Account / **D1** | **Edit** | DB creation + read/write |
| Account / **Workers AI** | **Read** | AI summary model (Qwen3-30B) |
| Account / **Account Settings** | **Read** | Account auto-detection on `--d1-token` setup |

> **All 3 are required.** Without Account Settings Read, `--d1-token` setup cannot find your account.

4. **Account Resources** → Include → select your account
5. **"Create Token"** → copy the token (shown only once!)

> This single token powers D1 (central DB) + Workers AI (summary engine) + sync.

### Token-Only D1 Setup

A single token is all you need. Everything else is auto-detected:

```bash
sincenety config --d1-token cfp_xxxxxxxx
# ✅ Account auto-detected
# ✅ D1 database auto-created/connected
# ✅ machine_id auto-detected (hardware UUID-based)
# ✅ Workers AI auto-enabled (Qwen3-30B)
# ✅ Schema setup complete
```

### Auto Machine ID

Hardware-based machine identification — zero configuration needed:

| Platform | Source | Characteristics |
|----------|--------|-----------------|
| macOS | IOPlatformUUID | Hardware-unique, survives OS reinstall |
| Linux | /etc/machine-id | OS-unique |
| Windows | MachineGuid | Install-unique |

- **Format**: `mac_a1b2c3d4_username`
- Auto-detected with no user action required
- Same machine always produces the same ID
- Used for D1 sync machine registry (`machines` table)

### Encrypted Storage

All data is AES-256-GCM encrypted at `~/.sincenety/sincenety.db`. Machine-bound key (hostname + username + random salt) by default.

---

## Installation & Setup

There are two ways to run sincenety: **npx** (no install) or **global install**.

### Option A: npx (recommended for first-time / one-shot use)

> **All three flags are required on first run.** Without them, sincenety will show setup instructions and exit.

**Prerequisites — get your tokens first:**

1. **Cloudflare D1 API Token** — [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   - Create a Custom token with these permissions:

   | Permission | Access | Purpose |
   |-----------|--------|---------|
   | Account / **D1** | **Edit** | DB creation + read/write |
   | Account / **Workers AI** | **Read** | AI summarization (Qwen3-30B) |
   | Account / **Account Settings** | **Read** | Account auto-detection |

2. **Resend API Key** — [resend.com/api-keys](https://resend.com/api-keys)
   - Free tier: 100 emails/day (more than enough for daily reports)

**Run:**

```bash
npx sincenety --token <D1_TOKEN> --key <RESEND_KEY> --email you@example.com
```

This single command will:
- Save D1 token → auto-detect Cloudflare account → create DB → setup schema
- Save Resend API key + recipient email
- Run the full pipeline: **air → circle → out**

**Subsequent runs** — config persists in `~/.sincenety/`, so you only need:

```bash
npx sincenety
```

### Option B: Global install (recommended for daily use)

```bash
npm install -g sincenety@latest
```

The installer runs an interactive setup wizard:

```
  ┌──────────────────────────────────────────────┐
  │  sincenety — Initial Setup                   │
  └──────────────────────────────────────────────┘

  ── Step 1/3: Scope ─────────────────────────────
    1) Global   — track all Claude Code projects on this machine
    2) Project  — track only a specific project

  ── Step 2/3: D1 Cloud Sync ─────────────────────
    Guided Cloudflare API token creation with required permissions:
      Account | Workers AI       | Read
      Account | D1               | Edit
      Account | Account Settings | Read

  ── Step 3/3: Email Delivery ────────────────────
    1) Gmail SMTP  (app password required)
    2) Resend API  (resend.com API key)
    3) Custom SMTP
```

After setup, just run:

```bash
sincenety
```

> **Note**: The setup wizard only runs on first install. Subsequent updates preserve your configuration. In non-TTY environments (CI/Docker), the wizard is skipped — configure manually with `sincenety config --setup`.

### Build from source

```bash
git clone https://github.com/pathcosmos/sincenety.git
cd sincenety
npm install && npm run build
npm link
```

### Verify setup

```bash
sincenety config
# Shows all settings with ✅/❌ status
# AI summary: ai_provider = auto (auto → cloudflare)
```

## Usage

### Default — Full Pipeline

```bash
# Run the entire pipeline: air → circle → out
sincenety

# If D1 or email is not configured, shows help + setup instructions
```

### air — Collect Work Records

```bash
# Collect all sessions (checkpoint-based backfill, first run = 90 days)
sincenety air

# Specify custom history.jsonl path
sincenety air --history /path/to/history.jsonl

# JSON output (per-date structured data)
sincenety air --json
```

### circle — AI Summary Pipeline

```bash
# Run air + check finalization status
sincenety circle

# Output session data as JSON for AI summary (SKILL.md integration)
sincenety circle --json

# Output with Workers AI summaries included (for SKILL.md cloudflare mode)
sincenety circle --json --summarize

# Save AI-generated summary to DB (stdin JSON)
sincenety circle --save < summary.json
sincenety circle --save --type weekly < weekly_summary.json
sincenety circle --save --type monthly < monthly_summary.json
```

### config — Settings Management

```bash
# Interactive setup wizard (Gmail SMTP / Resend / Custom SMTP)
sincenety config --setup

# Show current settings (ANSI table)
sincenety config

# Email settings
sincenety config --email you@gmail.com
sincenety config --smtp-user sender@gmail.com
sincenety config --smtp-pass       # Prompted securely
sincenety config --provider resend
sincenety config --resend-key rk_...

# AI provider (controls Claude Code behavior)
sincenety config --ai-provider cloudflare   # Workers AI
sincenety config --ai-provider anthropic    # Claude API
sincenety config --ai-provider claude-code  # Claude Code direct summary
sincenety config --ai-provider auto         # Auto-detect (default)

# Vacation management
sincenety config --vacation 2026-04-10 2026-04-11
sincenety config --vacation-list
sincenety config --vacation-clear 2026-04-10
```

> Generate Gmail app password: https://myaccount.google.com/apppasswords

### out — Smart Email Delivery

```bash
# Smart dispatch (daily always, +weekly on Friday, +monthly on month-end)
sincenety out

# Preview (no send)
sincenety out --preview

# HTML JSON output (for Gmail MCP)
sincenety out --render-only

# View send history
sincenety out --history

# Force send specific report type
sincenety outd    # daily report
sincenety outw    # weekly report
sincenety outm    # monthly report

# Target specific date (yyyyMMdd)
sincenety outd --date 20260408   # daily report for Apr 8
sincenety outw --date 20260408   # weekly report for week of Apr 6-12
sincenety outm --date 20260408   # monthly report for April 2026
sincenety out --date 20260408    # smart dispatch as if today is Apr 8
```

### sync — Cloud Sync (Cloudflare D1)

```bash
# D1 configuration
sincenety config --d1-account ACCOUNT_ID --d1-database DB_ID --d1-token TOKEN
sincenety config --machine-name "office-mac"

# Sync operations
sincenety sync --init          # Create D1 schema
sincenety sync                 # Push local → D1
sincenety sync --pull-config   # Pull shared config from D1
sincenety sync --status        # Check sync status
```

### Claude Code Skill (`/sincenety`)

Use `/sincenety` directly inside Claude Code sessions for AI-powered daily reports.

#### Installation

1. **Install the CLI** (provides the data collection engine):

```bash
npm install -g sincenety@latest
```

2. **Install the skill** (registers `/sincenety` command in Claude Code):

```bash
mkdir -p ~/.claude/skills/sincenety
cp node_modules/sincenety/src/skill/SKILL.md ~/.claude/skills/sincenety/SKILL.md
```

Or if installed globally:

```bash
mkdir -p ~/.claude/skills/sincenety
cp "$(npm root -g)/sincenety/src/skill/SKILL.md" ~/.claude/skills/sincenety/SKILL.md
```

3. **Update to latest version**:

Inside Claude Code, run:
```
! npm install -g sincenety@latest
```

#### How it works

When you type `/sincenety` inside Claude Code:

1. **Data collection** — `air` collects all sessions with checkpoint-based backfill
2. **JSON output** — `circle --json` outputs session data with conversation turns
3. **AI summary** — Claude Code itself analyzes and generates topic/outcome/flow/significance
4. **Save to DB** — `circle --save` writes summary to `daily_reports`
5. **Email** — If configured, sends an HTML email with AI summary

The key insight: Claude Code **is** the AI — no external API key needed.

#### Email setup (optional)

```bash
sincenety config --email you@gmail.com
sincenety config --smtp-user you@gmail.com
sincenety config --smtp-pass    # Prompts for Gmail app password
```

> Generate Gmail app password: https://myaccount.google.com/apppasswords

---

## Architecture

```
sincenety/
├── src/
│   ├── cli.ts                  # CLI entry (default + air/circle/out/outd/outw/outm/sync/config)
│   ├── postinstall.ts          # postinstall setup wizard (scope → D1 → email)
│   ├── core/
│   │   ├── air.ts              # Phase 1: date-based gathering (backfill + hash)
│   │   ├── circle.ts           # Phase 2: LLM summary pipeline (finalization + save)
│   │   ├── out.ts              # Phase 3: smart email dispatch (out/outd/outw/outm)
│   │   ├── gatherer.ts         # Core gathering logic (parse → group → store)
│   │   ├── summarizer.ts       # AI summarization router (Workers AI / Claude API / heuristic)
│   │   └── ai-provider.ts      # AI provider detection & routing (cloudflare/anthropic/claude-code)
│   ├── parser/
│   │   ├── history.ts          # ~/.claude/history.jsonl streaming parser
│   │   └── session-jsonl.ts    # Session JSONL parser (tokens/model/timing/turns)
│   ├── grouper/session.ts      # Session grouping by sessionId + project
│   ├── storage/
│   │   ├── adapter.ts          # StorageAdapter interface
│   │   └── sqljs-adapter.ts    # sql.js implementation (encrypted DB, v4 migration)
│   ├── encryption/
│   │   ├── key.ts              # PBKDF2 key derivation (machine-bound + passphrase)
│   │   └── crypto.ts           # AES-256-GCM encrypt/decrypt
│   ├── report/
│   │   ├── terminal.ts         # Terminal output formatter
│   │   └── markdown.ts         # Markdown report generator
│   ├── email/
│   │   ├── sender.ts           # nodemailer email sender
│   │   ├── renderer.ts         # HTML email renderer (report → HTML, cross-device merge)
│   │   ├── merge-sessions.ts   # Session merge by project (dedup same-project sessions)
│   │   ├── resend.ts           # Resend API email provider
│   │   ├── provider.ts         # Email provider abstraction (Gmail MCP/Resend/SMTP)
│   │   └── template.ts         # Bright color-coded HTML email template
│   ├── vacation/
│   │   ├── manager.ts          # Vacation CRUD (register/list/clear/check)
│   │   └── detector.ts         # Vacation keyword detection (KO+EN)
│   ├── config/
│   │   ├── setup-wizard.ts     # Interactive 3-choice setup wizard
│   │   └── scope.ts            # Scope config (global/project) read/write/prompt
│   ├── cloud/
│   │   ├── d1-client.ts        # Cloudflare D1 REST API client
│   │   ├── d1-schema.ts        # D1 schema definition & migration
│   │   ├── d1-auto-setup.ts    # Token-only auto-setup (account/DB detection)
│   │   ├── cf-ai.ts            # Cloudflare Workers AI client (Qwen3-30B)
│   │   └── sync.ts             # Sync logic (push/pull/status/init)
│   ├── util/
│   │   └── machine-id.ts       # Cross-platform hardware ID detection
│   ├── scheduler/install.ts    # launchd/cron auto-installer (disabled)
│   └── skill/SKILL.md          # Claude Code skill definition
├── tests/
│   ├── encryption.test.ts      # Encryption tests (26 cases)
│   ├── migration-v4.test.ts    # DB v3→v4 migration tests (7 cases)
│   ├── air.test.ts             # air command tests (7 cases)
│   ├── circle.test.ts          # circle command tests (39 cases)
│   ├── out.test.ts             # out command tests (47 cases)
│   ├── vacation.test.ts        # Vacation management tests (13 cases)
│   ├── d1-client.test.ts       # D1 client tests
│   ├── sync.test.ts            # Sync tests
│   ├── cf-ai.test.ts           # Cloudflare Workers AI tests
│   └── machine-id.test.ts      # Machine ID detection tests
├── package.json
└── tsconfig.json
```

### Install Flow

```
npm install -g sincenety@latest
        │
        ▼
┌─ postinstall.js ─────────────────────────────────┐
│                                                   │
│  TTY check ───→ No TTY? → "Run config --setup"   │
│       │                                           │
│       ▼ (TTY)                                     │
│  Already configured? ──→ Yes → "Updated. OK"      │
│       │                                           │
│       ▼ (No)                                      │
│                                                   │
│  Step 1: Scope                                    │
│  ┌────────────────────────┐                       │
│  │ 1) Global (all)        │                       │
│  │ 2) Project (path)      │                       │
│  └───────┬────────────────┘                       │
│          │ → ~/.sincenety/scope.json              │
│          ▼                                        │
│  Step 2: D1 Cloud Sync                            │
│  ┌────────────────────────┐                       │
│  │ D1 API token input     │                       │
│  │ → autoSetupD1()        │                       │
│  │ → ensureD1Schema()     │                       │
│  └───────┬────────────────┘                       │
│          │ → ~/.sincenety/sincenety.db            │
│          ▼                                        │
│  Step 3: Email                                    │
│  ┌────────────────────────┐                       │
│  │ 1) Gmail SMTP          │                       │
│  │ 2) Resend API          │                       │
│  │ 3) Custom SMTP         │                       │
│  └───────┬────────────────┘                       │
│          │ → ~/.sincenety/sincenety.db            │
│          ▼                                        │
│  ✅ Ready                                         │
└───────────────────────────────────────────────────┘
```

### Run Flow

```
$ sincenety [--token T --key K --email E]
        │
        ▼
   Scope check ───→ missing? → prompt (global/project)
        │
        ▼
   Param check ───→ missing D1/email? → show setup guide + exit
        │
        ▼
┌─ runOut(scope) ──────────────────────────────────┐
│                                                   │
│  ┌─ air ─────────────────────────────────────┐    │
│  │ ~/.claude/history.jsonl                   │    │
│  │   → session list (sessionId + project)    │    │
│  │ ~/.claude/projects/[p]/[id].jsonl         │    │
│  │   → tokens / model / timing / turns       │    │
│  │                                           │    │
│  │ scope filter (project mode)               │    │
│  │ date grouping (midnight boundary)         │    │
│  │ checkpoint backfill + data hash           │    │
│  │   → gather_reports DB                     │    │
│  └───────────────────────────────────────────┘    │
│                 │                                 │
│                 ▼                                 │
│  ┌─ circle ──────────────────────────────────┐    │
│  │ auto-finalization                         │    │
│  │   (yesterday / last week / last month)    │    │
│  │ D1 cross-device session pull + merge      │    │
│  │ Workers AI summary (Qwen3-30B)            │    │
│  │   → daily_reports DB (all devices)        │    │
│  └───────────────────────────────────────────┘    │
│                 │                                 │
│                 ▼                                 │
│  ┌─ D1 pre-sync ────────────────────────────┐     │
│  │ push local → D1 (my data first)          │     │
│  └──────────────────────────────────────────┘     │
│                 │                                 │
│                 ▼                                 │
│  ┌─ out (smart dispatch) ────────────────────┐    │
│  │ daily  — always                           │    │
│  │ weekly — Friday (or catchup)              │    │
│  │ monthly — month-end (or catchup)          │    │
│  │ --date yyyyMMdd — target specific date    │    │
│  │                                           │    │
│  │ D1 cross-device session pull + merge      │    │
│  │ Project-level session merge (×N)           │    │
│  │                                           │    │
│  │ → Gmail MCP / Resend /                    │    │
│  │   Gmail SMTP / Custom SMTP                │    │
│  └───────────────────────────────────────────┘    │
│                 │                                 │
│                 ▼                                 │
│  ┌─ D1 post-sync ───────────────────────────┐     │
│  │ push email logs → D1                     │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
└───────────────────────────────────────────────────┘
        │
        ▼
   ✅ sincenety complete — N sent, N skipped
```

### Encryption

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2 (SHA-256, 100,000 iterations)
- **Key source**: `hostname + username + random salt` (machine-bound)
- **Salt**: `~/.sincenety/sincenety.salt` (32-byte random, created once, mode 0600)
- **File format**: `[4B magic "SNCT"][12B IV][ciphertext][16B auth tag]`

### Local DB — Full Specification

**File**: `~/.sincenety/sincenety.db` (AES-256-GCM encrypted blob, file mode `0600`, dir mode `0700`)
**Engine**: `sql.js` — WASM-compiled SQLite, zero native dependencies. The entire DB file is decrypted into memory on open, mutated in-place, re-encrypted on close. There is no incremental `INSERT` to disk — every run rewrites the whole encrypted blob.
**Sidecar**: `~/.sincenety/sincenety.salt` — 32-byte cryptographically random salt, generated **once** on first run, used in PBKDF2 key derivation. If this file is deleted, the DB becomes permanently unreadable.
**Opening the DB**: `file ~/.sincenety/sincenety.db` should report `data` (opaque). If it says `SQLite 3.x database`, encryption is broken and the DB has leaked plaintext.

#### Why we keep the local DB (design rationale)

The local DB is a **derived artifact** — the source of truth is always `~/.claude/history.jsonl` + `~/.claude/projects/*.jsonl`. In principle everything could be reconstructed from those on every run. We keep the local DB anyway because it serves three jobs that pure file reconstruction cannot do cleanly:

1. **Idempotency boundary** — `sincenety` is designed to be run multiple times per day (cron at 10:00, manual at 15:00, auto at end-of-day). The composite PK `(session_id, project)` on `sessions` and the `UNIQUE(report_date, report_type)` on `daily_reports` make every run safely re-runnable. Without the DB, either (a) each run produces a duplicate report row/email or (b) a bespoke dedupe index must be maintained on disk — which is just "a DB, worse".

2. **Send-state authority** — `daily_reports.emailed_at` is the single source of truth for "was this report already delivered?" The guard `if (existing && existing.emailedAt != null) return false` in `autoSummarizeWeekly` / `autoSummarizeMonthly` (circle.ts) is what prevents the weekly/monthly baseline auto-generator from overwriting a row that has already gone out by email. `email_logs` is the append-only audit trail: every successful and failed send lands there with subject, recipient, provider, and error message.

3. **Cross-device merge pivot** — `sync push` (pre-send) uploads this machine's `daily_reports` rows to Cloudflare D1; `sync pull` downloads rows authored by other machines. The merge in the email renderer joins local rows with pulled rows by `(report_date, project_name)` and dedupes sessions by `(project_name, title_normalized)`. Without a local DB, there is no "this machine's view" to push, and no stable pivot to merge remote rows into.

**Not kept in the DB** (conscious choices): full conversation text, code content, tool call payloads. Only metadata (counts, timings, tokens, titles, descriptions, short summaries) is persisted, limiting blast radius if the key derivation ever leaks.

**When the local DB is genuinely redundant**: a single-machine user who never emails, never syncs, and only reads `--json` stdout to pipe into Claude Code directly. For that user the DB adds cost without benefit. For everyone else (multi-device, scheduled delivery, week/month rollups), removing the DB would require rebuilding the three jobs above from scratch.

#### Storage file layout

```
~/.sincenety/
├── sincenety.db       # encrypted SQLite blob (this document)
├── sincenety.salt     # 32-byte PBKDF2 salt (0600)
└── machine-id         # stable machine identifier for D1 row attribution
```

#### Encryption envelope

```
[4B magic "SNCT"] [12B IV] [ciphertext (variable)] [16B GCM auth tag]
```

- **Algorithm**: AES-256-GCM (AEAD — ciphertext tampering is detected on decrypt)
- **Key derivation**: PBKDF2-SHA256, **100,000 iterations**, 32-byte output
- **Key material**: `hostname ∥ username ∥ salt` by default (machine-bound), or a user-supplied passphrase
- **IV**: 12 random bytes per encrypt, never reused for the same key
- **Auth tag**: 16 bytes, verified on every decrypt — tampering throws, does **not** silently fallback to empty DB

#### Schema version — v4 (current)

Schema version is stored in `config.value` under key `schema_version`. On open, `applySchema()` reads the current version and runs forward-only migrations:

| From → To | Migration summary |
|-----------|-------------------|
| `v1 → v2` | `ALTER TABLE sessions ADD COLUMN` × 14 (tokens, timing breakdown, title, description, category, tags, model). Adds `gather_reports` and `config` tables. |
| `v2 → v3` | Creates `daily_reports` table (AI summaries with `UNIQUE(report_date, report_type)`). |
| `v3 → v4` | `gather_reports` gains `report_date`, `data_hash`, `updated_at`; `daily_reports` gains `status`, `progress_label`, `data_hash`; creates `vacations` and `email_logs` tables; adds `idx_gather_report_date` unique index. |

Migrations use `ALTER TABLE ADD COLUMN` (never `DROP`) to keep downgrade-from-newer safe. Invalid or unknown `schema_version` values are treated as "fresh install" — the DB is rebuilt from v1 forward.

#### Tables — per-column specification

##### `sessions` (22 columns) — the core per-work-session record

Composite primary key `(id, project)`. One row per Claude Code session (one `sessionId` on one project directory). Upserted every gather run.

| Column | Type | Role |
|--------|------|------|
| `id` | TEXT NOT NULL | Claude Code `sessionId` (UUID from `~/.claude/sessions/<id>.json`) |
| `project` | TEXT NOT NULL | Absolute project path (the `cwd` at session start) |
| `project_name` | TEXT NOT NULL | `basename(project)` — for display and same-project merging |
| `started_at` | INTEGER NOT NULL | Unix epoch ms — first message timestamp in the session |
| `ended_at` | INTEGER NOT NULL | Unix epoch ms — last message timestamp |
| `duration_minutes` | REAL DEFAULT 0 | `(ended_at - started_at) / 60000`, precomputed for report queries |
| `message_count` | INTEGER NOT NULL DEFAULT 0 | Total message count (user + assistant + tool) |
| `user_message_count` | INTEGER DEFAULT 0 | User-authored messages only |
| `assistant_message_count` | INTEGER DEFAULT 0 | Assistant responses only |
| `tool_call_count` | INTEGER DEFAULT 0 | Number of tool invocations (Read, Edit, Bash, …) |
| `input_tokens` | INTEGER DEFAULT 0 | Sum across session |
| `output_tokens` | INTEGER DEFAULT 0 | Sum across session |
| `cache_creation_tokens` | INTEGER DEFAULT 0 | Prompt-cache writes |
| `cache_read_tokens` | INTEGER DEFAULT 0 | Prompt-cache hits |
| `total_tokens` | INTEGER DEFAULT 0 | Denormalized sum of the four above — used directly in report aggregation |
| `title` | TEXT | AI-generated or heuristic session title (≤80 chars) |
| `summary` | TEXT | Short session summary (1–2 sentences) |
| `description` | TEXT | Longer description of what happened in this session |
| `category` | TEXT | Optional classification (feat/fix/docs/refactor/chore) |
| `tags` | TEXT | Comma-separated keyword tags |
| `model` | TEXT | Dominant model used (e.g. `claude-opus-4-6`, `claude-sonnet-4-6`) |
| `created_at` | INTEGER NOT NULL | DB row creation ms — not session time |

**Indexes**: `idx_sessions_started` (`started_at`), `idx_sessions_project` (`project`), `idx_sessions_category` (`category`).

**Write path**: `gatherer.ts` → UPSERT per session via `INSERT … ON CONFLICT(id, project) DO UPDATE`. Token counters are **overwritten** (not summed) — the source JSONL is canonical.

##### `gather_reports` (raw run log)

Captures the raw markdown + JSON output of a `sincenety` gather run. Not strictly required for operation — kept as an audit trail and for `--json` reproducibility.

| Column | Type | Role |
|--------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | Surrogate key |
| `gathered_at` | INTEGER NOT NULL | Run timestamp (ms) |
| `from_timestamp` | INTEGER NOT NULL | Start of gather window |
| `to_timestamp` | INTEGER NOT NULL | End of gather window |
| `session_count` | INTEGER DEFAULT 0 | Sessions in this run |
| `total_messages` | INTEGER DEFAULT 0 | Aggregate message count |
| `total_input_tokens` | INTEGER DEFAULT 0 | |
| `total_output_tokens` | INTEGER DEFAULT 0 | |
| `report_markdown` | TEXT | Rendered terminal/markdown report |
| `report_json` | TEXT | Structured JSON for downstream `save-daily` |
| `emailed_at` | INTEGER | Deprecated — superseded by `daily_reports.emailed_at` |
| `email_to` | TEXT | Deprecated |
| `report_date` | TEXT *(v4)* | `YYYY-MM-DD` of the gather window start — used by unique index |
| `data_hash` | TEXT *(v4)* | Content hash of `report_json`; unchanged input → same hash → no-op rewrite |
| `updated_at` | INTEGER *(v4)* | Last modification ms |

**Unique index** `idx_gather_report_date` on `(report_date)` *(v4)* — one raw gather report per calendar day; reruns update the same row.

##### `daily_reports` (AI-summarized reports — daily/weekly/monthly)

The authoritative source for what gets emailed and what cross-device sync exchanges. One row per `(report_date, report_type)`.

| Column | Type | Role |
|--------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `report_date` | TEXT NOT NULL | `YYYY-MM-DD` anchor (for weekly/monthly: Monday / 1st of month) |
| `report_type` | TEXT NOT NULL DEFAULT `'daily'` | One of `daily` / `weekly` / `monthly` |
| `period_from` | INTEGER NOT NULL | Window start (ms) |
| `period_to` | INTEGER NOT NULL | Window end (ms) |
| `session_count` | INTEGER DEFAULT 0 | Aggregated session count in window |
| `total_messages` | INTEGER DEFAULT 0 | Aggregated |
| `total_tokens` | INTEGER DEFAULT 0 | Aggregated |
| `summary_json` | TEXT NOT NULL | Serialized array of per-session `SummaryEntry` objects (title, overview, actions, tokens, project_name, …). The email renderer reads this field. |
| `overview` | TEXT | Day-level / week-level / month-level meta-summary (2–4 sentences) |
| `report_markdown` | TEXT | Pre-rendered markdown for CLI `report` command |
| `created_at` | INTEGER NOT NULL | Row creation ms |
| `emailed_at` | INTEGER | **Null-checked** (`!= null`) to decide overwrite eligibility. A non-null value means this report has been delivered and must not be overwritten by auto-summary. |
| `email_to` | TEXT | Recipient email address for the delivered report |
| `status` | TEXT DEFAULT `'in_progress'` *(v4)* | `in_progress` while the window is still open, `finalized` when the period is fully closed (previous day / previous week / previous month). `finalizePreviousReports` flips the state. |
| `progress_label` | TEXT *(v4)* | Human-readable state label (e.g. "5/7 days of week") |
| `data_hash` | TEXT *(v4)* | Content hash for change detection — D1 sync skips pushes whose hash matches the remote row |

**Constraint**: `UNIQUE(report_date, report_type)` — the core idempotency guarantee.
**Indexes**: `idx_daily_date`, `idx_daily_type`.

##### `checkpoints`

Records the last processed timestamp per gather run. In practice deprecated because gathering always goes from today 00:00 forward (not incremental from last checkpoint), but kept for historical compatibility and potential future "incremental since N" mode.

| Column | Type | Role |
|--------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `timestamp` | INTEGER NOT NULL | Last processed ms |
| `created_at` | INTEGER NOT NULL | |

##### `config` (key-value store)

| Column | Type | Role |
|--------|------|------|
| `key` | TEXT PK | Setting name |
| `value` | TEXT NOT NULL | String value (JSON-encoded when needed) |
| `updated_at` | INTEGER NOT NULL | |

Known keys: `schema_version`, `email_to`, `smtp_user`, `smtp_pass`, `smtp_host`, `smtp_port`, `resend_key`, `d1_api_token`, `d1_account_id`, `d1_database_id`, `cf_ai_token`, `provider`, `pipeline_mode` (`smart` | `full`), `scope` (`global` | `project`).

##### `vacations`

| Column | Type | Role |
|--------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `date` | TEXT NOT NULL UNIQUE | `YYYY-MM-DD` |
| `type` | TEXT NOT NULL DEFAULT `'vacation'` | `vacation` / `holiday` / `sick` |
| `source` | TEXT NOT NULL DEFAULT `'manual'` | `manual` / `auto` (keyword-detected from session content) |
| `label` | TEXT | Display label (e.g. "설 연휴") |
| `created_at` | INTEGER NOT NULL | |

On vacation days, `out` short-circuits delivery (no email sent). The `UNIQUE` on `date` prevents double-marking.

##### `email_logs`

Append-only audit of every email delivery attempt. Never deleted; grows unbounded (manual truncation if needed).

| Column | Type | Role |
|--------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `sent_at` | INTEGER NOT NULL | Attempt ms |
| `report_type` | TEXT NOT NULL | `daily` / `weekly` / `monthly` |
| `report_date` | TEXT NOT NULL | `YYYY-MM-DD` of the report |
| `period_from` | TEXT NOT NULL | Window start (ISO date) |
| `period_to` | TEXT NOT NULL | Window end (ISO date) |
| `recipient` | TEXT NOT NULL | Delivered-to address |
| `subject` | TEXT NOT NULL | Rendered subject line |
| `body_html` | TEXT | Rendered HTML (nullable for failed sends) |
| `body_text` | TEXT | Plain-text fallback body |
| `provider` | TEXT NOT NULL | `gmail-smtp` / `resend` / `gmail-mcp` |
| `status` | TEXT NOT NULL DEFAULT `'sent'` | `sent` / `failed` |
| `error_message` | TEXT | Error detail when `status = 'failed'` |

**Indexes**: `idx_email_logs_sent` (`sent_at`), `idx_email_logs_report` (`report_date, report_type`).

#### Read path (what the DB is actually used for)

| Command | Tables read | Purpose |
|---------|-------------|---------|
| `sincenety` (default) | `sessions`, `daily_reports`, `vacations`, `email_logs`, `config` | Full pipeline — gather → summarize → render → send |
| `air` | `sessions`, `gather_reports` | Phase 1 only — collect & store |
| `circle` | `sessions`, `daily_reports` | Phase 2 only — AI summarize + finalize |
| `out` / `outd` / `outw` / `outm` | `daily_reports`, `email_logs`, `vacations`, `config` | Phase 3 only — smart email send |
| `report --date` / `--week` / `--month` | `daily_reports` | Render stored summary to terminal |
| `sync push` | `daily_reports`, `config` | Upload own rows to D1 |
| `sync pull` | `daily_reports`, `config` | Download other machines' rows, merge |
| `config` | `config` | Show/edit settings |
| `vacation` | `vacations` | CRUD vacation days |

**What is not supported (known gaps)**: full-text search over `sessions.title/description`, project-level aggregation view, timeline/heatmap queries. These are eligible candidates for future work — the data is already persisted, only read paths are missing.

#### Backup & recovery

- **Not a backup target** — the DB is derived from `~/.claude/`. If lost, rerun `sincenety --since "2026-04-01"` to rebuild from source.
- **Exception**: `daily_reports.summary_json` (AI summaries) and `email_logs` are **not** reconstructible from `~/.claude/` alone — they require re-running the LLM summarization, which costs tokens. These two tables are the only meaningful backup targets. Cloud sync to Cloudflare D1 serves as remote backup for `daily_reports`.
- **Disaster recovery**: delete `sincenety.db` + `sincenety.salt`, reinstall, rerun. Historical email_logs and pre-LLM summaries are lost; session metadata is rebuilt from `~/.claude/`.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript (ESM, Node16 modules) |
| Runtime | Node.js >= 18 |
| CLI | commander |
| DB | sql.js (WASM SQLite, zero native deps) |
| Encryption | Node.js built-in crypto (AES-256-GCM) |
| Email | nodemailer (Gmail SMTP), Resend API |
| Cloud | Cloudflare D1 REST API (native fetch, zero extra deps) |
| AI Summarization | Cloudflare Workers AI (Qwen3-30B), zero extra deps |
| Tests | vitest (128 cases across 11 test files) |

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (dist/)
npm run dev          # Run with tsx (dev mode)
npm test             # Run vitest tests (171 cases)
node dist/cli.js     # Direct execution
```

---

## Changelog

### v0.8.6 (2026-04-16) — Heuristic summary fallback removed + AI-required pipeline guard + prompt hardening

#### Highlights

- **Heuristic summary fallback completely removed.** The `summarizeHeuristic` function in `src/core/summarizer.ts` (the regex-based "extract sentences from input/output and concatenate them") is **deleted**. It was the root cause of the long-standing complaint that "AI summary doesn't run; the output looks like my input text rewritten." The heuristic was a silent fallback that ran whenever the AI provider was unavailable, producing summaries that mirrored the user's prompt text instead of actual work performed.
- **Pipeline-wide AI-required guard.** A new `assertAiReadyForCliPipeline()` guard runs at the entry of `runCircle` (and again at `autoSummarize`). If `ai_provider` is not `cloudflare` or `anthropic` with valid credentials, the entire `sincenety` process aborts immediately with a clear remediation message and `process.exit(1)` (cron-detectable). **No email is sent, no false summary is written.**
- **`ai_provider=claude-code` is now CLI-forbidden.** This provider value is only valid inside the `/sincenety` slash command (where Claude Code itself produces the summary externally and saves it via `circle --save`). Running `sincenety` from a CLI/cron context with this provider now throws with a message explaining the constraint.
- **Prompt hardening for both AI paths.** Cloudflare Workers AI and Anthropic prompts now strictly forbid echoing user prompt text into the summary. The prompt structure separates "user intent (context only)" from "assistant action/artifact (summary target)", and instructs the model to write in 3rd-person observer voice focused on what was produced/changed/decided.

#### Root cause of "AI summary not running" symptom

Before v0.8.6, `src/core/summarizer.ts:279` had a switch that handled `cloudflare` and `anthropic` providers but **fell through to the heuristic branch** for `claude-code` and unset providers. Combined with `summarizer.ts:141`'s `catch {}` silently swallowing all Anthropic API errors, any failure mode (wrong provider config, network error, auth failure) would silently degrade to the regex-based input-text echo. From the user's perspective: "I configured AI but the email looks like my input was just reformatted." That was literally what happened — the regex just sliced first sentences out of `userInput` and joined them with arrows.

A second contamination path: `src/core/gatherer.ts` was also calling `summarizeSessions` on every gather to fill in session titles, even though the real summary happens later in `autoSummarize`. That call is now removed.

#### Core changes

- **`src/core/summarizer.ts`**:
  - **Deleted**: `summarizeHeuristic()` function (~90 lines of regex extraction logic).
  - **New**: `AiUnavailableError` exception class for callers to catch and abort.
  - **`summarizeSession()`** now returns `Promise<SessionSummary>` (non-nullable) and throws on any failure.
  - **Removed silent `catch {}`** in `summarizeWithClaude` — Anthropic SDK errors now propagate (auth, rate limit, network). Same for empty-response and JSON-parse failures.
  - **`claude-code` provider explicitly throws** with message indicating slash-command-only usage.
  - **Heuristic / unset provider explicitly throws** with remediation hint.
  - Prompt restructured: turn format is `[턴 N] 사용자 의도(맥락): ... / 어시스턴트 수행/산출물: ...` — separating intent from action. Output rules forbid quoting user utterances and require 3rd-person voice.

- **`src/core/ai-provider.ts`**:
  - **New**: `assertAiReadyForCliPipeline(storage)` — single source of truth for the pipeline-entry check. Cleanly rejects `claude-code` (CLI context), `heuristic` (no provider), and `cloudflare`/`anthropic` without credentials.

- **`src/core/circle.ts:autoSummarize`**:
  - Calls the guard at the top — throws before any DB read if AI is not ready.
  - Per-session AI failure is no longer swallowed by the per-date `try/catch`. The catch block was removed; AI failures propagate up to the caller, aborting the whole `autoSummarize` call. **Partial summaries are never written to `daily_reports`.**
  - Cloudflare `cfSummarize` returning null is now treated as failure → throw (was: silent skip).
  - The cross-device D1 pull `try/catch` is preserved (network flakiness is expected and orthogonal to summary correctness), but its silent `catch` blocks now log warnings with the actual error message.

- **`src/core/circle.ts:runCircle`**:
  - Calls `assertAiReadyForCliPipeline(storage)` immediately before invoking `autoSummarize` (only on the CLI path — `--json`/`--save`/`--skipAutoSummarize` paths bypass since they're for the slash-command flow).

- **`src/core/gatherer.ts`**:
  - **Removed** the `summarizeSessions` call. `gather_reports` rows now contain only raw session metadata (title from `s.title ?? s.summary` with stripped XML tags). The `wrapUp` field on the gather report is removed since it was filled by the heuristic. AI-generated wrapUp lives only in `daily_reports.summary_json` going forward.

- **`src/cloud/cf-ai.ts`**:
  - Prompt rewrite mirrors `summarizer.ts`: turn format separates intent/action, system prompt enumerates 5 strict output rules (no user-quote, 3rd-person, integrate intent+artifact, ignore filler responses, JSON only).
  - **Silent `catch { return null }` removed** — HTTP errors, missing content, and JSON parse failures all throw with descriptive messages so `circle.autoSummarize` can abort the pipeline.

#### Test changes

- **`tests/cf-ai.test.ts`**: "should handle API errors gracefully" test renamed and rewritten — now asserts `rejects.toThrow(/Workers AI HTTP 401/)` instead of `expect(result).toBeNull()`. Reflects the new contract: silent null returns are forbidden.
- **`tests/circle.test.ts`**: 4 `runCircle — summaryErrors propagation` tests now seed `ai_provider=cloudflare` + dummy D1 credentials so they pass the guard. 2 new tests added:
  - `runCircle throws when AI provider is unconfigured (full pipeline halt)`
  - `claude-code provider throws on CLI path with slash-command guidance`
- **173/173 tests passing** (was 171 → +2 guard tests, no removals).

#### Verification

1. **Reproduction of the user's symptom** (forensic): inspecting `daily_reports` for 2026-04-14 showed `topic = "오늘 cli 환경에서 실행한거 skip 되었던데, 내 홈 위치 실행했어(~/), 왜 sk…"` and `flow = "오늘 cli 환경에서 실행한거 skip 되었던데, 내… → cli 에서 어제 날짜기준 정리하려면 어떻게 명령어 …"` — verbatim user prompt text echoed by the heuristic. Confirmed root cause.
2. **Cloudflare AI smoke test** (isolated): direct `summarizeSession` call with the exact "echoed" user input now produces `topic: "skill 자동 호출 문제 해결"` and `outcome` describing the actual code changes (file paths, version bump, install logic) in 3rd person. Zero user-prompt characters appear in the output.
3. **Guard test** (isolated): `summarizeSession` with `ai_provider=claude-code` throws `AiUnavailableError` with the slash-command hint as expected.
4. **End-to-end CLI test**: `node dist/cli.js out` with `ai_provider=claude-code` (the bad config) now prints the clear Korean error message, sends 0 emails, exits with code 1 (verified directly).
5. **Forced regeneration of historical rows**: 2026-04-14 (6 sessions, 5 after merge) and 2026-04-15 (1 session) regenerated through `autoSummarize`. All session topics/flows are now action-noun phrases with no user-prompt content; overviews integrate the day's work coherently.

#### Migration impact

- **Users with `ai_provider=claude-code`** who run `sincenety` from cron/CLI (not via the slash command): the cron will start failing with exit 1 and a clear message. Switch via `sincenety config --ai-provider cloudflare` (uses existing D1 token) or `sincenety config --ai-provider anthropic` + set `ANTHROPIC_API_KEY`.
- **Users with no AI configured**: same — the pipeline now refuses to run rather than emailing useless heuristic output. Configure cloudflare or anthropic.
- **Existing `daily_reports` rows generated by the heuristic** are not auto-corrected (their `emailedAt != null` guard still protects them from overwrite). To regenerate manually: clear `summaryJson` and `emailedAt` on the affected row, then re-run `circle` or call `autoSummarize` directly.

---

### v0.8.5 (2026-04-15) — Auto-install Claude Code skill on `npm install -g`

#### Highlights

- **Fixes "`/sincenety` not listed on other machines"**: Before v0.8.5, `npm install -g sincenety` only installed the CLI binary — the Claude Code skill at `~/.claude/skills/sincenety/SKILL.md` was never created, so the slash command did not show up after install on a fresh machine. The skill only existed on the original development machine where it had been placed manually.
- **Root cause (two bugs compounded)**:
  1. `package.json` `files` whitelist contained only `["dist"]` — `src/skill/SKILL.md` was **not included in the npm tarball** at all, so postinstall had nothing to copy even if it had wanted to.
  2. `src/postinstall.ts` had **no skill-copy logic** whatsoever (verified by grep — zero matches for `skill|SKILL|.claude`). The existing postinstall was a setup wizard for D1/SMTP that early-returned with a one-line message on non-TTY environments, and did nothing at all regarding Claude Code skill registration on any environment.

#### Core changes

- **`package.json` `files`**: `["dist", "src/skill/SKILL.md"]` — ships the skill definition inside the published npm tarball so consumers receive it.
- **`src/postinstall.ts` `installSkill()`** (new function): Resolves the packaged `SKILL.md` via `import.meta.url` (checks two candidate paths to cover both the npm-published layout `<pkgRoot>/src/skill/SKILL.md` relative to `dist/postinstall.js`, and the local dev layout), creates `~/.claude/skills/sincenety/` with `mkdirSync({recursive: true})`, and copies the file via `copyFileSync`. Wrapped in try/catch so any failure prints a warning but never aborts the CLI install itself.
- **Call site**: `installSkill()` is invoked at the very top of `main()` — **before** the TTY check. This is important: the prior postinstall early-returned on non-TTY, which would have skipped skill registration on CI/Docker/non-interactive installs. Skill installation must happen unconditionally since it has no user input dependency.

#### Verification

- Non-TTY dry run: `node -e "process.stdin.isTTY=false; import('./dist/postinstall.js')"` prints `✓ Claude Code skill installed: /Users/.../SKILL.md` and the file is present with a readable size (10,444 bytes on the test machine).
- TypeScript build clean (`tsc` — zero output).
- Existing tests unaffected (no logic change to gatherer/summarizer/render paths).

#### Migration note

Users upgrading from v0.8.4 on the original dev machine will get the skill file overwritten (identical content). On fresh machines where `/sincenety` was missing, the command will appear in Claude Code after a restart.

---

### v0.8.4 (2026-04-11) — Pipeline mode switch + auto weekly/monthly baseline + silent failure hardening

#### Highlights

- **Auto weekly/monthly baseline generation**: `out`/`outd`/`outw`/`outm` now regenerate this week's weekly and this month's monthly row on every run. Closes the gap where `outw`/`outm` previously produced empty results when weekly/monthly rows didn't exist in the DB (only daily_reports had rows). Already-sent reports (`emailedAt != null`) are protected from overwrite.
- **`--mode=full|smart` pipeline switch**: New CLI flag and `config --pipeline-mode` setting. `full` (default) regenerates weekly/monthly baselines on every run; `smart` preserves v0.8.3 behavior (token-saving, weekday trigger only — weekly on Friday, monthly on month-end). The resolved mode is CLI option > config value > default `full`.
- **Silent failure hardening**: Several paths that previously swallowed errors now surface them through structured error channels, visible in CLI exit codes for cron monitoring.

#### Core changes

- **`autoSummarizeWeekly` / `autoSummarizeMonthly`** (`src/core/circle.ts`): Gather this week's (Mon–Sun) or this month's (1st–last day) `daily_reports`, flatten their `summaryJson` sessions, run `mergeSummariesByTitle` for project-level consolidation, and upsert the weekly/monthly row. Both functions share a private helper `summarizeRangeInto` that handles the aggregation, period boundary computation, and upsert logic.
- **`PipelineMode` type centralization** (`src/core/out.ts`): Single source of truth — exports `PIPELINE_MODES` constant array, `PipelineMode` literal union type, `isPipelineMode()` runtime type guard, and `PIPELINE_MODE_CONFIG_KEY` constant. Replaces 4 copies of inline `"smart" | "full"` literals previously scattered across `out.ts`, `circle.ts`, and `cli.ts`.
- **`resolvePipelineMode()`**: Pure precedence function — explicit option > config value > default `"full"`. Invalid `configured` values (e.g., typo, old version data) silently fall back to `"full"` — validated by `config --pipeline-mode` on write.
- **`CircleResult.summaryErrors`**: New field capturing per-type auto-summary failures as `{type: "weekly" | "monthly"; error: string}[]`.
- **`collectUnrecordedSummaryErrors()`**: Pure helper in `out.ts` that promotes `circleResult.summaryErrors` to `OutResultEntry` error entries, deduplicating against existing render-loop entries.
- **`runOut` restructuring**: Collects orphan `summaryErrors` as global error entries **immediately after `runCircle`** (before vacation/force/reportTypes branching) — so failures surface even when `out` exits via the vacation early return or when the failed type is not in `reportTypes`.
- **CLI exit code propagation**: `out`/`outd`/`outw`/`outm` now set `process.exitCode = 1` when `result.errors > 0`. Uses `exitCode` (not `process.exit(1)`) so the `finally` block still runs `storage.close()` for sql.js WASM DB flush safety.

#### Bug fixes

- **`config --pipeline-mode smrt` silently exited 0**: The validation path used `console.log` + fall-through without setting a non-zero exit code — automation couldn't detect typos. Now uses `console.error` + `process.exit(1)` consistent with `out --mode` validation elsewhere.
- **`emailedAt === 0` falsy guard** (`src/core/circle.ts`): The existing guard `if (existing?.emailedAt) return false` would classify `emailedAt === 0` as "not emailed" (falsy) and allow overwriting an already-sent report. `Date.now()` can never return 0, but manual DB inserts or buggy write paths could produce this value. Replaced with explicit null check: `if (existing && existing.emailedAt != null) return false`.
- **JSON.parse silent drop**: `summarizeRangeInto`'s `try { JSON.parse(...) } catch {}` swallowed all exceptions without any log — a corrupted daily row would cause that day's sessions to silently vanish from the weekly/monthly aggregate, undercounting totals. Now narrows to `SyntaxError`, emits `console.warn` with the failing `reportDate`, and re-throws other error classes (e.g., `TypeError` from unexpected shapes).
- **Dead `"finalized"` branch removed**: `summarizeRangeInto` had a `status = todayTs <= periodTo ? "in_progress" : "finalized"` line, but both callers (`autoSummarizeWeekly`, `autoSummarizeMonthly`) derive the range from `today` — so `today` is structurally always within `[rangeFrom, rangeTo]` and the `"finalized"` branch was unreachable. Hardcoded to `"in_progress"`; the period-end transition remains handled by `finalizePreviousReports` as before.

#### Test improvements

**171 tests passing** (baseline 151 → +20 new tests). All new tests follow TDD red → green.

- **`autoSummarizeWeekly` / `autoSummarizeMonthly`** — 8 tests: creates row from this week's/month's dailies, status is `in_progress`, no-data skip, upsert unemailed row, protects emailed row with full snapshot comparison (8 fields: `summaryJson`, `overview`, `sessionCount`, `totalMessages`, `totalTokens`, `emailedAt`, `emailTo`, `createdAt`), `emailedAt === 0` falsy guard.
- **`summarizeRangeInto` JSON corruption** — 3 tests: malformed JSON warns with `reportDate` and continues with other dailies, non-array JSON (e.g., `"null"`, `"{}"`) is skipped, empty `summaryJson` string is skipped.
- **Boundary cases** — 5 tests: Sunday as today (exercises `getWeekBoundary` Sunday-specific branch), Monday as today, December→January month rollover, February 2028 leap year (includes Feb 29), February 2027 non-leap (excludes Mar 1).
- **`runCircle` summaryErrors propagation** — 4 tests using a Proxy-wrapped throwing `StorageAdapter`: weekly failure recorded without aborting monthly, monthly failure recorded independently, smart mode skips weekly/monthly entirely (no errors even when would fail), healthy storage returns empty `summaryErrors`.
- **`resolvePipelineMode`** — 7 tests: defaults to `full`, explicit option override, config fallback, invalid values fall back to `full`.
- **`collectUnrecordedSummaryErrors`** — 7 tests: empty input, promotes weekly/monthly to error entries, deduplication against existing entries, multiple failures, error message format embeds type label.
- **"Preserves emailed" tests strengthened**: previously asserted only `projectName === "sent"` and `emailedAt` preservation (a false-confidence test that would pass even if aggregation ran). Now captures a full before-snapshot and asserts all 8 fields unchanged after, including a sentinel daily with totals that would change the aggregate if overwrite occurred.
- **Manual fault injection smoke tests**: `runOut` against a throwing storage Proxy confirmed Gap B fix — weekly failure on a vacation day now reports `result.errors = 1` and exit 1, and a `force: weekly` run with a failing monthly auto-summary correctly records the orphaned monthly error.

#### Documentation

- **SKILL.md — new "파이프라인 모드 (v0.8.4+)" section**: explains `full`/`smart` modes and the `emailedAt != null` protection rule.
- **SKILL.md — "주간/월간 보고 고품질 재요약" workflow**: replaces the old "워크플로우: 주간/월간 보고 생성" section with a 4-step flow — (1) baseline auto-generation via `out`, (2) analysis via `circle --json`, (3) re-summary via `circle --save --type weekly|monthly`, (4) delivery via `outw`/`outm`.

#### Files changed

`src/cli.ts` (+54), `src/core/circle.ts` (+203), `src/core/out.ts` (+109), `src/skill/SKILL.md` (+54), `tests/circle.test.ts` (+625), `tests/out.test.ts` (+110). Total ~1143 insertions / ~12 deletions across 6 files.

### v0.8.3 (2026-04-09) — Project-level session consolidation

- **Simplified session consolidation**: Changed merging logic from "same title within project" (`projectName::normalizedTitle`) to "all sessions per project" (`projectName` only). Final result = one entry per project, regardless of session titles
- **circle.ts**: `mergeSummariesByTitle()` grouping key changed from `projectName::normalizedTitle` to `projectName`
- **merge-sessions.ts**: `mergeSessionsByTopic()` grouping key changed from `projectName::normalizedTitle` to `projectName`
- **SKILL.md updated (both copies)**: Removed the old 2-pass mergeGroup consolidation and 3-pass project consolidation. Replaced with a single 2-pass that groups by `projectName` directly
- **`--summarize` path**: Also updated to perform the same project-level consolidation
- **Tests**: Updated to expect same-project sessions to merge even with different topics

### v0.8.2 (2026-04-09) — Circle same-title session merge summaries

- **Same-title session merge in circle**: When multiple sessions share the same `projectName + normalizedTitle` within a date, circle now merges their individual summaries into a single consolidated summary. Each session is summarized individually first, then sessions in the same group are re-summarized together — outcome fields are joined, flows are concatenated with `→`, the longest significance is kept, and nextSteps comes from the last session. Merged entries show `(×N)` in the topic
- **Applied to both summary paths**: The merge runs in `autoSummarize` (CLI auto-summary via Cloudflare AI / heuristic) and in the SKILL.md flow (Claude Code direct summary via `mergeGroup` hint in `circle --json` output)
- **`mergeGroup` field in circleJson output**: Each session in `circle --json` output now includes a `mergeGroup` field (`projectName::normalizedTitle`) so Claude Code can identify merge-eligible sessions during SKILL.md step 2
- **SKILL.md updated**: Step 2 now includes a "통합 재요약" (consolidated re-summary) phase — after individual session analysis, sessions sharing a `mergeGroup` are merged before overview generation
- **New function**: `mergeSummariesByTitle()` in `circle.ts` — groups by `projectName + normalizeTitle(topic)`, merges stats (messageCount, tokens, duration), and consolidates summary fields
- **Tests**: 135/135 passing (11 test files, +7 new tests for mergeSummariesByTitle)

### v0.8.1 (2026-04-09) — Circle cross-device merge + always-send policy

- **Circle cross-device merge**: `autoSummarize` in `circle.ts` now pulls other devices' already-summarized sessions from D1 via `pullCrossDeviceReports`, deduplicates by `sessionId`, and generates a unified overview covering all machines — not just local work. Previously, circle only summarized local sessions; cross-device data was only used at email render time in `out`
- **Always-send policy**: Removed cross-device email dedup check from `out.ts` — `out` now always sends email regardless of whether another device already sent for the same date+type. The previous behavior (`checkCrossDeviceEmailSent` → skip) blocked email delivery when another device had already run `sincenety`
- **Architecture alignment**: The 3-phase pipeline now follows a clear separation — `air` collects per-device, `circle` summarizes all-devices, `out` always delivers
- **Files changed**: `src/core/circle.ts` (D1 pull + merge in `autoSummarize`), `src/core/out.ts` (removed dedup skip block)
- **Tests**: 128/128 passing (11 test files)

### v0.8.0 (2026-04-09) — Cross-device consolidated reports + session merge

- **Cross-device consolidated reports**: When working on multiple machines, `out` now pushes local data to D1 first (pre-sync), then queries D1 for other devices' sessions. Sessions from all machines are merged into a single consolidated email report
- **Session merge by project**: Sessions within the same `projectName` within a date are automatically merged in email reports — stats (messages, tokens, duration) are aggregated, the most detailed wrapUp is selected, flow narratives are concatenated with `→` separator. Merged sessions show `(×N)` count in the title
- **Title extraction improvement**: Sessions starting with slash commands (e.g., `/sincenety`) now prefer meaningful messages (>5 chars) for titles; if none exist, falls back to `[projectName] session` instead of empty strings
- **Graceful D1 fallback**: All cross-device features are wrapped in try/catch — if D1 is unreachable, falls back to single-device local-only behavior with no disruption
- **New files**: `src/email/merge-sessions.ts` (session merge utility), `src/cloud/sync.ts` additions (`pullCrossDeviceReports`, `checkCrossDeviceEmailSent`)
- **Tests**: 128/128 passing (11 test files)

### v0.7.7 (2026-04-09) — claude-code summarization quality + Workers AI CLI sample report

- **claude-code summarization quality improvements**: When `ai_provider = claude-code`, `circle --json` now preprocesses `conversationTurns` before output — applies path/filename removal, single-word response filtering, 30-turn limit, and 200/300-char truncation (matching Workers AI's preprocessing). This reduces noise and improves Claude Code's direct summarization quality
- **SKILL.md 2-pass restructuring**: Step 2 now instructs Claude Code to analyze sessions one-by-one (1-pass per session), then synthesize overview separately (2-pass). Added concrete input/output examples for consistent quality
- **Workers AI CLI sample report**: Added `docs/sample-report-cli.html` — actual daily report email generated by Workers AI (Cloudflare) summarization pipeline. Live at [pathcosmos.github.io/sincenety/sample-report-cli.html](https://pathcosmos.github.io/sincenety/sample-report-cli.html)
- **Tests**: 128/128 passing (11 test files)

### v0.7.6 (2026-04-09) — sessionId prefix matching + GitHub Pages sample report

- **sessionId prefix matching fallback**: When AI summaries are saved via `circle --save` with truncated or mistyped sessionIds, the renderer (`renderer.ts`) now falls back to prefix matching (first 12 chars) to still map AI summaries to the correct sessions — prevents silent degradation to raw data in emails
- **`circleSave()` auto-correction**: When saving AI summaries, if the input sessionId doesn't exactly match a DB session, prefix matching resolves the correct ID and stores the corrected version — ensures downstream rendering always has valid IDs
- **GitHub Pages sample report**: Added `docs/index.html` landing page and `docs/sample-report.html` with a real daily report email sample. Live at [pathcosmos.github.io/sincenety](https://pathcosmos.github.io/sincenety/)
- **Tests**: 128/128 passing (11 test files)

### v0.7.4 (2026-04-09) — AI provider routing fix + summarization quality improvements

- **Fixed `autoSummarize()` ignoring `ai_provider` config**: In CLI environment (`sincenety`, `sincenety circle`), Workers AI was called whenever D1 tokens existed, regardless of `ai_provider` setting. Now uses `resolveAiProvider()` to respect the config
- **Added provider check to `circleJson --summarize`**: `--summarize` flag now only calls Workers AI when `ai_provider = cloudflare`
- **Heuristic fallback on Workers AI failure**: When Workers AI fails for individual sessions, falls back to `summarizer.ts` heuristic summary (prevents data loss)
- **`autoSummarize()` now runs for all AI providers**: Previously only ran for `cloudflare`; now runs for all providers (cloudflare → Workers AI, anthropic → Claude API, claude-code/heuristic → heuristic), ensuring `daily_reports` always has baseline summaries
- **Assistant output truncation raised from 300 to 1500 chars**: Previously assistant responses were hard-capped at 300 characters, losing most content needed for quality summaries
- **File path/filename filtering in text cleanup**: Absolute paths (`/Users/...`, `/Volumes/...`), relative paths (`./foo`, `../bar`), and filenames with common extensions (`.ts`, `.js`, `.json`, etc.) are now stripped from summary input to reduce technical noise
- **Improved heuristic fallback summaries**: When no conversation turns exist, shows project name + message count instead of raw user input; when no result keywords found, extracts first sentence from assistant output instead of raw user input
- **`tool_use` block extraction**: Claude Code assistant responses are often `tool_use` blocks (Edit, Bash, Read) with no text content; now extracts tool names as `[Edit, Bash, Read]` to give the heuristic summarizer meaningful input
- **Updated README AI Summarization section**: Corrected "CLI always uses Workers AI" → "`ai_provider` respected in all environments"

---

## Roadmap

- [x] Weekly/monthly summary reports
- [x] Email with AI summary (daily overview + per-session topic/outcome/flow)
- [x] Gmail clip prevention (actions capped at 5/session, text length optimized)
- [x] 3-phase pipeline (air → circle → out)
- [x] Checkpoint-based backfill with change detection
- [x] Vacation management
- [x] `out` command — smart email delivery (out/outd/outw/outm, 4 providers, catchup)
- [x] `config --setup` wizard
- [x] Gmail MCP integration (zero-config email via `gmail_create_draft`)
- [x] Cloud sync (Cloudflare D1 multi-machine aggregation)
- [x] Cloudflare Workers AI integration (Qwen3-30B summarization)
- [x] Auto machine ID (hardware-based, cross-platform)
- [x] Token-only D1 setup (account/database auto-detection)
- [x] Unified AI provider routing (cloudflare/anthropic/claude-code/heuristic)
- [x] Mandatory setup guard (D1 + SMTP required before any command)
- [x] Clean JSON output: `--render-only` stdout/stderr separation, single JSON output
- [x] Default command: `sincenety` (no args) runs full pipeline (air → circle → out)
- [x] English CLI: all user-facing messages converted to English
- [x] AI provider setup required on first run in Claude Code
- [x] Scope selection: global (all projects) or project (specific path) mode
- [x] Postinstall setup wizard: `npm install -g` triggers interactive 3-step setup
- [x] Date-targeted reports: `--date yyyyMMdd` for out/outd/outw/outm commands
- [x] Circle project-level session merge (individual summary → consolidated re-summary per project)
- [ ] Passphrase encryption option
- [ ] Similar task matching (TF-IDF)
- [ ] External DB connectors (MariaDB/PostgreSQL)
- [ ] ccusage integration (automatic cost calculation)
- [ ] Multi-language report output (KO toggle option)
- [x] Sample report page (GitHub Pages: [pathcosmos.github.io/sincenety](https://pathcosmos.github.io/sincenety/))
- [x] Defensive sessionId matching (prefix fallback + auto-correction)
- [x] claude-code summarization quality (turn preprocessing + SKILL.md 2-pass)
- [x] Workers AI CLI sample report (GitHub Pages)
- [x] Cross-device consolidated reports (D1 pull + circle merge + always-send)
- [x] Session merge by project (project-level dedup with ×N count)
- [x] Improved title extraction (meaningful message priority + fallback)
- [x] Auto weekly/monthly baseline generation (every `out`/`outd`/`outw`/`outm` run, emailed-report protected)
- [x] Pipeline mode switch (`--mode=full|smart` + `config --pipeline-mode`)
- [x] Silent failure hardening (runCircle `summaryErrors` + CLI exit code propagation)
- [ ] Report export (PDF/HTML standalone)

---

## License

MIT
