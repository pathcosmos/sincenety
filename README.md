# sincenety

**Automatic work session tracker for Claude Code** — A 3-phase pipeline that retroactively collects, summarizes, and reports all Claude Code activity. No start/stop needed.

> **[한국어 문서 (Korean)](./README.ko.md)**

```
$ sincenety air

  📋 air 갈무리 완료
     날짜 범위: 3일 (백필 2일)
     총 세션: 12개
     변경 날짜: 2일
     변경: 2026-04-06, 2026-04-07

$ sincenety circle

  📋 circle 마무리 완료
     날짜 범위: 3일
     총 세션: 12개
     변경 날짜: 2일
     finalized: 2026-04-06
     요약 필요: 2026-04-07
```

---

## Features

### 3-Phase Pipeline: air → circle → out

**v0.5.0** structures the CLI into a clear pipeline:

1. **`sincenety air`** (환기) — Collect and store work records by date
   - Date-based grouping (midnight boundary, startedAt-based)
   - Automatic backfill: checkpoint-based, collects empty dates too
   - Change detection: data hash skips unchanged dates
   - Empty day records (no sessions = still recorded)
   - `--json` outputs per-date JSON

2. **`sincenety circle`** (순환 정화) — LLM-powered summaries
   - Internally runs `air` first
   - `--json`: outputs session data for AI summary (SKILL.md integration)
   - `--save`: saves stdin JSON to `daily_reports`
   - `--type daily|weekly|monthly`
   - Auto-finalization: midnight finalizes previous day, Monday finalizes previous week, 1st finalizes previous month
   - Change detection: data hash comparison saves tokens
   - Vacation days get a [휴가] label automatically

3. **`sincenety out`** — Smart email delivery
   - `out`: daily always, +weekly on Friday, +monthly on month-end
   - Unsent catchup: missed Friday → Monday auto-sends weekly
   - 4 providers: Gmail MCP / Resend / Gmail SMTP / Custom SMTP
   - `outd` / `outw` / `outm`: force daily / weekly / monthly
   - `--preview`, `--render-only`, `--history`

### CLI Commands (9)

| Command | Description |
|---------|-------------|
| `sincenety air` | Collect — date-grouped auto-backfill gathering |
| `sincenety circle` | Summarize — LLM summary (--json/--save/--type) |
| `sincenety out` | Smart dispatch (weekday + unsent catchup) |
| `sincenety outd` / `outw` / `outm` | Force daily / weekly / monthly send |
| `sincenety sync` | D1 central cloud sync |
| `sincenety config` | Settings (--setup, --vacation, --d1-*) |
| `sincenety schedule` | Auto-schedule (launchd/cron) |

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

Unified AI provider system with configurable routing:

| Environment | AI Provider | Control |
|-------------|------------|---------|
| **CLI** (cron, terminal) | Workers AI (always) | D1 토큰만 있으면 자동 |
| **Claude Code** (`/sincenety`) | User's choice | `ai_provider` 설정 |

```bash
# AI provider 설정 (Claude Code 환경에서의 동작 제어)
sincenety config --ai-provider cloudflare   # Workers AI 사용
sincenety config --ai-provider anthropic    # Claude API 사용
sincenety config --ai-provider claude-code  # Claude Code 직접 요약
sincenety config --ai-provider auto         # 자동 감지 (기본값)

# 현재 설정 확인
sincenety config
# → AI 요약: ai_provider = auto (auto → cloudflare)
```

- **Cloudflare Workers AI (Qwen3-30B)** for Korean text summarization
- D1 token only needed — no separate API key required
- `circle` auto-summarizes: per-session topic/outcome/flow/significance + daily overview
- `circle --json --summarize`: Workers AI summaries included in JSON output (for SKILL.md)
- Free tier: 10,000 neurons/day (sufficient for personal use, ~300 summaries/day)
- Heuristic fallback when no AI provider is available

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
- **Report integration** — vacation days get a [휴가] label in `circle`; `out` skips vacation days automatically

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

### Auto-Scheduling

Automatically gather at 6 PM (default). Uses launchd on macOS, crontab on Linux.

### Cloud Sync (Cloudflare D1)

Multi-machine data aggregation via Cloudflare D1:

- **Local-first**: encrypted local DB remains the source of truth
- **`sincenety sync`** pushes local data to a central D1 database (push / pull-config / status / init)
- **Auto-sync** after `out` completes (non-fatal — network errors don't block email delivery)
- **Shared config**: SMTP settings set once, `sync --pull-config` on new machines to pull shared config
- **Machine ID**: hardware-based auto-detection (see below), `config --machine-name` override for custom identification
- **Zero new dependencies**: uses native `fetch` for D1 REST API — no extra packages added

### Cloudflare API Token 발급

1. **토큰 생성 페이지 접속**: [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. **"Create Token"** → **"Custom token"** (맨 아래 "Get started") 선택
3. **권한 설정**:

| Permission | Access | 용도 |
|-----------|--------|------|
| Account / **D1** | **Edit** | DB 생성 + 읽기/쓰기 |
| Account / **Workers AI** | **Read** | AI 요약 모델 호출 (Qwen3-30B) |
| Account / **Account Settings** | **Read** | 계정 자동 탐지 (`--d1-token` 설정 시) |

> **3개 모두 필수입니다.** Account Settings Read가 없으면 `--d1-token`으로 자동 설정 시 계정을 찾을 수 없습니다.

4. **Account Resources** → Include → 본인 계정 선택
5. **"Create Token"** → 토큰 복사 (한 번만 표시됨!)

> 이 토큰 하나로 D1 (중앙 DB) + Workers AI (요약 엔진) + sync (동기화) 전부 동작합니다.

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

## Installation

```bash
# Run directly via npx
npx sincenety@latest

# Or install globally
npm install -g sincenety

# Or build from source
git clone https://github.com/pathcosmos/sincenety.git
cd sincenety
npm install && npm run build
npm link
```

## Quick Start — Required Setup

> **Both steps are mandatory.** All commands except `config` will refuse to run until setup is complete.

### Step 1: Cloudflare API Token

Create a token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with these permissions:

| Permission | Access | Purpose |
|-----------|--------|---------|
| Account / **D1** | **Edit** | DB creation + read/write |
| Account / **Workers AI** | **Read** | AI summarization (Qwen3-30B) |
| Account / **Account Settings** | **Read** | Account auto-detection |

```bash
sincenety config --d1-token <YOUR_API_TOKEN>
# ✅ Account auto-detected
# ✅ D1 database auto-created
# ✅ Workers AI enabled
# ✅ Schema setup complete
```

### Step 2: Email (Gmail SMTP)

1. Generate an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Run the setup wizard:

```bash
sincenety config --setup
# Select "1) Gmail SMTP"
# Enter your Gmail address and app password
# ✅ Connection test runs automatically
```

Or set manually:
```bash
sincenety config --email you@gmail.com --smtp-user you@gmail.com --smtp-pass
```

### Verify

```bash
sincenety config
# Shows all settings with ✅/❌ status
# AI 요약: ai_provider = auto (auto → cloudflare)
```

## Usage

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

# AI provider (Claude Code 환경 제어)
sincenety config --ai-provider cloudflare   # Workers AI
sincenety config --ai-provider anthropic    # Claude API
sincenety config --ai-provider claude-code  # Claude Code 직접 요약
sincenety config --ai-provider auto         # Auto-detect (default)

# Vacation management
sincenety config --vacation 2026-04-10 2026-04-11
sincenety config --vacation-list
sincenety config --vacation-clear 2026-04-10
```

> Generate Gmail app password: https://myaccount.google.com/apppasswords

### schedule — Auto-Scheduling

```bash
sincenety schedule --install           # Install 6 PM daily
sincenety schedule --install --time 19:00  # Custom time
sincenety schedule --status            # Check status
sincenety schedule --uninstall         # Remove
```

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
│   ├── cli.ts                  # CLI entry (commander: air, circle, out, sync, config, schedule — 9 commands)
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
│   │   ├── renderer.ts         # HTML email renderer (report → HTML)
│   │   ├── resend.ts           # Resend API email provider
│   │   ├── provider.ts         # Email provider abstraction (Gmail MCP/Resend/SMTP)
│   │   └── template.ts         # Bright color-coded HTML email template
│   ├── vacation/
│   │   ├── manager.ts          # Vacation CRUD (register/list/clear/check)
│   │   └── detector.ts         # Vacation keyword detection (KO+EN)
│   ├── config/
│   │   └── setup-wizard.ts     # Interactive 3-choice setup wizard
│   ├── cloud/
│   │   ├── d1-client.ts        # Cloudflare D1 REST API client
│   │   ├── d1-schema.ts        # D1 schema definition & migration
│   │   ├── d1-auto-setup.ts    # Token-only auto-setup (account/DB detection)
│   │   ├── cf-ai.ts            # Cloudflare Workers AI client (Qwen3-30B)
│   │   └── sync.ts             # Sync logic (push/pull/status/init)
│   ├── util/
│   │   └── machine-id.ts       # Cross-platform hardware ID detection
│   ├── scheduler/install.ts    # launchd/cron auto-installer
│   └── skill/SKILL.md          # Claude Code skill definition
├── tests/
│   ├── encryption.test.ts      # Encryption tests (26 cases)
│   ├── migration-v4.test.ts    # DB v3→v4 migration tests (7 cases)
│   ├── air.test.ts             # air command tests (7 cases)
│   ├── circle.test.ts          # circle command tests (10 cases)
│   ├── out.test.ts             # out command tests (28 cases)
│   ├── vacation.test.ts        # Vacation management tests (13 cases)
│   ├── d1-client.test.ts       # D1 client tests
│   ├── sync.test.ts            # Sync tests
│   ├── cf-ai.test.ts           # Cloudflare Workers AI tests
│   └── machine-id.test.ts      # Machine ID detection tests
├── package.json
└── tsconfig.json
```

### Data Flow

```
~/.claude/history.jsonl  ──→  Extract session list (sessionId + project)
                                    │
                                    ▼
~/.claude/projects/[project]/[sessionId].jsonl  ──→  Extract tokens/model/timing/turns
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
                  sincenety air           (date grouping)
                  (checkpoint backfill,    (midnight boundary)
                   data hash detection)
                        │
                        ▼
                  gather_reports DB
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
     terminal       air --json    circle
     summary        (per-date)   (auto-finalization)
                                     │
                        ┌────────────┼────────────┐
                        ▼            ▼            ▼
                  circle --json  circle --save  sincenety out
                  (SKILL.md)    (daily_reports)  (smart dispatch)
                                                      │
                                        ┌─────────────┼─────────────┐
                                        ▼             ▼             ▼
                                    outd (daily)  outw (weekly)  outm (monthly)
                                        │
                                  4 providers:
                                  Gmail MCP / Resend /
                                  Gmail SMTP / Custom SMTP
                                        │
                                        ▼
                                  sincenety sync
                                  (auto after out)
                                        │
                                        ▼
                                  Cloudflare D1
                                  (multi-machine aggregation)
                        │
                        ▼
                  Claude Code
                  AI summary
```

### Encryption

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2 (SHA-256, 100,000 iterations)
- **Key source**: `hostname + username + random salt` (machine-bound)
- **Salt**: `~/.sincenety/sincenety.salt` (32-byte random, created once, mode 0600)
- **File format**: `[4B magic "SNCT"][12B IV][ciphertext][16B auth tag]`

### DB Schema (v4)

| Table | Description |
|-------|-------------|
| `sessions` | Per-session work records (22 columns — tokens, timing, title, description, model, etc.) |
| `gather_reports` | Report per gather run (markdown + JSON, report_date, data_hash, updated_at) |
| `daily_reports` | AI-generated summaries (status, progress_label, data_hash; UNIQUE(report_date, report_type)) |
| `checkpoints` | Last processed timestamp |
| `config` | Settings (email, SMTP, provider, etc.) |
| `vacations` | Vacation/holiday dates (date, type, source, label) |
| `email_logs` | Email delivery logs |

Auto-migration: v1 → v2 → v3 → v4

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
| Tests | vitest (116 cases across 11 test files) |

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (dist/)
npm run dev          # Run with tsx (dev mode)
npm test             # Run vitest tests (116 cases)
node dist/cli.js     # Direct execution
```

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
- [ ] Passphrase encryption option
- [ ] Similar task matching (TF-IDF)
- [ ] External DB connectors (MariaDB/PostgreSQL)
- [ ] ccusage integration (automatic cost calculation)
- [ ] Multi-language report output (EN/KO toggle)
- [ ] Report export (PDF/HTML standalone)

---

## License

MIT
