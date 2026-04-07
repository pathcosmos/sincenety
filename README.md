# sincenety

**Automatic work session tracker for Claude Code** — Run `sincenety` once and it retroactively analyzes all Claude Code activity since the last checkpoint, generating structured work records with token usage, model info, and precise timing.

No start/stop needed. Just run it when you're done.

> **[한국어 문서 (Korean)](./README.ko.md)**

```
$ sincenety

  📋 2026-04-07 (Tue) Work Gather (12:00 ~ 18:05)
  4 sessions, 1605 messages | Tokens: 9.0Kin / 212.7Kout
  ────────────────────────────────────────────────────────
  [claudflare_web] 11:22 ~ 14:49 (3h 28m, 445msg, 66.4Ktok)
    pathcosmos.com security + web analytics setup
    Model: claude-opus-4-6
  ...
  ✅ Gather complete. Records saved.
```

---

## Features

### Retroactive Work Gathering

No need to remember to start/stop tracking. `sincenety` parses `~/.claude/` data at runtime and reconstructs everything:

- **Session JSONL parsing** — Extracts token usage, model names, and millisecond-precision timestamps from `~/.claude/projects/[project]/[sessionId].jsonl`
- **Checkpoint system** — Each run saves a "gathered up to here" marker, so the next run picks up where you left off

### Rich Work Records

| Field | Description |
|-------|-------------|
| Title | Auto-extracted from first user message |
| Description | Top 3-5 user messages joined |
| Token usage | Per-message input/output/cache token aggregation |
| Duration | First message → last message precise measurement |
| Model | Extracted from assistant responses |
| Category | Auto-classified from project path |

### Email Reports

Send beautiful HTML email reports via Gmail SMTP. Color-coded sessions, token dashboard, and session summaries included.

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
# Gather since last checkpoint
sincenety

# Gather from specific time
sincenety --since "09:00"
sincenety --since "2026-04-07 09:00"

# Fast mode (history.jsonl only, no token extraction)
sincenety --no-detail

# View saved logs
sincenety log
sincenety log --date 2026-04-06
sincenety log --week
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

### Claude Code Skill

Use `/sincenety` directly inside Claude Code sessions.

---

## Architecture

```
sincenety/
├── src/
│   ├── cli.ts                  # CLI entry (commander, 5 subcommands)
│   ├── core/gatherer.ts        # Core logic (parse → group → store → report)
│   ├── parser/
│   │   ├── history.ts          # ~/.claude/history.jsonl streaming parser
│   │   └── session-jsonl.ts    # Session JSONL parser (tokens/model/timing)
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
~/.claude/projects/[project]/[sessionId].jsonl  ──→  Extract tokens/model/timing
                                    │
                                    ▼
                             Group + summarize
                                    │
                     ┌──────────────┼──────────────┐
                     ▼              ▼              ▼
              Terminal output   DB save (encrypted)  Email send
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

- [ ] Passphrase encryption option
- [ ] Similar task matching (TF-IDF)
- [ ] External DB connectors (MariaDB/PostgreSQL)
- [ ] Weekly/monthly summary reports
- [ ] ccusage integration (automatic cost calculation)

---

## License

MIT
