# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**sincenety** — Claude Code 작업 갈무리 도구

`sincenety` 한 번 실행으로 오늘 00:00 ~ 현재까지의 Claude Code 작업 이력을 자동 분석하여 구조화된 작업 기록을 생성하는 도구. start/stop 없이, 실행 시점 기준으로 소급하여 모든 작업을 정리한다.

### 핵심 기능

1. **소급 갈무리** — `sincenety` 실행 시 오늘 00:00 이후의 `~/.claude/history.jsonl`을 분석하여 프로젝트별/세션별 작업 내용을 자동 재구성 (upsert로 중복 방지)
2. **작업 로그 관리** — 날짜별/프로젝트별 작업 기록을 구조화된 형태로 저장하고 조회
3. **AI 요약** — CLI가 수집한 데이터를 Claude Code가 직접 요약하여 일일/주간/월간 보고서 생성

### 데이터 소스

갈무리 시 활용하는 데이터 소스:
- `~/.claude/history.jsonl` — Claude Code 전체 대화 히스토리
- `~/.claude/projects/` — 프로젝트별 세션 데이터
- `~/.claude/sessions/` — 세션 메타데이터
- `git log` — 각 프로젝트 디렉토리의 커밋 이력
- `~/.claude/file-history/` — 파일 변경 이력

### history.jsonl 엔트리 포맷

```json
{
  "display": "사용자 입력 메시지 텍스트",
  "pastedContents": {},
  "timestamp": 1775548110649,
  "project": "/path/to/your/project",
  "sessionId": "9e223a29-64e9-4540-8c9a-fef279943239"
}
```

### sessions/*.json 포맷

```json
{
  "pid": 19361,
  "sessionId": "9e223a29-...",
  "cwd": "/path/to/your/project",
  "startedAt": 1775548110649,
  "kind": "interactive",
  "entrypoint": "cli"
}
```

핵심 그룹핑 키: `sessionId` + `project`. timestamp는 밀리초 단위 Unix epoch.

### 사용 시나리오

```
# 기본: 오늘 00:00 이후의 모든 작업 정리
sincenety

# 특정 시점부터 갈무리
sincenety --since "today 09:00"

# JSON 출력 (대화 턴 포함 구조화 데이터)
sincenety --json

# AI 요약 보고서를 DB에 저장 (stdin JSON)
sincenety save-daily < daily_report.json

# 일일/주간/월간 보고 조회
sincenety report --date today
sincenety report --week
sincenety report --month

# 작업 로그 조회
sincenety log --date today
sincenety log --week
```

### 동작 흐름

1. 오늘 00:00 timestamp 계산 (`--since` 지정 시 해당 시점)
2. `~/.claude/history.jsonl`에서 해당 시점 이후 항목 스트리밍 파싱
3. `sessionId` + `project` 기준으로 그룹핑
4. 각 세션의 시작~종료 시간, 메시지 수, 대화 턴 수집
5. 구조화된 작업 기록 DB에 upsert + 터미널에 리포트 출력
6. (AI 요약 흐름) CLI `--json` 출력 → SKILL.md가 Claude Code에게 요약 지시 → `save-daily`로 DB 저장

## Architecture

### 설계 원칙

- **비침습적** — Claude Code 원래 데이터(`~/.claude/`)를 수정하지 않고 읽기 전용으로 분석
- **start/stop 없음** — 별도 기록 행위 불필요. 실행 시점에 소급하여 자동 정리
- **오프라인 우선** — 모든 데이터는 로컬에 저장, 외부 서비스 의존 없음
- **구조화된 저장** — JSON/JSONL 형식으로 기록하되, 사람이 읽을 수 있는 마크다운 리포트도 생성
- **Claude Code 직접 요약** — CLI는 데이터 수집만 담당, AI 요약은 Claude Code가 직접 수행. sincenety는 Claude Code 안에서만 실행되므로 외부 API 키 불필요

### 디렉토리 구조

```
sincenety/
├── src/
│   ├── cli.ts                    # CLI 진입점 (commander, 7개 서브커맨드)
│   ├── core/
│   │   ├── gatherer.ts           # 갈무리 핵심 로직 (파싱 → 그룹핑 → 저장)
│   │   ├── summarizer.ts         # 세션 요약 라우터 (Workers AI / Claude API / 휴리스틱)
│   │   └── ai-provider.ts       # AI provider 감지 및 라우팅 (cloudflare/anthropic/claude-code)
│   ├── parser/
│   │   ├── history.ts            # history.jsonl readline 스트리밍 파서
│   │   └── session-jsonl.ts      # 세션 JSONL 파서 (conversationTurns 포함)
│   ├── grouper/session.ts        # sessionId+project 그룹핑, 요약 추출
│   ├── storage/
│   │   ├── adapter.ts            # StorageAdapter 인터페이스 (DailyReport 포함)
│   │   └── sqljs-adapter.ts      # sql.js 구현 (암호화 DB, 스키마 v3 자동 마이그레이션)
│   ├── encryption/
│   │   ├── key.ts                # PBKDF2 machine-bound/passphrase 키 파생
│   │   └── crypto.ts             # AES-256-GCM encrypt/decrypt
│   ├── report/
│   │   ├── terminal.ts           # 터미널 테이블 포매터 (유니코드 박스)
│   │   └── markdown.ts           # 마크다운 리포트 생성
│   ├── email/
│   │   ├── sender.ts             # nodemailer 이메일 발송
│   │   └── template.ts           # Bright 컬러코딩 HTML 이메일 템플릿
│   ├── scheduler/install.ts      # launchd/cron 자동 설치
│   └── skill/SKILL.md            # Claude Code skill 정의
├── tests/
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

## Development

### Tech Stack

- **언어**: TypeScript (ESM, Node16 모듈)
- **런타임**: Node.js >= 18
- **CLI**: commander
- **DB**: sql.js (WASM SQLite, native 의존성 없음)
- **암호화**: Node.js 내장 crypto (AES-256-GCM)
- **이메일**: nodemailer (Gmail SMTP)
- **테스트**: vitest
- **배포**: npm (`npx sincenety@latest`) + Claude Code skill (`/sincenety`)

### 빌드 및 실행

```bash
npm install          # 의존성 설치
npm run build        # TypeScript 컴파일 (dist/)
npm run dev          # tsx로 개발 실행
npm test             # vitest 테스트
node dist/cli.js     # 직접 실행
npx .                # 로컬 npx 테스트
```

### Storage Adapter 패턴

`StorageAdapter` 인터페이스로 DB 교체 가능. 기본은 `SqlJsAdapter` (sql.js WASM SQLite).
인터페이스에 `DailyReport` 타입 포함 — `saveDailyReport`, `getDailyReport`, `getDailyReportsByRange` 등.

### DB 스키마 (v3) — 5개 테이블

| 테이블 | 역할 |
|--------|------|
| `sessions` | 세션별 작업 기록 (22개 컬럼 — 토큰, 시간, 타이틀, 설명, 모델 등) |
| `gather_reports` | raw 수집 기록 (CLI 자동 생성, 마크다운 + JSON) |
| `daily_reports` | AI 요약 보고서 (Claude Code 생성), UNIQUE(report_date, report_type) |
| `checkpoints` | 갈무리 포인트 (마지막 처리 timestamp) |
| `config` | 설정 (이메일, SMTP, schema_version 등) |

자동 마이그레이션: v1 → v2 → v3 (applySchema에서 버전 체크)

### 데이터 흐름

```
~/.claude/history.jsonl  ──→  세션 목록 추출 (sessionId + project)
                                    │
~/.claude/projects/*/[id].jsonl  ──→  토큰/모델/대화 턴 추출
                                    │
                             그룹핑 + 통계 집계
                                    │
                     ┌──────────────┼──────────────┐
                     ▼              ▼              ▼
              터미널 테이블    DB 저장 (암호화)    --json 출력
                                                      │
                                                Claude Code
                                                AI 요약 생성
                                                      │
                                                save-daily
                                               (daily_reports)
                                                      │
                                    ┌─────────────────┼─────────────┐
                                    ▼                 ▼             ▼
                              이메일 발송     report --week    report --month
```

### 한국어 우선

- 코드 주석과 커밋 메시지는 한국어 또는 영어 모두 허용
- 사용자 대면 메시지(CLI 출력, 리포트)는 한국어 기본, 영어 옵션 지원 고려
- CLAUDE.md 및 문서는 한국어 우선

## Key Considerations

- `~/.claude/history.jsonl`의 포맷은 Claude Code 버전에 따라 변경될 수 있음 — 파서는 방어적으로 작성
- 대화 히스토리 파일은 매우 클 수 있음(수백 MB) — 스트리밍 파싱 필수
- 개인 작업 기록이므로 민감 정보(대화 내용 전체) 저장 시 주의 필요 — 요약/메타데이터만 저장하는 것이 기본
- 기본 갈무리 범위는 항상 오늘 00:00부터 (체크포인트 기반 아님, upsert로 중복 방지). `--since` 옵션으로 별도 시점 지정 가능
- DB 저장 위치: `~/.sincenety/sincenety.db` — 여러 프로젝트를 아우르므로 홈 디렉토리 기반
- DB는 AES-256-GCM으로 암호화됨 — `file` 명령으로 열면 `data`로 표시되어야 정상
- Claude Code skill은 `~/.claude/skills/sincenety/SKILL.md`에 등록됨
