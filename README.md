# sincenety

**Automatic work session tracker for Claude Code** — Run `sincenety` once and it retroactively analyzes all Claude Code activity since the last checkpoint, generating structured work records with token usage, model info, and precise timing.

No start/stop needed. Just run it when you're done.

> **[한국어 문서 (Korean)](./README.ko.md)**

```
$ sincenety

  📋 2026-04-07 (Mon) Work Gather (00:00 ~ 18:05)
  ┌─────────────────────────────────────────────────────────┐
  │ Sessions: 4 │ Messages: 1605 │ Tokens: 9.0Ki / 212.7Ko │
  └─────────────────────────────────────────────────────────┘
  ┌──────────────┬───────────────┬────────┬────────┬────────┐
  │ Project      │ Time          │ Msgs   │ Tokens │ Model  │
  ├──────────────┼───────────────┼────────┼────────┼────────┤
  │ claudflare   │ 11:22 ~ 14:49 │    445 │ 66.4K  │ opus   │
  │ sincenety    │ 14:55 ~ 18:05 │    860 │ 98.2K  │ opus   │
  │ ...          │               │        │        │        │
  └──────────────┴───────────────┴────────┴────────┴────────┘
  ✅ Gather complete. Records saved.
```

---

## Features

### Retroactive Work Gathering

No need to remember to start/stop tracking. `sincenety` parses `~/.claude/` data at runtime and reconstructs everything:

- **Session JSONL parsing** — Extracts token usage, model names, millisecond-precision timestamps, and conversation turns (user input + assistant output pairs) from `~/.claude/projects/[project]/[sessionId].jsonl`
- **Full-day default** — Always gathers from today 00:00 by default; upsert logic prevents duplicates across runs

### Rich Work Records

| Field | Description |
|-------|-------------|
| Title | Auto-extracted from first user message |
| Description | Top 3-5 user messages joined |
| Token usage | Per-message input/output/cache token aggregation |
| Duration | First message → last message precise measurement |
| Model | Extracted from assistant responses |
| Category | Auto-classified from project path |

### AI-Powered Daily Reports

Generate summaries powered by Claude Code itself — no external API key needed. The CLI outputs structured JSON with conversation turns, and the Claude Code skill (SKILL.md) instructs the session to generate summaries directly. Summaries are saved to the `daily_reports` table and can be viewed as daily, weekly, or monthly reports.

When `ANTHROPIC_API_KEY` is set, the `summarizer.ts` module can also call the Claude API directly for turn-based analysis with heuristic fallback.

### Email Reports

Send beautiful HTML email reports via Gmail SMTP. Color-coded sessions, token dashboard, work flow, and outcome/significance data included. XML/system tag cleanup ensures clean output.

### Auto-Scheduling

Automatically gather and email at 6 PM (default). Uses launchd on macOS, crontab on Linux.

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

### Basic Gathering

```bash
# Gather today's work (default: from 00:00, upsert prevents duplicates)
sincenety

# Gather from specific time
sincenety --since "09:00"
sincenety --since "2026-04-07 09:00"

# JSON output with conversation turns (for AI summary pipeline)
sincenety --json

# Fast mode (history.jsonl only, no token extraction)
sincenety --no-detail

# View saved logs
sincenety log
sincenety log --date 2026-04-06
sincenety log --week
```

### Daily Reports

```bash
# Save an AI-generated summary to the DB (accepts JSON from stdin)
sincenety save-daily < summary.json

# View daily/weekly/monthly reports
sincenety report                   # Today's report
sincenety report --date 2026-04-06
sincenety report --week            # Weekly aggregate
sincenety report --month           # Monthly aggregate
```

### Email Setup

```bash
# Set recipient
sincenety config --email you@gmail.com

# Set SMTP (Gmail app password)
sincenety config --smtp-user sender@gmail.com
sincenety config --smtp-pass   # Prompted securely, not in shell history

# Send report
sincenety email
```

> Generate Gmail app password: https://myaccount.google.com/apppasswords

### Auto-Schedule

```bash
sincenety schedule --install           # Install 6 PM daily gather + email
sincenety schedule --install --time 19:00  # Custom time
sincenety schedule --status            # Check status
sincenety schedule --uninstall         # Remove
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

1. **Data collection** — CLI gathers all sessions since 00:00 as JSON (with conversation turns)
2. **AI summary** — Claude Code itself analyzes conversation turns and generates topic/outcome/flow/significance for each session, plus an overview
3. **Save to DB** — Summary is saved to `daily_reports` table via `save-daily`
4. **Terminal report** — Structured report shown in terminal
5. **Email** — If configured, sends an HTML email with AI summary, color-coded dashboard, and daily overview

The key insight: Claude Code **is** the AI — no external API key needed. The skill instructs the current session to summarize the collected data directly.

#### Email setup (optional)

Inside Claude Code or terminal:

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
│   ├── cli.ts                  # CLI entry (commander, 7 subcommands)
│   ├── core/
│   │   ├── gatherer.ts         # Core logic (parse → group → store → report)
│   │   └── summarizer.ts       # Claude API summarization + heuristic fallback
│   ├── parser/
│   │   ├── history.ts          # ~/.claude/history.jsonl streaming parser
│   │   └── session-jsonl.ts    # Session JSONL parser (tokens/model/timing/conversationTurns)
│   ├── grouper/session.ts      # Session grouping by sessionId + project
│   ├── storage/
│   │   ├── adapter.ts          # StorageAdapter interface
│   │   └── sqljs-adapter.ts    # sql.js implementation (encrypted DB)
│   ├── encryption/
│   │   ├── key.ts              # PBKDF2 key derivation (machine-bound + passphrase)
│   │   └── crypto.ts           # AES-256-GCM encrypt/decrypt
│   ├── report/
│   │   ├── terminal.ts         # Terminal output formatter
│   │   └── markdown.ts         # Markdown report generator
│   ├── email/
│   │   ├── sender.ts           # nodemailer email sender
│   │   └── template.ts         # Bright color-coded HTML email template
│   └── scheduler/install.ts    # launchd/cron auto-installer
├── tests/encryption.test.ts    # Encryption tests (26 cases)
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
                                    ▼
                             Group + summarize
                                    │
                     ┌──────────┬───┼───────┬──────────────┐
                     ▼          ▼   ▼       ▼              ▼
              Terminal table  DB save  Email  --json output  AI summary
              (box-drawing)  (encrypted)            │       (Claude Code
               + CJK-aware                         ▼        or API)
                                            save-daily ──→ daily_reports
```

### Encryption

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2 (SHA-256, 100,000 iterations)
- **Key source**: `hostname + username + random salt` (machine-bound)
- **Salt**: `~/.sincenety/sincenety.salt` (32-byte random, created once, mode 0600)
- **File format**: `[4B magic "SNCT"][12B IV][ciphertext][16B auth tag]`

### DB Schema

| Table | Description |
|-------|-------------|
| `sessions` | Per-session work records (22 columns — tokens, timing, title, description, model, etc.) |
| `gather_reports` | Report per gather run (markdown + JSON) |
| `daily_reports` | AI-generated daily/weekly/monthly summaries (UNIQUE(report_date, report_type)) |
| `checkpoints` | Last processed timestamp |
| `config` | Settings (email, SMTP, etc.) |

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
| Tests | vitest |

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (dist/)
npm run dev          # Run with tsx (dev mode)
npm test             # Run vitest tests
node dist/cli.js     # Direct execution
```

---

## Roadmap

- [x] Weekly/monthly summary reports
- [x] Email with AI summary (daily overview + per-session topic/outcome/flow)
- [x] Gmail clip prevention (actions capped at 5/session, text length optimized)
- [ ] Passphrase encryption option
- [ ] Similar task matching (TF-IDF)
- [ ] External DB connectors (MariaDB/PostgreSQL)
- [ ] ccusage integration (automatic cost calculation)
- [ ] Multi-language report output (EN/KO toggle)
- [ ] Report export (PDF/HTML standalone)

---

## License

MIT
