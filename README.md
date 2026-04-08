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

**v0.3.0** restructures the CLI into a clear pipeline:

1. **`sincenety air`** (환기) — Collect and store work records by date
   - Date-based grouping (midnight boundary, startedAt-based)
   - Automatic backfill: checkpoint-based, collects empty dates too
   - Change detection: data hash skips unchanged dates
   - `--json` outputs per-date JSON

2. **`sincenety circle`** (순환 정화) — LLM-powered summaries
   - Internally runs `air` first
   - `--json`: outputs session data for AI summary (SKILL.md integration)
   - `--save`: saves stdin JSON to `daily_reports`
   - `--type daily|weekly|monthly`
   - Auto-finalization: midnight finalizes previous day, Monday finalizes previous week, 1st finalizes previous month
   - Change detection: data hash comparison saves tokens

3. **`sincenety out`** — Smart email delivery
   - `out`: daily always, +weekly on Friday, +monthly on month-end
   - Unsent catchup: missed Friday → Monday auto-sends weekly
   - 4 providers: Gmail MCP / Resend / Gmail SMTP / Custom SMTP
   - `outd` / `outw` / `outm`: force daily / weekly / monthly
   - `--preview`, `--render-only`, `--history`

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

### AI-Powered Summaries

Generate summaries powered by Claude Code itself — no external API key needed. The `circle --json` command outputs structured data, and the Claude Code skill (SKILL.md) instructs the session to generate summaries directly. Summaries are saved to `daily_reports` with daily, weekly, or monthly types.

When `ANTHROPIC_API_KEY` is set, the `summarizer.ts` module can also call the Claude API directly.

### Config Management

Run `sincenety config` with no arguments to see a formatted settings status table. Supports vacation registration, email provider selection (Gmail/Resend/custom SMTP), and more.

### Auto-Scheduling

Automatically gather at 6 PM (default). Uses launchd on macOS, crontab on Linux.

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

# Save AI-generated summary to DB (stdin JSON)
sincenety circle --save < summary.json
sincenety circle --save --type weekly < weekly_summary.json
sincenety circle --save --type monthly < monthly_summary.json
```

### config — Settings Management

```bash
# Show current settings (ANSI table)
sincenety config

# Email settings
sincenety config --email you@gmail.com
sincenety config --smtp-user sender@gmail.com
sincenety config --smtp-pass       # Prompted securely
sincenety config --provider resend
sincenety config --resend-key rk_...

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
│   ├── cli.ts                  # CLI entry (commander: air, circle, out, config, schedule)
│   ├── core/
│   │   ├── air.ts              # Phase 1: date-based gathering (backfill + hash)
│   │   ├── circle.ts           # Phase 2: LLM summary pipeline (finalization + save)
│   │   ├── out.ts              # Phase 3: smart email dispatch (out/outd/outw/outm)
│   │   ├── gatherer.ts         # Core gathering logic (parse → group → store)
│   │   └── summarizer.ts       # Claude API summarization + heuristic fallback
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
│   ├── scheduler/install.ts    # launchd/cron auto-installer
│   └── skill/SKILL.md          # Claude Code skill definition
├── tests/
│   ├── encryption.test.ts      # Encryption tests (26 cases)
│   ├── migration-v4.test.ts    # DB v3→v4 migration tests (7 cases)
│   ├── air.test.ts             # air command tests (7 cases)
│   ├── circle.test.ts          # circle command tests (10 cases)
│   └── out.test.ts             # out command tests (28 cases)
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
| Email | nodemailer (Gmail SMTP) |
| Tests | vitest (78 cases) |

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (dist/)
npm run dev          # Run with tsx (dev mode)
npm test             # Run vitest tests (78 cases)
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
- [ ] `config --setup` wizard (Plan 3)
- [ ] Passphrase encryption option
- [ ] Similar task matching (TF-IDF)
- [ ] External DB connectors (MariaDB/PostgreSQL)
- [ ] ccusage integration (automatic cost calculation)
- [ ] Multi-language report output (EN/KO toggle)
- [ ] Report export (PDF/HTML standalone)

---

## License

MIT
