# sincenety

> **[English Documentation (README.md)](./README.md)** | **[샘플 리포트](https://pathcosmos.github.io/sincenety/sample-report.html)** | **[CLI 리포트 (Workers AI)](https://pathcosmos.github.io/sincenety/sample-report-cli.html)**

**Claude Code 작업 갈무리 도구** — 3단계 파이프라인으로 Claude Code 작업 이력을 자동 수집, 요약, 보고합니다.

start/stop 없이, 실행 시점에 소급하여 모든 작업을 자동 정리합니다.

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

> **참고**: v0.7.0부터 CLI 출력이 모두 영문으로 변경되었습니다.

---

## 핵심 기능

### 기본 명령: 전체 파이프라인

**v0.7.0** — `sincenety`를 인자 없이 실행하면 **air → circle → out** 전체 파이프라인이 자동으로 실행됩니다. D1 또는 이메일이 미설정이면 help + 설정 안내를 표시합니다.

### 3단계 파이프라인: air → circle → out

개별 단계로도 실행 가능합니다:

1. **`sincenety air`** (환기) — 기록 수집/저장
   - 날짜별 그룹핑 (자정 경계, startedAt 기준)
   - 자동 백필: checkpoint 기반, 빈 날짜도 수집
   - 변경 감지: data hash로 미변경 스킵
   - 빈 날짜 기록 (세션 없어도 기록 생성)
   - `--json` 옵션으로 날짜별 JSON 출력

2. **`sincenety circle`** (순환 정화) — LLM 요약
   - 내부적으로 `air` 자동 실행
   - `--json`: 요약 필요 데이터 출력 (SKILL.md 연동)
   - `--save`: stdin JSON → daily_reports 저장
   - `--type daily|weekly|monthly`
   - 자동 완료 처리: 자정→전날확정, 월요일→전주확정, 1일→전월확정
   - 변경 감지: data hash 비교로 토큰 절약
   - 휴가일에 [vacation] 라벨 자동 부여
   - **프로젝트 단위 세션 통합 요약**: 같은 `projectName`의 모든 세션을 개별 요약 후 프로젝트별 통합 재요약 — 중복 제거 및 리포트 품질 향상

3. **`sincenety out`** — 스마트 이메일 발신
   - `out`: 일일보고 항상 발송, 금요일에 +주간보고, 월말에 +월간보고
   - 미발송 캐치업: 금요일 놓치면 → 월요일에 주간보고 자동 발송
   - 4가지 provider: Gmail MCP / Resend / Gmail SMTP / Custom SMTP
   - `outd` / `outw` / `outm`: 일일 / 주간 / 월간 강제 발신
   - `--preview`, `--render-only`, `--history`

### CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `sincenety` | **전체 파이프라인** — air → circle → out 한 번에 실행 |
| `sincenety air` | 환기 -- 날짜별 자동 백필 수집 |
| `sincenety circle` | 순환 정화 -- LLM 요약 (--json/--save/--type) |
| `sincenety out` | 스마트 발신 (요일+캐치업 자동) |
| `sincenety outd` | 강제 일일 발신 |
| `sincenety outw` | 강제 주간 발신 |
| `sincenety outm` | 강제 월간 발신 |
| `sincenety sync` | D1 중앙 동기화 |
| `sincenety config` | 설정 (--setup, --vacation, --d1-*) |

### 소급 갈무리

별도 기록 행위 없이, `sincenety` 실행 시 `~/.claude/` 데이터를 분석하여 프로젝트별/세션별 작업 내용을 자동 재구성합니다.

- **대화 턴 분석** — 사용자 입력 + 어시스턴트 응답 쌍(`conversationTurns`)을 함께 수집하여 정밀한 작업 내용 파악
- **세션 JSONL 파싱** — `~/.claude/projects/[project]/[sessionId].jsonl`에서 토큰 사용량, 모델명, 정밀 타임스탬프, 대화 턴 추출
- **checkpoint 기반 백필** — 마지막 checkpoint 이후 자동 수집; 첫 실행 시 90일 백필

### 풍부한 작업 기록

| 항목 | 설명 |
|------|------|
| 작업 타이틀 | 첫 사용자 메시지에서 자동 추출 |
| 작업 설명 | 주요 사용자 메시지 3~5개 연결 |
| 토큰 사용량 | 입력/출력/캐시 토큰 메시지별 합산 |
| 작업 시간 | 첫 메시지 ~ 마지막 메시지 정밀 측정 |
| 사용 모델 | assistant 응답에서 모델명 추출 |
| 카테고리 | 프로젝트 경로 기반 자동 분류 |

### AI 요약 엔진

통합 AI provider 시스템 — **`ai_provider` 설정이 모든 환경(CLI, cron, Claude Code)에서 존중됩니다**:

| `ai_provider` | `circle` 자동 요약 | `gatherer` 요약 | 사용 시나리오 |
|----------------|-------------------|-----------------|-------------|
| `cloudflare` | Workers AI (Qwen3-30B) → 실패 시 휴리스틱 | Workers AI | CLI / cron |
| `anthropic` | 스킵 (자동 요약 없음) | Claude API (Haiku) | API 키 보유 시 |
| `claude-code` | 스킵 (SKILL.md가 직접 처리) | 휴리스틱 | Claude Code `/sincenety` |
| `auto` (기본값) | 자동 감지: cloudflare만 해당 | 자동 감지 | 초기 설정 |

```bash
# AI provider 설정 (모든 환경에서의 동작 제어)
sincenety config --ai-provider cloudflare   # Workers AI 사용
sincenety config --ai-provider anthropic    # Claude API 사용
sincenety config --ai-provider claude-code  # Claude Code 직접 요약 (SKILL.md)
sincenety config --ai-provider auto         # 자동 감지 (기본값)
```

- **Cloudflare Workers AI (Qwen3-30B)** 한국어 텍스트 요약 특화
- D1 토큰만 있으면 자동 활성화 — 별도 API 키 불필요
- `circle` 실행 시 `ai_provider`가 `cloudflare`일 때 자동 요약: 세션별 topic/outcome/flow/significance + 일일 overview
- `circle --json --summarize`: Workers AI 요약을 JSON에 포함 (`ai_provider = cloudflare` 필요)
- 무료 tier: 10,000 neurons/일 (개인 사용 충분, 하루 ~300회 요약 가능)
- **휴리스틱 fallback**: Workers AI 개별 세션 호출 실패 시 휴리스틱 요약으로 대체 (데이터 손실 없음)

### 이메일 AI 요약 통합

이메일 보고서에 `daily_reports`의 AI 요약이 포함됩니다:
- **overview 섹션**: 이메일 최상단에 하루 종합 요약
- **세션별 매핑**: `daily_reports` wrapUp 데이터가 각 세션의 topic/outcome/flow/significance에 매핑
- **Gmail 102KB 클립 방지**: 세션당 actions를 최대 5건으로 제한, 텍스트 길이 최적화

### 필수 설정 (Mandatory)

sincenety는 모든 커맨드 실행 전 **두 가지 설정**을 필수로 요구합니다:

1. **D1 클라우드 동기화** — Cloudflare API 토큰 (Workers AI + 클라우드 동기화 활성화)
2. **이메일 발송** — SMTP 또는 Resend (보고서 이메일 발송)

```bash
# 1단계: D1 토큰 (계정 자동 감지, DB 생성, Workers AI 활성화)
sincenety config --d1-token <API_TOKEN>

# 2단계: 이메일 설정 (대화형 위저드)
sincenety config --setup
# → Gmail 앱 비밀번호: https://myaccount.google.com/apppasswords
```

미설정 시 `config` 외 모든 커맨드가 차단됩니다.

### 휴가 관리

- **Google Calendar 자동 감지** — SKILL.md가 Claude Code에게 Google Calendar 휴가 이벤트 확인 지시
- **CLI 수동 등록** — `config --vacation 2026-04-10 2026-04-11`
- **휴가 키워드** (한국어 + 영어): 휴가/vacation/연차/PTO/병가/sick/반차/half-day
- **휴가 유형**: vacation / sick / holiday / half / other
- **보고서 연동** — `circle`에서 휴가일에 [vacation] 라벨 표시, `out`은 휴가일 자동 스킵

### 설정 위저드

`sincenety config --setup`으로 대화형 3선택 위저드 실행:
1. Gmail SMTP (앱 비밀번호 URL 안내 포함)
2. Resend API
3. Custom SMTP

설정 완료 시 연결 테스트 자동 실행.

### Gmail MCP 연동

Claude Code 안에서 `gmail_create_draft` MCP 도구로 zero-config 이메일 발송. SMTP 자격증명 불필요 — Claude Code가 Gmail에 직접 초안 작성. `out --render-only`로 MCP 경로용 HTML 출력.

### 설정 관리

`sincenety config`를 인자 없이 실행하면 ANSI 설정 상태 테이블을 표시합니다. 휴가 등록, 이메일 provider 선택 (Gmail/Resend/custom SMTP) 등을 지원합니다.

### 범위 선택 (Global / Project)

이 기기의 **모든 프로젝트**를 추적할지, **특정 프로젝트만** 추적할지 선택합니다:

- **Global 모드** — 모든 Claude Code 세션 수집
- **Project 모드** — 특정 프로젝트 경로의 세션만 필터링

초기 설정 시(`npm install -g`) 또는 첫 `npx sincenety` 실행 시 선택. `~/.sincenety/scope.json`에 저장됩니다.

### 클라우드 동기화 (Cloudflare D1)

Cloudflare D1을 통한 멀티머신 데이터 통합:

- **로컬 우선**: 암호화된 로컬 DB가 원본 (source of truth)
- **`sincenety sync`**로 로컬 데이터를 중앙 D1 데이터베이스에 push (push / pull-config / status / init)
- **자동 동기화**: `out` 완료 후 자동 sync (non-fatal -- 네트워크 오류가 이메일 발송을 차단하지 않음)
- **공유 설정**: SMTP 설정 한 번이면 `sync --pull-config`로 새 머신에서 즉시 사용
- **머신 ID**: 하드웨어 기반 자동 감지 (아래 참조), `config --machine-name`으로 커스텀 식별
- **의존성 무추가**: D1 REST API는 native `fetch` 사용 -- 새 패키지 없음

### 파이프라인 모드 스위치 & 주간/월간 베이스라인 자동 생성

**v0.8.4** — `out`/`outd`/`outw`/`outm` 실행 시 DB에 **항상** 최신 weekly/monthly 베이스라인이 존재하도록 보장하여, `outw`/`outm`이 빈 결과를 내던 구조적 공백을 해소합니다:

- **베이스라인 자동 생성**: 매 실행마다 이번 주(월~일)와 이번 달(1일~말일)의 `daily_reports`를 모아 프로젝트 단위 통합 후 weekly/monthly row를 upsert
- **발송본 보호**: `emailedAt != null`인 row는 절대 덮어쓰지 않아 이미 발송된 보고서의 무결성 보장
- **`--mode=full|smart` 스위치**: `full`(기본)은 매 실행마다 베이스라인 재생성, `smart`는 v0.8.3 동작 유지(금요일에만 weekly, 말일에만 monthly — 토큰 절약)
- **config 기본값**: `sincenety config --pipeline-mode <full|smart>`로 영구 기본값 설정 가능
- **묵음 실패 차단**: auto-summary 실패를 `CircleResult.summaryErrors`로 구조화하고, `runOut`이 이를 `result.errors`로 승격, CLI가 `process.exitCode = 1`로 전파 — cron 환경에서 weekly/monthly 재생성 실패를 exit code로 감지 가능
- **`emailedAt === 0` falsy 가드 수정**: 명시적 `!= null` 비교로 발송된 보고서의 엣지 케이스 덮어쓰기 방지
- **JSON.parse 경고 출력**: 손상된 `summaryJson`이 있는 daily row는 실패한 `reportDate`를 명시하는 warn을 출력. 이전처럼 조용히 데이터가 사라지지 않음

### 크로스 디바이스 통합 리포트

**v0.8.0** — 여러 기기(예: Mac + Linux)에서 작업하면 모든 기기의 세션이 자동으로 하나의 일일보고로 합쳐집니다:

- **Push-before-pull**: 내 데이터를 D1에 먼저 올린 후, 다른 기기의 세션을 가져와 통합
- **Circle 크로스 디바이스 머지**: `circle`(AI 요약) 단계에서 D1의 다른 기기 세션을 pull하여 전체 기기의 작업을 통합 요약 — 로컬 작업만이 아닌 모든 기기의 작업을 포괄
- **무조건 발신 정책**: `out`은 다른 기기에서 이미 발송했더라도 항상 이메일 발신 — skip 없음, 중복 체크 없음
- **세션 제목 머지**: 같은 `프로젝트명 + 제목`의 세션을 자동 머지 — 통계 합산, 가장 상세한 wrapUp 채택, flow 서술 연결
- **Graceful fallback**: D1 연결 불가 시 기존 단일 기기 동작으로 자연스럽게 전환
- **타이틀 추출 개선**: 슬래시 명령(/sincenety 등)으로 시작하는 세션에 의미 있는 폴백 제목 부여

### Cloudflare API Token 발급 방법

1. **토큰 생성 페이지 접속**: [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. **"Create Token"** → **"Custom token"** (맨 아래 "Get started") 선택
3. **권한 설정**:

| 권한 | 접근 수준 | 용도 |
|------|----------|------|
| 계정 / **D1** | **Edit** | DB 생성 + 읽기/쓰기 |
| 계정 / **Workers AI** | **Read** | AI 요약 모델 호출 (Qwen3-30B) |
| 계정 / **계정 설정** | **Read** | 계정 자동 탐지 (`--d1-token` 설정 시) |

> **3개 모두 필수입니다.** 계정 설정 Read가 없으면 `--d1-token`으로 자동 설정 시 계정을 찾을 수 없습니다.

4. **Account Resources** → Include → 본인 계정 선택
5. **"Create Token"** → 토큰 복사 (**한 번만 표시됩니다!**)

> 이 토큰 하나로 D1 (중앙 DB) + Workers AI (요약 엔진) + sync (동기화)가 전부 동작합니다. 별도 API 키가 필요 없습니다.

### Token-Only D1 설정

토큰 하나면 나머지는 전부 자동:

```bash
sincenety config --d1-token cfp_xxxxxxxx
# ✅ Account auto-detected
# ✅ D1 database auto-created/connected
# ✅ machine_id auto-detected (hardware UUID-based)
# ✅ Workers AI auto-enabled (Qwen3-30B)
# ✅ D1 schema setup complete!
```

### 자동 머신 ID

하드웨어 기반 머신 식별 — 설정 불필요:

| 플랫폼 | 소스 | 특성 |
|--------|------|------|
| macOS | IOPlatformUUID | 하드웨어 고유, 재설치 불변 |
| Linux | /etc/machine-id | OS 고유 |
| Windows | MachineGuid | 설치 고유 |

- **포맷**: `mac_a1b2c3d4_username`
- 사용자가 아무것도 안 해도 자동 감지
- 같은 기기면 항상 같은 ID
- D1 동기화 머신 레지스트리 (`machines` 테이블)에서 사용

### 암호화 저장

모든 데이터는 AES-256-GCM으로 암호화되어 `~/.sincenety/sincenety.db`에 저장됩니다. 머신 바운드 키(hostname + username + 랜덤 salt)를 기본으로 사용합니다.

---

## 설치 및 사용

sincenety 실행 방법은 두 가지입니다: **npx** (설치 없음) 또는 **글로벌 설치**.

### 방법 A: npx (처음 사용 / 원샷 실행 권장)

> **첫 실행 시 세 가지 플래그가 모두 필수입니다.** 없으면 설정 안내만 표시하고 종료합니다.

**사전 준비 — 토큰 2개를 먼저 발급하세요:**

1. **Cloudflare D1 API Token** — [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   - Custom token 생성, 아래 권한 3개 필수:

   | 권한 | 액세스 | 용도 |
   |------|--------|------|
   | Account / **D1** | **Edit** | DB 생성 + 읽기/쓰기 |
   | Account / **Workers AI** | **Read** | AI 요약 (Qwen3-30B) |
   | Account / **Account Settings** | **Read** | 계정 자동 탐지 |

2. **Resend API Key** — [resend.com/api-keys](https://resend.com/api-keys)
   - 무료: 100통/일 (일일보고에 충분)

**실행:**

```bash
npx sincenety --token <D1_TOKEN> --key <RESEND_KEY> --email you@example.com
```

이 한 줄로:
- D1 토큰 저장 → Cloudflare 계정 자동 감지 → DB 생성 → 스키마 설정
- Resend API 키 + 수신 이메일 저장
- 전체 파이프라인 실행: **air → circle → out**

**이후 실행** — 설정이 `~/.sincenety/`에 저장되므로:

```bash
npx sincenety
```

### 방법 B: 글로벌 설치 (일상적 사용 권장)

```bash
npm install -g sincenety@latest
```

설치 후 대화형 셋업 위저드가 자동 실행됩니다:

```
  ┌──────────────────────────────────────────────┐
  │  sincenety — Initial Setup                   │
  └──────────────────────────────────────────────┘

  ── Step 1/3: Scope ─────────────────────────────
    1) Global   — 이 기기의 모든 Claude Code 프로젝트 추적
    2) Project  — 특정 프로젝트만 추적

  ── Step 2/3: D1 Cloud Sync ─────────────────────
    Cloudflare API 토큰 생성 가이드 포함:
      Account | Workers AI       | Read
      Account | D1               | Edit
      Account | Account Settings | Read

  ── Step 3/3: Email Delivery ────────────────────
    1) Gmail SMTP  (앱 비밀번호 필요)
    2) Resend API  (resend.com API 키)
    3) Custom SMTP
```

설정 완료 후:

```bash
sincenety
```

> **참고**: 셋업 위저드는 최초 설치 시에만 실행됩니다. 이후 업데이트 시 기존 설정이 유지됩니다. CI/Docker 등 비대화형 환경에서는 위저드가 스킵되며, `sincenety config --setup`으로 수동 설정할 수 있습니다.

### 소스 빌드

```bash
git clone https://github.com/pathcosmos/sincenety.git
cd sincenety
npm install && npm run build
npm link
```

### 설정 확인

```bash
sincenety config
# 모든 설정을 ✅/❌ 상태로 표시
# AI summary: ai_provider = auto (auto → cloudflare)
```

### 기본 — 전체 파이프라인

```bash
# 전체 파이프라인 실행: air → circle → out
sincenety

# D1 또는 이메일 미설정 시 help + 설정 안내 표시
```

### air — 기록 수집

```bash
# 갈무리 (checkpoint 기반 백필, 첫 실행 = 90일)
sincenety air

# 커스텀 history.jsonl 경로 지정
sincenety air --history /path/to/history.jsonl

# JSON 출력 (날짜별 구조화 데이터)
sincenety air --json
```

### circle — AI 요약 파이프라인

```bash
# air 실행 + finalization 상태 확인
sincenety circle

# AI 요약용 세션 데이터 JSON 출력 (SKILL.md 연동)
sincenety circle --json

# Workers AI 요약 포함 JSON 출력 (SKILL.md cloudflare 모드)
sincenety circle --json --summarize

# AI가 생성한 요약을 DB에 저장 (stdin JSON)
sincenety circle --save < summary.json
sincenety circle --save --type weekly < weekly_summary.json
sincenety circle --save --type monthly < monthly_summary.json
```

### config — 설정 관리

```bash
# 대화형 설정 위저드 (Gmail SMTP / Resend / Custom SMTP)
sincenety config --setup

# 현재 설정 상태 표시 (ANSI 테이블)
sincenety config

# 이메일 설정
sincenety config --email you@gmail.com
sincenety config --smtp-user sender@gmail.com
sincenety config --smtp-pass       # 프롬프트에서 비밀번호 입력
sincenety config --provider resend
sincenety config --resend-key rk_...

# AI provider (Claude Code 환경 제어)
sincenety config --ai-provider cloudflare   # Workers AI
sincenety config --ai-provider anthropic    # Claude API
sincenety config --ai-provider claude-code  # Claude Code 직접 요약
sincenety config --ai-provider auto         # 자동 감지 (기본값)

# 휴가 관리
sincenety config --vacation 2026-04-10 2026-04-11
sincenety config --vacation-list
sincenety config --vacation-clear 2026-04-10
```

> Gmail 앱 비밀번호 생성: https://myaccount.google.com/apppasswords

### out — 스마트 이메일 발신

```bash
# 스마트 발신 (요일 + 미발송 캐치업 자동 판단)
sincenety out

# 미리보기 (발송 안 함)
sincenety out --preview

# HTML JSON 출력 (Gmail MCP용)
sincenety out --render-only

# 발송 내역 조회
sincenety out --history

# 강제 발신
sincenety outd    # 일일보고
sincenety outw    # 주간보고
sincenety outm    # 월간보고

# 특정 날짜 지정 (yyyyMMdd)
sincenety outd --date 20260408   # 4월 8일 일간보고
sincenety outw --date 20260408   # 4월 6-12일 주간보고
sincenety outm --date 20260408   # 2026년 4월 월간보고
sincenety out --date 20260408    # 4월 8일 기준 스마트 발신
```

### sync — 클라우드 동기화 (Cloudflare D1)

```bash
# D1 설정
sincenety config --d1-account ACCOUNT_ID --d1-database DB_ID --d1-token TOKEN
sincenety config --machine-name "office-mac"

# 동기화
sincenety sync --init          # D1 스키마 생성
sincenety sync                 # 로컬 → D1 push
sincenety sync --pull-config   # D1 → 로컬 공유 설정
sincenety sync --status        # 상태 확인
```

### Claude Code Skill (`/sincenety`)

Claude Code 안에서 `/sincenety`로 직접 호출하여 AI 기반 일일보고를 생성합니다.

#### 설치

1. **CLI 설치** (데이터 수집 엔진):

```bash
npm install -g sincenety@latest
```

2. **Skill 등록** (Claude Code에 `/sincenety` 명령 등록):

```bash
mkdir -p ~/.claude/skills/sincenety
cp node_modules/sincenety/src/skill/SKILL.md ~/.claude/skills/sincenety/SKILL.md
```

또는 글로벌 설치인 경우:

```bash
mkdir -p ~/.claude/skills/sincenety
cp "$(npm root -g)/sincenety/src/skill/SKILL.md" ~/.claude/skills/sincenety/SKILL.md
```

3. **최신 버전 업데이트**:

Claude Code 안에서:
```
! npm install -g sincenety@latest
```

#### 동작 원리

Claude Code에서 `/sincenety` 입력 시:

1. **데이터 수집** — `air`가 checkpoint 기반 백필로 모든 세션 수집
2. **JSON 출력** — `circle --json`이 대화 턴 포함 세션 데이터 출력
3. **AI 요약** — Claude Code 자체가 topic/outcome/flow/significance 생성
4. **DB 저장** — `circle --save`로 `daily_reports` 테이블에 저장
5. **이메일 발송** — 설정 시 AI 요약이 반영된 HTML 이메일 발송

핵심: Claude Code **자체가** AI이므로 외부 API 키가 필요 없습니다.

#### 이메일 설정 (선택)

```bash
sincenety config --email you@gmail.com
sincenety config --smtp-user you@gmail.com
sincenety config --smtp-pass    # Gmail 앱 비밀번호 입력 프롬프트
```

> Gmail 앱 비밀번호 생성: https://myaccount.google.com/apppasswords

---

## 아키텍처

```
sincenety/
├── src/
│   ├── cli.ts                  # CLI 진입점 (default + air/circle/out/outd/outw/outm/sync/config)
│   ├── postinstall.ts          # postinstall 셋업 위저드 (scope → D1 → email)
│   ├── core/
│   │   ├── air.ts              # Phase 1: 날짜별 갈무리 (백필 + 해시)
│   │   ├── circle.ts           # Phase 2: LLM 요약 파이프라인 (finalization + 저장)
│   │   ├── out.ts              # Phase 3: 스마트 이메일 발신 (out/outd/outw/outm)
│   │   ├── gatherer.ts         # 갈무리 핵심 로직 (파싱→그룹핑→저장)
│   │   ├── summarizer.ts       # AI 요약 라우터 (Workers AI / Claude API / 휴리스틱)
│   │   └── ai-provider.ts      # AI provider 감지 및 라우팅 (cloudflare/anthropic/claude-code)
│   ├── parser/
│   │   ├── history.ts          # ~/.claude/history.jsonl 스트리밍 파서
│   │   └── session-jsonl.ts    # 세션 JSONL 파서 (토큰/모델/타이밍/대화턴 추출)
│   ├── grouper/
│   │   └── session.ts          # sessionId+project 기준 그룹핑
│   ├── storage/
│   │   ├── adapter.ts          # StorageAdapter 인터페이스
│   │   └── sqljs-adapter.ts    # sql.js 구현 (암호화 DB, v4 자동 마이그레이션)
│   ├── encryption/
│   │   ├── key.ts              # PBKDF2 키 파생 (머신 바운드 + passphrase)
│   │   └── crypto.ts           # AES-256-GCM encrypt/decrypt
│   ├── report/
│   │   ├── terminal.ts         # 터미널 테이블 출력 (유니코드 박스 드로잉, 영문 출력)
│   │   └── markdown.ts         # 마크다운 리포트 생성
│   ├── email/
│   │   ├── sender.ts           # nodemailer 이메일 발송
│   │   ├── renderer.ts         # HTML 이메일 렌더러 (보고서 → HTML, 크로스 디바이스 머지)
│   │   ├── merge-sessions.ts   # 세션 머지 유틸리티 (프로젝트 단위 세션 통합)
│   │   ├── resend.ts           # Resend API 이메일 provider
│   │   ├── provider.ts         # 이메일 provider 추상화 (Gmail MCP/Resend/SMTP)
│   │   └── template.ts         # Bright 컬러코딩 HTML 이메일 템플릿
│   ├── vacation/
│   │   ├── manager.ts          # 휴가 CRUD (등록/조회/삭제/확인)
│   │   └── detector.ts         # 휴가 키워드 감지 (한국어+영어)
│   ├── config/
│   │   ├── setup-wizard.ts     # 대화형 3선택 설정 위저드
│   │   └── scope.ts            # 범위 설정 (global/project) 읽기/쓰기/프롬프트
│   ├── cloud/
│   │   ├── d1-client.ts        # Cloudflare D1 REST API 클라이언트
│   │   ├── d1-schema.ts        # D1 스키마 정의 및 마이그레이션
│   │   ├── d1-auto-setup.ts    # Token-only 자동 설정 (계정/DB 감지)
│   │   ├── cf-ai.ts            # Cloudflare Workers AI 클라이언트 (Qwen3-30B)
│   │   └── sync.ts             # 동기화 로직 (push/pull/status/init)
│   ├── util/
│   │   └── machine-id.ts       # 크로스플랫폼 하드웨어 ID 감지
│   ├── scheduler/
│   │   └── install.ts          # launchd/cron 자동 설치 (비활성화)
│   └── skill/SKILL.md          # Claude Code skill 정의
├── tests/
│   ├── encryption.test.ts      # 암호화 테스트 (26개)
│   ├── migration-v4.test.ts    # DB v3→v4 마이그레이션 테스트 (7개)
│   ├── air.test.ts             # air 명령 테스트 (7개)
│   ├── circle.test.ts          # circle 명령 테스트 (10개)
│   ├── out.test.ts             # out 명령 테스트 (28개)
│   ├── vacation.test.ts        # 휴가 관리 테스트 (13개)
│   ├── d1-client.test.ts       # D1 클라이언트 테스트
│   ├── sync.test.ts            # 동기화 테스트
│   ├── cf-ai.test.ts           # Cloudflare Workers AI 테스트
│   └── machine-id.test.ts      # 머신 ID 감지 테스트
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

### 설치 흐름 (Install Flow)

```
npm install -g sincenety@latest
        │
        ▼
┌─ postinstall.js ─────────────────────────────────┐
│                                                   │
│  TTY 체크 ───→ TTY 없음? → "config --setup 실행"  │
│       │                                           │
│       ▼ (TTY 있음)                                │
│  이미 설정 완료? ──→ 예 → "설정 유지됨"             │
│       │                                           │
│       ▼ (아니오)                                   │
│                                                   │
│  Step 1: 범위 선택                                 │
│  ┌────────────────────────┐                       │
│  │ 1) Global (전체)       │                       │
│  │ 2) Project (특정 경로) │                       │
│  └───────┬────────────────┘                       │
│          │ → ~/.sincenety/scope.json              │
│          ▼                                        │
│  Step 2: D1 클라우드 동기화                        │
│  ┌────────────────────────┐                       │
│  │ D1 API 토큰 입력       │                       │
│  │ → autoSetupD1()        │                       │
│  │ → ensureD1Schema()     │                       │
│  └───────┬────────────────┘                       │
│          │ → ~/.sincenety/sincenety.db            │
│          ▼                                        │
│  Step 3: 이메일 설정                               │
│  ┌────────────────────────┐                       │
│  │ 1) Gmail SMTP          │                       │
│  │ 2) Resend API          │                       │
│  │ 3) Custom SMTP         │                       │
│  └───────┬────────────────┘                       │
│          │ → ~/.sincenety/sincenety.db            │
│          ▼                                        │
│  ✅ 준비 완료                                      │
└───────────────────────────────────────────────────┘
```

### 실행 흐름 (Run Flow)

```
$ sincenety [--token T --key K --email E]
        │
        ▼
   Scope 체크 ───→ 미설정? → 프롬프트 (global/project)
        │
        ▼
   파라미터 체크 ──→ D1/email 미설정? → 설정 가이드 + exit
        │
        ▼
┌─ runOut(scope) ──────────────────────────────────┐
│                                                   │
│  ┌─ air (환기) ──────────────────────────────┐    │
│  │ ~/.claude/history.jsonl                   │    │
│  │   → 세션 목록 (sessionId + project)       │    │
│  │ ~/.claude/projects/[p]/[id].jsonl         │    │
│  │   → 토큰 / 모델 / 타이밍 / 대화턴        │    │
│  │                                           │    │
│  │ scope 필터 (project 모드)                 │    │
│  │ 날짜별 그룹핑 (자정 경계)                 │    │
│  │ checkpoint 백필 + data hash               │    │
│  │   → gather_reports DB                     │    │
│  └───────────────────────────────────────────┘    │
│                 │                                 │
│                 ▼                                 │
│  ┌─ circle (순환 정화) ──────────────────────┐    │
│  │ 자동 확정 처리                            │    │
│  │   (전날 / 지난주 / 전월)                  │    │
│  │ D1 크로스 디바이스 세션 pull + 머지        │    │
│  │ Workers AI 요약 (Qwen3-30B)               │    │
│  │   → daily_reports DB (전체 기기)           │    │
│  └───────────────────────────────────────────┘    │
│                 │                                 │
│                 ▼                                 │
│  ┌─ D1 pre-sync ────────────────────────────┐     │
│  │ 로컬 → D1 push (내 데이터 먼저)          │     │
│  └──────────────────────────────────────────┘     │
│                 │                                 │
│                 ▼                                 │
│  ┌─ out (스마트 발신) ───────────────────────┐    │
│  │ daily  — 항상 발송                        │    │
│  │ weekly — 금요일 (또는 캐치업)             │    │
│  │ monthly — 월말 (또는 캐치업)              │    │
│  │ --date yyyyMMdd — 특정 날짜 지정          │    │
│  │                                           │    │
│  │ D1 크로스 디바이스 세션 pull + 머지        │    │
│  │ 프로젝트 단위 세션 머지 (×N)               │    │
│  │                                           │    │
│  │ → Gmail MCP / Resend /                    │    │
│  │   Gmail SMTP / Custom SMTP                │    │
│  └───────────────────────────────────────────┘    │
│                 │                                 │
│                 ▼                                 │
│  ┌─ D1 post-sync ───────────────────────────┐     │
│  │ 이메일 발송 로그 → D1 push               │     │
│  └──────────────────────────────────────────┘     │
│                                                   │
└───────────────────────────────────────────────────┘
        │
        ▼
   ✅ sincenety complete — N sent, N skipped
```

### 로컬 DB — 완전 명세

**파일**: `~/.sincenety/sincenety.db` (AES-256-GCM 암호화 blob, 파일 권한 `0600`, 디렉토리 권한 `0700`)
**엔진**: `sql.js` — WASM 컴파일된 SQLite. native 의존성 0. DB 파일 전체가 open 시 메모리로 복호화되고, 메모리에서 변경된 뒤, close 시 재암호화되어 전체 파일이 다시 쓰임. 디스크에 점진적 INSERT는 없으며, 매 실행마다 암호화 blob 전체가 재작성됨.
**사이드카**: `~/.sincenety/sincenety.salt` — 32바이트 암호학적 랜덤 salt. 최초 실행 시 **1회** 생성되어 PBKDF2 키 파생에 사용. 이 파일이 삭제되면 DB는 영구적으로 복호화 불가.
**DB 확인**: `file ~/.sincenety/sincenety.db` 결과가 `data`(불투명)로 나와야 정상. `SQLite 3.x database`로 나오면 암호화가 깨진 것으로 평문 유출 상태.

#### 로컬 DB를 유지하는 이유 (설계 근거)

로컬 DB는 **파생 산출물(derived artifact)**. 원천(source of truth)은 언제나 `~/.claude/history.jsonl` + `~/.claude/projects/*.jsonl`이고, 원칙적으로는 매 실행마다 원천에서 전부 재구성 가능함. 그럼에도 로컬 DB를 유지하는 이유는, 단순 파일 재구성으로는 깔끔히 해결되지 않는 세 가지 역할 때문:

1. **멱등성(Idempotency) 경계** — `sincenety`는 하루에 여러 번 실행되는 패턴(크론 10:00, 수동 15:00, 자동 일 마감)을 전제로 설계됨. `sessions`의 복합 PK `(session_id, project)`와 `daily_reports`의 `UNIQUE(report_date, report_type)` 제약이 모든 재실행을 안전하게 만듦. DB가 없다면 (a) 매 실행마다 중복 리포트/중복 이메일이 생기거나 (b) 별도 dedupe 인덱스를 디스크에 직접 유지해야 함 — 후자는 결국 "제대로 안 만든 DB"에 불과.

2. **발송 상태의 유일한 권위(authority)** — `daily_reports.emailed_at`이 "이 리포트가 이미 발송됐는가?"에 대한 단일 진실 공급원. `circle.ts`의 `autoSummarizeWeekly` / `autoSummarizeMonthly`에서 `if (existing && existing.emailedAt != null) return false`로 이미 이메일 나간 주간/월간 행이 덮어써지는 사고를 차단. `email_logs`는 append-only 감사 로그로서, 성공·실패 발송 전부가 subject/recipient/provider/error와 함께 기록됨.

3. **크로스 디바이스 머지의 피봇(pivot)** — `sync push`(발송 전)가 이 기기의 `daily_reports` 행들을 Cloudflare D1로 업로드하고, `sync pull`이 다른 기기들이 작성한 행을 내려받음. 이메일 렌더러의 머지 로직은 로컬 행과 pull한 행을 `(report_date, project_name)` 기준으로 조인하고 세션은 `(project_name, title_normalized)`로 dedupe. 로컬 DB가 없으면 "이 기기의 시점(view)"이란 개념 자체가 성립하지 않아 push 불가, 원격 행을 merge할 안정적 피봇도 없음.

**DB에 저장하지 않는 것** (의도적 선택): 대화 전문, 코드 내용, 툴 호출 payload 전체. 메타데이터(카운트·타이밍·토큰·제목·설명·짧은 요약)만 저장하여, 만에 하나 키 파생이 유출돼도 피해 범위를 제한.

**로컬 DB가 실제로 불필요한 경우**: 1기기만 사용 + 이메일 사용 안 함 + sync 사용 안 함 + `--json` 출력만 Claude Code에 파이프하는 사용자. 이 케이스에서는 DB가 비용만 추가. 그 외 (멀티 디바이스, 스케줄 발송, 주/월 롤업) 모든 사용자에게는 위 3가지 역할을 DB 없이 구현하려면 결국 처음부터 다시 만들어야 함.

#### 저장 디렉토리 구조

```
~/.sincenety/
├── sincenety.db       # 암호화된 SQLite blob (이 문서가 설명하는 대상)
├── sincenety.salt     # 32바이트 PBKDF2 salt (0600)
└── machine-id         # D1 행 귀속을 위한 안정적 기기 식별자
```

#### 암호화 엔벨롭(envelope)

```
[4B 매직 "SNCT"] [12B IV] [ciphertext (가변)] [16B GCM 인증 태그]
```

- **알고리즘**: AES-256-GCM (AEAD — 복호화 시 ciphertext 변조 검출)
- **키 파생**: PBKDF2-SHA256, **100,000 iterations**, 32바이트 출력
- **키 재료**: 기본값 `hostname ∥ username ∥ salt` (머신 바운드), 또는 사용자 지정 passphrase
- **IV**: encrypt마다 랜덤 12바이트, 동일 키에서 재사용 금지
- **인증 태그**: 16바이트, 복호화마다 검증 — 변조 시 예외 발생, **빈 DB로 조용히 폴백하지 않음**

#### 스키마 버전 — v4 (현재)

스키마 버전은 `config.value` 테이블의 `schema_version` 키에 저장. open 시 `applySchema()`가 현재 버전을 읽어 전진 전용(forward-only) 마이그레이션 실행:

| From → To | 마이그레이션 요약 |
|-----------|------------------|
| `v1 → v2` | `ALTER TABLE sessions ADD COLUMN` × 14 (토큰, 타이밍 세부, 제목, 설명, 카테고리, 태그, 모델). `gather_reports`, `config` 테이블 신규. |
| `v2 → v3` | `daily_reports` 테이블 신규 (`UNIQUE(report_date, report_type)` 제약의 AI 요약 저장소). |
| `v3 → v4` | `gather_reports`에 `report_date`, `data_hash`, `updated_at` 추가. `daily_reports`에 `status`, `progress_label`, `data_hash` 추가. `vacations`, `email_logs` 테이블 신규. `idx_gather_report_date` 유니크 인덱스 추가. |

마이그레이션은 `ALTER TABLE ADD COLUMN`만 사용(`DROP` 없음) — 신버전에서 쓴 DB를 구버전으로 내려도 깨지지 않도록. `schema_version`이 알 수 없는 값이면 "fresh install"로 간주하고 v1부터 재구축.

#### 테이블별 컬럼 상세

##### `sessions` (22컬럼) — 작업 세션 원천 레코드

복합 PK `(id, project)`. 하나의 Claude Code 세션(하나의 `sessionId` × 하나의 프로젝트 디렉토리)이 한 행. 매 갈무리 실행마다 upsert.

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `id` | TEXT NOT NULL | Claude Code `sessionId` (UUID, `~/.claude/sessions/<id>.json`에서 추출) |
| `project` | TEXT NOT NULL | 프로젝트 절대 경로 (세션 시작 시의 `cwd`) |
| `project_name` | TEXT NOT NULL | `basename(project)` — 표시용 + 동일 프로젝트 머지 키 |
| `started_at` | INTEGER NOT NULL | Unix epoch ms — 세션 첫 메시지 시각 |
| `ended_at` | INTEGER NOT NULL | Unix epoch ms — 세션 마지막 메시지 시각 |
| `duration_minutes` | REAL DEFAULT 0 | `(ended_at - started_at) / 60000`, 리포트 쿼리용 사전 계산값 |
| `message_count` | INTEGER NOT NULL DEFAULT 0 | 전체 메시지 수 (user + assistant + tool) |
| `user_message_count` | INTEGER DEFAULT 0 | 사용자 작성 메시지만 |
| `assistant_message_count` | INTEGER DEFAULT 0 | 어시스턴트 응답만 |
| `tool_call_count` | INTEGER DEFAULT 0 | 툴 호출 수 (Read, Edit, Bash, …) |
| `input_tokens` | INTEGER DEFAULT 0 | 세션 누적 |
| `output_tokens` | INTEGER DEFAULT 0 | 세션 누적 |
| `cache_creation_tokens` | INTEGER DEFAULT 0 | 프롬프트 캐시 쓰기 |
| `cache_read_tokens` | INTEGER DEFAULT 0 | 프롬프트 캐시 히트 |
| `total_tokens` | INTEGER DEFAULT 0 | 위 4개 합계를 비정규화 저장 — 리포트 집계에 직접 사용 |
| `title` | TEXT | AI 생성 또는 휴리스틱 제목 (≤80자) |
| `summary` | TEXT | 짧은 요약 (1–2문장) |
| `description` | TEXT | 세션에서 있었던 일의 상세 설명 |
| `category` | TEXT | 분류 (feat/fix/docs/refactor/chore 등) |
| `tags` | TEXT | 콤마 구분 키워드 태그 |
| `model` | TEXT | 주 사용 모델 (예: `claude-opus-4-6`, `claude-sonnet-4-6`) |
| `created_at` | INTEGER NOT NULL | DB 행 생성 ms — 세션 시간이 아님 |

**인덱스**: `idx_sessions_started` (`started_at`), `idx_sessions_project` (`project`), `idx_sessions_category` (`category`).

**쓰기 경로**: `gatherer.ts` → `INSERT … ON CONFLICT(id, project) DO UPDATE`로 세션별 UPSERT. 토큰 카운터는 **덮어쓰기**(누적 합산 아님) — 원천 JSONL이 정답.

##### `gather_reports` (실행 raw 로그)

`sincenety` 갈무리 실행의 raw 마크다운 + JSON 출력을 저장. 운영상 필수는 아니고, 감사 로그 및 `--json` 재현성 목적으로 유지.

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | 대리 키 |
| `gathered_at` | INTEGER NOT NULL | 실행 시각 (ms) |
| `from_timestamp` | INTEGER NOT NULL | 갈무리 윈도우 시작 |
| `to_timestamp` | INTEGER NOT NULL | 갈무리 윈도우 종료 |
| `session_count` | INTEGER DEFAULT 0 | 이 실행의 세션 수 |
| `total_messages` | INTEGER DEFAULT 0 | 메시지 총합 |
| `total_input_tokens` | INTEGER DEFAULT 0 | |
| `total_output_tokens` | INTEGER DEFAULT 0 | |
| `report_markdown` | TEXT | 렌더된 터미널/마크다운 리포트 |
| `report_json` | TEXT | 하류 `save-daily`에 전달되는 구조화 JSON |
| `emailed_at` | INTEGER | Deprecated — `daily_reports.emailed_at`로 대체됨 |
| `email_to` | TEXT | Deprecated |
| `report_date` | TEXT *(v4)* | `YYYY-MM-DD` (윈도우 시작일) — 유니크 인덱스에 사용 |
| `data_hash` | TEXT *(v4)* | `report_json`의 콘텐츠 해시; 입력이 같으면 해시 같음 → no-op 재작성 |
| `updated_at` | INTEGER *(v4)* | 마지막 수정 시각 ms |

**유니크 인덱스** `idx_gather_report_date` on `(report_date)` *(v4)* — 날짜당 raw 갈무리 리포트 1건, 재실행 시 같은 행을 갱신.

##### `daily_reports` (AI 요약 — 일간/주간/월간)

이메일로 나가는 콘텐츠와 크로스 디바이스 sync 교환의 권위적 원본. `(report_date, report_type)`마다 1행.

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `report_date` | TEXT NOT NULL | `YYYY-MM-DD` 앵커 (주간=월요일, 월간=1일) |
| `report_type` | TEXT NOT NULL DEFAULT `'daily'` | `daily` / `weekly` / `monthly` 중 하나 |
| `period_from` | INTEGER NOT NULL | 윈도우 시작 (ms) |
| `period_to` | INTEGER NOT NULL | 윈도우 종료 (ms) |
| `session_count` | INTEGER DEFAULT 0 | 윈도우 내 세션 수 집계 |
| `total_messages` | INTEGER DEFAULT 0 | 집계 |
| `total_tokens` | INTEGER DEFAULT 0 | 집계 |
| `summary_json` | TEXT NOT NULL | 세션별 `SummaryEntry` 배열의 직렬화 (title, overview, actions, tokens, project_name, …). 이메일 렌더러가 이 필드를 읽음. |
| `overview` | TEXT | 일/주/월 전체의 메타 요약 (2–4문장) |
| `report_markdown` | TEXT | CLI `report`용 사전 렌더된 마크다운 |
| `created_at` | INTEGER NOT NULL | 행 생성 ms |
| `emailed_at` | INTEGER | **null 체크**(`!= null`)로 덮어쓰기 가능 여부 판단. non-null = 이미 발송됨 = auto-summary가 덮어쓰면 안 됨. |
| `email_to` | TEXT | 발송된 리포트의 수신자 주소 |
| `status` | TEXT DEFAULT `'in_progress'` *(v4)* | 윈도우가 아직 열려있으면 `in_progress`, 완전히 마감되면(전날/전주/전월) `finalized`. `finalizePreviousReports`가 상태 전환을 담당. |
| `progress_label` | TEXT *(v4)* | 사람 읽기 용 상태 라벨 (예: "5/7 days of week") |
| `data_hash` | TEXT *(v4)* | 변경 감지용 콘텐츠 해시 — D1 sync는 원격 행과 해시가 같으면 push 생략 |

**제약**: `UNIQUE(report_date, report_type)` — 멱등성 보장의 핵심.
**인덱스**: `idx_daily_date`, `idx_daily_type`.

##### `checkpoints`

갈무리 실행마다 마지막 처리한 timestamp를 기록. 실제로는 현재 사용하지 않음(갈무리가 언제나 오늘 00:00부터 진행, 마지막 체크포인트 이후 증분 아님) — 하위 호환성과 향후 "incremental since N" 모드 가능성을 위해 유지.

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `timestamp` | INTEGER NOT NULL | 마지막 처리 ms |
| `created_at` | INTEGER NOT NULL | |

##### `config` (key-value 설정)

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `key` | TEXT PK | 설정 이름 |
| `value` | TEXT NOT NULL | 문자열 값 (필요 시 JSON 인코딩) |
| `updated_at` | INTEGER NOT NULL | |

알려진 키: `schema_version`, `email_to`, `smtp_user`, `smtp_pass`, `smtp_host`, `smtp_port`, `resend_key`, `d1_api_token`, `d1_account_id`, `d1_database_id`, `cf_ai_token`, `provider`, `pipeline_mode` (`smart` | `full`), `scope` (`global` | `project`).

##### `vacations`

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `date` | TEXT NOT NULL UNIQUE | `YYYY-MM-DD` |
| `type` | TEXT NOT NULL DEFAULT `'vacation'` | `vacation` / `holiday` / `sick` |
| `source` | TEXT NOT NULL DEFAULT `'manual'` | `manual` / `auto` (세션 내용에서 키워드 감지) |
| `label` | TEXT | 표시 라벨 (예: "설 연휴") |
| `created_at` | INTEGER NOT NULL | |

휴가 날짜는 `out` 실행 시 발송이 스킵됨. `date` 유니크 제약으로 중복 마킹 차단.

##### `email_logs`

모든 이메일 발송 시도의 append-only 감사 로그. 삭제하지 않음. 무한 증가하므로 필요 시 수동 절단.

| 컬럼 | 타입 | 역할 |
|------|------|------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `sent_at` | INTEGER NOT NULL | 시도 시각 ms |
| `report_type` | TEXT NOT NULL | `daily` / `weekly` / `monthly` |
| `report_date` | TEXT NOT NULL | 리포트의 `YYYY-MM-DD` |
| `period_from` | TEXT NOT NULL | 윈도우 시작 (ISO date) |
| `period_to` | TEXT NOT NULL | 윈도우 종료 (ISO date) |
| `recipient` | TEXT NOT NULL | 수신자 주소 |
| `subject` | TEXT NOT NULL | 렌더된 제목 |
| `body_html` | TEXT | 렌더된 HTML (실패 발송 시 null 가능) |
| `body_text` | TEXT | 플레인텍스트 fallback 본문 |
| `provider` | TEXT NOT NULL | `gmail-smtp` / `resend` / `gmail-mcp` |
| `status` | TEXT NOT NULL DEFAULT `'sent'` | `sent` / `failed` |
| `error_message` | TEXT | `status = 'failed'`일 때의 에러 상세 |

**인덱스**: `idx_email_logs_sent` (`sent_at`), `idx_email_logs_report` (`report_date, report_type`).

#### 읽기 경로 (DB가 실제로 어디에 쓰이나)

| 명령 | 읽는 테이블 | 용도 |
|------|------------|------|
| `sincenety` (default) | `sessions`, `daily_reports`, `vacations`, `email_logs`, `config` | 풀 파이프라인 — 갈무리 → 요약 → 렌더 → 발송 |
| `air` | `sessions`, `gather_reports` | Phase 1만 — 수집 & 저장 |
| `circle` | `sessions`, `daily_reports` | Phase 2만 — AI 요약 + finalize |
| `out` / `outd` / `outw` / `outm` | `daily_reports`, `email_logs`, `vacations`, `config` | Phase 3만 — 스마트 이메일 발송 |
| `report --date` / `--week` / `--month` | `daily_reports` | 저장된 요약을 터미널로 렌더 |
| `sync push` | `daily_reports`, `config` | 내 행을 D1으로 업로드 |
| `sync pull` | `daily_reports`, `config` | 다른 기기의 행을 내려받아 머지 |
| `config` | `config` | 설정 조회/수정 |
| `vacation` | `vacations` | 휴가 날짜 CRUD |

**현재 미지원(알려진 갭)**: `sessions.title/description` 전문 검색, 프로젝트 단위 집계 뷰, 타임라인/히트맵 쿼리. 데이터는 이미 저장 중이고, 읽기 경로만 없음 — 향후 작업 후보.

#### 백업과 복구

- **백업 대상 아님** — DB는 `~/.claude/`에서 파생된 것. 손실되면 `sincenety --since "2026-04-01"`로 원천에서 재구축.
- **예외**: `daily_reports.summary_json` (AI 요약)과 `email_logs`는 `~/.claude/`만으로는 **복원 불가** — LLM 요약 재실행이 필요하고 토큰 비용이 들어감. 이 두 테이블만 유의미한 백업 대상. Cloudflare D1 sync가 `daily_reports`의 원격 백업 역할.
- **재해 복구 절차**: `sincenety.db` + `sincenety.salt` 삭제 → 재설치 → 재실행. 과거 email_logs와 LLM 이전 요약은 유실, 세션 메타데이터만 `~/.claude/`에서 재구축됨.

---

## 기술 스택

| 구성요소 | 기술 |
|---------|------|
| 언어 | TypeScript (ESM, Node16 모듈) |
| 런타임 | Node.js >= 18 |
| CLI | commander |
| DB | sql.js (WASM SQLite, native 의존성 없음) |
| 암호화 | Node.js 내장 crypto (AES-256-GCM) |
| 이메일 | nodemailer (Gmail SMTP), Resend API |
| 클라우드 | Cloudflare D1 REST API (native fetch, 추가 의존성 없음) |
| AI 요약 | Cloudflare Workers AI (Qwen3-30B), 추가 의존성 없음 |
| 테스트 | vitest (171개, 11개 테스트 파일) |

### 의존성 (최소)

```
dependencies:
  commander       # CLI 파싱
  nodemailer      # 이메일 발송
  sql.js          # WASM SQLite

devDependencies:
  typescript
  vitest
  tsx
  @types/node
  @types/nodemailer
```

---

## 개발 가이드

### 빌드 및 실행

```bash
npm install          # 의존성 설치
npm run build        # TypeScript 컴파일 (dist/)
npm run dev          # tsx로 개발 실행
npm test             # vitest 테스트 (171개)
node dist/cli.js     # 직접 실행
```

### 테스트

```bash
# 전체 테스트 (171개)
npm test

# 개별 테스트
npx vitest run tests/encryption.test.ts   # 암호화 (26개)
npx vitest run tests/migration-v4.test.ts # DB 마이그레이션 (7개)
npx vitest run tests/air.test.ts          # air 명령 (7개)
npx vitest run tests/circle.test.ts       # circle 명령 (39개)
npx vitest run tests/out.test.ts          # out 명령 (47개)
```

### 로컬 npx 테스트

```bash
npx .                # 현재 디렉토리를 npx로 실행
```

---

## 개발 이력

### v0.8.5 (2026-04-15) — `npm install -g` 시 Claude Code skill 자동 설치

#### 하이라이트

- **"다른 기기에서 `/sincenety`가 슬래시 명령 목록에 안 뜨는 문제" 수정**: v0.8.5 이전에는 `npm install -g sincenety`를 해도 CLI 바이너리만 설치될 뿐, Claude Code가 slash command를 인식하는 데 필요한 `~/.claude/skills/sincenety/SKILL.md` 파일은 **전혀 생성되지 않았음**. 원개발 기기에서만 과거 수동 복사로 존재했던 것이고, 신규 설치 기기에서는 `/sincenety`가 목록에 나타날 수 없는 구조였음.
- **근본 원인 (두 개의 버그가 겹침)**:
  1. `package.json`의 `files` 화이트리스트가 `["dist"]`뿐이어서, **`src/skill/SKILL.md`가 npm 패키지 tarball에 아예 포함되지 않음**. postinstall이 복사하려 해도 원본 파일 자체가 설치된 경로에 존재하지 않는 상태.
  2. `src/postinstall.ts`에 **skill 복사 로직이 0줄**. grep으로 `skill|SKILL|.claude` 패턴 매치 0건 확인. 기존 postinstall은 D1/SMTP 셋업 위저드였고, 비-TTY 환경에서는 한 줄 안내만 출력하고 즉시 종료 — 어떤 환경에서도 skill 등록 단계가 실행된 적 없음.

#### 주요 변경

- **`package.json`의 `files`**: `["dist", "src/skill/SKILL.md"]` — 발행되는 npm tarball에 skill 정의 파일을 포함시켜 설치자에게 전달.
- **`src/postinstall.ts`에 `installSkill()` 함수 신규 추가**: `import.meta.url` 기반으로 패키지 내 `SKILL.md` 경로를 2개 후보(npm 배포본 레이아웃 `<pkgRoot>/src/skill/SKILL.md`, 로컬 dev 레이아웃)로 탐색 → `~/.claude/skills/sincenety/`를 `mkdirSync({recursive: true})`로 생성 → `copyFileSync`로 복사. 전체 try/catch로 감싸서 복사 실패 시에도 CLI 설치 자체는 중단되지 않고 경고만 출력.
- **호출 위치**: `main()` 최상단, **TTY 체크 이전**에 호출. 기존 postinstall은 비-TTY에서 즉시 return하는 구조였는데 이 위치에서 skill을 설치했다면 CI/Docker/스크립트 설치 시 skill 등록이 누락됐을 것. 사용자 입력이 필요 없는 작업이므로 TTY 여부와 무관하게 항상 실행되도록 배치.

#### 검증

- 비-TTY 드라이런: `node -e "process.stdin.isTTY=false; import('./dist/postinstall.js')"` → `✓ Claude Code skill installed: /Users/.../SKILL.md` 출력, 실제 파일 10,444 bytes 확인.
- TypeScript 빌드 클린 (`tsc` 출력 0).
- 기존 테스트 영향 없음 (gatherer/summarizer/render 경로 로직 무변경).

#### 마이그레이션 참고

v0.8.4에서 업그레이드하는 원개발 기기는 SKILL.md가 동일 내용으로 덮어써짐. `/sincenety`가 누락되어 있던 신규 기기에서는 설치 후 Claude Code 재시작 시 slash command 목록에 표시됨.

---

### v0.1 (2026-04-07) — MVP

- `history.jsonl` 기반 소급 갈무리
- sql.js 암호화 DB (AES-256-GCM)
- 세션 그룹핑 (sessionId + project)
- 터미널 리포트
- Claude Code Skill 등록 (`/sincenety`)

### v0.1.1 (2026-04-07) — 보안 강화

보안 감사 결과 CRITICAL 2개 + HIGH 3개 발견, 전부 수정:
- 랜덤 salt 생성/저장 (`~/.sincenety/sincenety.salt`)
- DB/salt 파일 권한 0600, 디렉토리 0700
- 복호화 실패 시 에러 메시지 (무음 DB 교체 제거)
- CLI 입력 검증 (날짜, 경로, 빈 값)
- MariaDB URI 보안 (환경변수 참조)

### v0.2 (2026-04-07) — 풍부한 작업 기록 + 이메일 + 스케줄링

데이터소스 전환: `history.jsonl` → `~/.claude/projects/[project]/[sessionId].jsonl`

- **토큰 추적**: 메시지별 input/output/cache 토큰 합산
- **모델 추적**: assistant 응답에서 사용 모델 추출
- **정밀 타이밍**: ISO 8601 타임스탬프 기반 (밀리초 정밀도)
- **DB 스키마 v2**: sessions 14개 컬럼 추가, gather_reports/config 테이블
- **자동 마이그레이션**: v1 → v2 ALTER TABLE ADD COLUMN
- **마크다운 리포트**: 토큰/모델 포함 풍부한 리포트
- **이메일 발송**: nodemailer + Gmail SMTP
- **HTML 이메일 템플릿**: Bright 컬러코딩 대시보드
- **범위 선택**: Global (전체) / Project (특정 프로젝트) 모드
- **postinstall 셋업 위저드**: `npm install -g` 시 대화형 3단계 설정
- **날짜 지정 보고서**: `--date yyyyMMdd`로 out/outd/outw/outm 특정 날짜 발송

### v0.2.1 (2026-04-07) — 이메일 AI 요약 통합

- **이메일에 AI 요약 반영**: `daily_reports`의 AI 요약을 이메일 템플릿에 매핑
- **일일보고 overview**: 이메일 최상단에 하루 종합 요약 섹션 추가
- **Gmail 클립 방지**: actions를 세션당 최대 5건으로 제한
- **제목 개선**: "작업 갈무리" → "일일보고"로 변경

### v0.3 (2026-04-07) — AI 요약 일일보고 + 주간/월간 보고

- **기본 갈무리 범위 변경**: 항상 오늘 00:00부터 (upsert로 중복 방지)
- **대화 턴 수집**: `session-jsonl.ts`에서 사용자 입력 + 어시스턴트 응답 쌍(`conversationTurns`) 추출
- **터미널 테이블 출력**: 요약 테이블 + 세션 상세 테이블 (유니코드 박스 드로잉)
- **AI 요약 아키텍처**: `--json` 플래그로 대화 턴 포함 구조화 JSON 출력
- **summarizer.ts**: Claude API 요약 + 휴리스틱 fallback
- **일일보고 시스템**: `save-daily`, `report` (일일/주간/월간)
- **DB 스키마 v3**: `daily_reports` 테이블 추가

### v0.3.0 (2026-04-07) — air/circle 파이프라인, DB v4

CLI를 7개 명령에서 3단계 파이프라인으로 전면 재구성:

- **`air` 명령**: 날짜별 갈무리 (자정 경계, startedAt 기준), checkpoint 기반 자동 백필, data hash 변경 감지
- **`circle` 명령**: 내부적으로 air 실행 후 LLM 요약 연동, `--json`/`--save`/`--type` 옵션, 자동 finalization (전날/전주/전월 확정)
- **`config` 강화**: 인자 없이 실행 시 ANSI 설정 상태 테이블, `--vacation` 휴가 등록, `--provider`/`--resend-key` 이메일 provider 선택
- **DB 스키마 v4**: gather_reports에 report_date/data_hash/updated_at 추가, daily_reports에 status/progress_label/data_hash 추가, `email_logs`/`vacations` 테이블 신규
- **v3→v4 자동 마이그레이션**
- **테스트 50개**: encryption 26 + migration-v4 7 + air 7 + circle 10

### v0.3.1 (2026-04-07) — Plan 2: out/outd/outw/outm 스마트 발신

- **`out` 명령**: 요일 기반 스마트 발신 (일일 항상, 금요일 +주간, 월말 +월간)
- **미발송 캐치업**: 금요일 놓치면 월요일에 주간보고 자동 발송
- **4가지 email provider**: Gmail MCP / Resend / Gmail SMTP / Custom SMTP
- **`outd`/`outw`/`outm`**: 보고 타입별 강제 발신 명령
- **`--preview`**: 발송 없이 미리보기
- **`--render-only`**: HTML JSON 출력 (Gmail MCP 연동용)
- **`--history`**: 발송 내역 조회
- **`src/email/renderer.ts`**: HTML 이메일 렌더러
- **`src/email/resend.ts`**: Resend API provider
- **`src/email/provider.ts`**: provider 추상화 레이어
- **`src/core/out.ts`**: out 명령 핵심 로직
- **테스트 78개**: 기존 50 + out 28개 추가

### v0.3.2 (2026-04-07) — Plan 3: 휴가 관리, 설정 위저드, Gmail MCP

- **휴가 관리**: Google Calendar 자동 감지 (SKILL.md), CLI 수동 등록 (`config --vacation`)
- **휴가 키워드 감지**: 한국어+영어 (휴가/vacation/연차/PTO/병가/sick/반차/half-day)
- **보고서 휴가 연동**: [휴가] 라벨 표시, `out` 휴가일 자동 스킵
- **`config --setup` 위저드**: 대화형 3선택 (Gmail SMTP / Resend / Custom SMTP), 연결 테스트
- **Gmail MCP 연동**: `gmail_create_draft`로 zero-config 이메일, `out --render-only` MCP 경로
- **`src/vacation/manager.ts`**: 휴가 CRUD (등록/조회/삭제/확인)
- **`src/vacation/detector.ts`**: 휴가 키워드 감지
- **`src/config/setup-wizard.ts`**: 대화형 설정 위저드
- **테스트 91개**: 기존 78 + vacation 13개 추가

### v0.4.0 (2026-04-07) — Plan 4: Cloudflare D1 클라우드 동기화

- **`sync` 명령**: D1 push/pull/status/init
- **멀티머신 통합**: Cloudflare D1 REST API로 여러 머신의 데이터 중앙 집약
- **로컬 우선**: 암호화된 로컬 DB가 source of truth, D1은 집약 계층
- **자동 동기화**: `out` 완료 후 자동 sync
- **공유 설정**: SMTP 등 설정을 D1에 저장, `sync --pull-config`로 새 머신 즉시 설정
- **`src/cloud/d1-client.ts`**: Cloudflare D1 REST API 클라이언트
- **`src/cloud/d1-schema.ts`**: D1 스키마 정의 및 마이그레이션
- **`src/cloud/sync.ts`**: 동기화 핵심 로직
- **테스트 108개**: 기존 91 + D1/sync 17개 추가

### v0.5.0 (2026-04-07) — Cloudflare Workers AI 요약 엔진

- **Cloudflare Workers AI 요약 엔진 (Qwen3-30B)**: 한국어 텍스트 요약 특화, D1 토큰만으로 자동 활성화
- **Token-only D1 auto-setup**: account/database 자동 감지/생성, 토큰 하나면 나머지 전부 자동
- **하드웨어 기반 자동 machine ID**: macOS (IOPlatformUUID) / Linux (/etc/machine-id) / Windows (MachineGuid)
- **machines 레지스트리 테이블**: D1에 머신 정보 자동 등록
- **4단계 요약 우선순위**: Claude Code (SKILL.md) → Workers AI → Claude API → 휴리스틱 fallback
- **`src/cloud/cf-ai.ts`**: Workers AI 클라이언트
- **`src/cloud/d1-auto-setup.ts`**: Token-only 자동 설정
- **`src/util/machine-id.ts`**: 크로스플랫폼 하드웨어 ID 감지
- **테스트 116개**: 기존 108 + cf-ai/machine-id 8개 추가

### v0.8.4 (2026-04-11) — 파이프라인 모드 스위치 + 주간/월간 베이스라인 자동 생성 + 묵음 실패 차단

#### 핵심 요약

- **주간/월간 베이스라인 자동 생성**: `out`/`outd`/`outw`/`outm` 실행 시마다 이번 주 weekly와 이번 달 monthly row를 DB에 자동 upsert. 이전에는 `daily_reports`에만 row가 있고 weekly/monthly row는 생성되지 않아서, `outw`/`outm`이 빈 결과를 내는 구조적 공백이 있었음. 이미 발송된 보고서(`emailedAt != null`)는 보호되어 절대 덮어쓰지 않음.
- **`--mode=full|smart` 파이프라인 스위치**: 새 CLI 플래그와 `config --pipeline-mode` 설정 추가. `full`(기본)은 매 실행마다 weekly/monthly 베이스라인을 재생성, `smart`는 v0.8.3까지의 동작을 유지(토큰 절약, 요일 트리거만 — 금요일 weekly, 말일 monthly). 모드 결정 우선순위는 CLI 옵션 > config 값 > 기본값 `full`.
- **묵음 실패 차단**: 이전에는 `console.warn`만 찍고 파이프라인이 계속 진행되던 실패 경로 여러 곳을 구조화된 에러 채널로 표면화. CLI exit code로 cron 환경에서 실패를 감지할 수 있게 됨.

#### 핵심 변경

- **`autoSummarizeWeekly` / `autoSummarizeMonthly`** (`src/core/circle.ts`): 이번 주(월~일) 또는 이번 달(1일~말일)의 `daily_reports`를 모아 `summaryJson`의 세션을 flatten한 뒤, `mergeSummariesByTitle`로 프로젝트 단위 통합을 수행해 weekly/monthly row를 upsert. 두 함수는 공통 private helper `summarizeRangeInto`가 집계/기간 경계 계산/upsert 로직을 담당.
- **`PipelineMode` 타입 중앙화** (`src/core/out.ts`): `PIPELINE_MODES` 상수 배열, `PipelineMode` 리터럴 유니언 타입, `isPipelineMode()` 런타임 타입가드, `PIPELINE_MODE_CONFIG_KEY` 상수를 한 곳에 export. 기존에 `out.ts`·`circle.ts`·`cli.ts` 네 곳에 흩어져 있던 `"smart" | "full"` 리터럴 중복을 제거.
- **`resolvePipelineMode()`**: 우선순위 해석 순수 함수 — explicit option > config value > 기본값 `"full"`. 유효하지 않은 `configured` 값(오타, 구버전 데이터 등)은 조용히 `"full"`로 폴백 — `config --pipeline-mode` 쓰기 시점에 검증이 걸리므로 안전.
- **`CircleResult.summaryErrors`**: auto-summary 실패를 타입별로 기록하는 신규 필드 — `{type: "weekly" | "monthly"; error: string}[]`.
- **`collectUnrecordedSummaryErrors()`**: `out.ts`의 순수 헬퍼 — `circleResult.summaryErrors`를 `OutResultEntry` error로 승격시키되, 렌더 루프에서 이미 기록한 항목은 중복 제거.
- **`runOut` 구조 재정렬**: `runCircle` 직후에 `summaryErrors`를 글로벌 error entry로 **먼저** 수집. 휴가 체크/force/reportTypes 분기 이전에 기록되므로, 휴가일 early return으로 빠지거나 실패 타입이 `reportTypes`에 포함되지 않아도 실패가 반드시 반영됨.
- **CLI exit code 전파**: `out`/`outd`/`outw`/`outm`이 `result.errors > 0`일 때 `process.exitCode = 1` 설정. `process.exit(1)`이 아닌 `exitCode`를 쓰는 이유는 `finally` 블록의 `storage.close()`가 끝까지 실행되어 sql.js WASM DB flush 안정성이 확보되기 때문.

#### 버그 수정

- **`config --pipeline-mode smrt` 타이포가 exit 0으로 조용히 끝나던 문제**: 검증 경로가 `console.log` 후 fall-through로 종료해서 스크립트/CI가 오타를 감지할 수 없었음. 이제 `out --mode` 검증과 동일하게 `console.error` + `process.exit(1)`로 실패.
- **`emailedAt === 0` falsy 가드**: 기존 가드 `if (existing?.emailedAt) return false`는 `emailedAt === 0`을 falsy로 판정해 "미발송"으로 분류하므로, 발송된 row를 덮어쓸 수 있는 엣지 케이스가 있었음. `Date.now()`는 0을 반환할 일이 없지만 수동 DB 삽입이나 버그로 이 값이 들어올 수 있음. 명시적 null 비교 `if (existing && existing.emailedAt != null) return false`로 교체.
- **JSON.parse 묵음 드롭**: `summarizeRangeInto`의 `try { JSON.parse(...) } catch {}` 블록이 모든 예외를 흔적 없이 삼키던 문제. 손상된 daily row 하나가 해당 날짜의 세션을 조용히 누락시켜 집계 언더카운트가 발생할 수 있었음. 이제 `SyntaxError`만 catch하여 실패한 `reportDate`를 명시한 `console.warn`을 내고, 그 외 예외 클래스(`TypeError` 등)는 re-throw.
- **dead `"finalized"` 분기 제거**: `summarizeRangeInto`에 있던 `status = todayTs <= periodTo ? "in_progress" : "finalized"` 분기가 두 호출자(`autoSummarizeWeekly`/`autoSummarizeMonthly`)가 `today`로부터 range를 파생하는 구조상 `today`는 항상 `[rangeFrom, rangeTo]` 안이라 `"finalized"` 경로가 절대 실행되지 않는 dead code였음. `"in_progress"`로 하드코딩하고 기간 종료 시점 전환은 기존처럼 `finalizePreviousReports`가 담당.

#### 테스트 개선

**171개 테스트 전부 통과** (기준선 151 → +20 신규). 모든 신규 테스트는 TDD red → green 원칙을 따름.

- **`autoSummarizeWeekly` / `autoSummarizeMonthly`** — 8개: 이번 주/달 daily로부터 row 생성, 상태는 `in_progress`, 데이터 없을 때 스킵, 미발송 row upsert, 발송 row 보호(8개 필드 스냅샷 비교 — `summaryJson`/`overview`/`sessionCount`/`totalMessages`/`totalTokens`/`emailedAt`/`emailTo`/`createdAt`), `emailedAt === 0` falsy 가드.
- **`summarizeRangeInto` JSON 손상 처리** — 3개: 손상된 JSON에서 `reportDate` 경고 후 나머지 daily는 정상 처리, 배열이 아닌 JSON(예: `"null"`, `"{}"`)은 스킵, 빈 `summaryJson` 문자열은 스킵.
- **경계 케이스** — 5개: 오늘이 일요일(`getWeekBoundary`의 일요일 전용 분기 검증), 오늘이 월요일, 12월→1월 월 경계, 2028년 2월 윤년(2/29 포함), 2027년 2월 평년(3/1 제외).
- **`runCircle` summaryErrors 전파** — 4개. Proxy로 감싼 throwing `StorageAdapter`를 주입하여 검증: weekly 실패가 monthly 진행을 막지 않음, monthly 실패가 weekly와 독립 기록, smart 모드는 호출 자체를 건너뛰므로 에러 없음, 정상 storage는 빈 `summaryErrors` 반환.
- **`resolvePipelineMode`** — 7개: 기본값, explicit 옵션 override, config 폴백, 유효하지 않은 값 처리.
- **`collectUnrecordedSummaryErrors`** — 7개: 빈 입력, weekly/monthly 승격, 기존 entry와의 중복 제거, 다중 실패, 에러 메시지 포맷 검증.
- **"발송 보호" 테스트 강화**: 이전엔 `projectName === "sent"`와 `emailedAt`만 확인하던 테스트(aggregation이 실행돼도 이 두 값은 유지되므로 실제 보호를 증명 못 하던 false-confidence 테스트)를 before/after 스냅샷 비교로 바꿔 8개 필드 전부 불변 검증. 덮어쓰기가 실행되면 totals가 변할 만큼 큰 sentinel daily를 의도적으로 심어두고 감지.
- **수동 fault injection 스모크 테스트**: Proxy로 throwing storage를 주입한 상태에서 `runOut`을 돌려 Gap B 수정을 확증 — 휴가일에 weekly 실패 시 `result.errors = 1` + exit 1, `force: weekly`에 monthly auto-summary 실패 시 orphan monthly 에러가 글로벌 entry로 기록됨.

#### 문서 업데이트

- **SKILL.md — "파이프라인 모드 (v0.8.4+)" 섹션 신설**: `full`/`smart` 모드 설명과 `emailedAt != null` 보호 규칙 명시.
- **SKILL.md — "주간/월간 보고 고품질 재요약" 워크플로우**: 기존 "워크플로우: 주간/월간 보고 생성" 섹션을 4단계 흐름으로 재작성 — (1) `out` 실행으로 베이스라인 자동 생성, (2) `circle --json`으로 기간 데이터 조회/분석, (3) `circle --save --type weekly|monthly`로 재요약 덮어쓰기, (4) `outw`/`outm`으로 발송.

#### 변경 파일

`src/cli.ts` (+54), `src/core/circle.ts` (+203), `src/core/out.ts` (+109), `src/skill/SKILL.md` (+54), `tests/circle.test.ts` (+625), `tests/out.test.ts` (+110). 6개 파일 총 ~1143 insertions / ~12 deletions.

### v0.8.3 (2026-04-09) — 프로젝트 단위 세션 통합으로 단순화

- **세션 통합 로직 단순화**: 머지 기준이 "프로젝트 내 동일 제목" (`projectName::normalizedTitle`)에서 "프로젝트 단위" (`projectName`만)로 변경. 최종 결과 = 프로젝트당 하나의 항목, 세션 제목과 무관
- **circle.ts**: `mergeSummariesByTitle()` 그룹핑 키를 `projectName::normalizedTitle`에서 `projectName`으로 변경
- **merge-sessions.ts**: `mergeSessionsByTopic()` 그룹핑 키를 `projectName::normalizedTitle`에서 `projectName`으로 변경
- **SKILL.md 업데이트 (양쪽 복사본)**: 기존 2-pass mergeGroup 통합 및 3-pass 프로젝트 통합을 제거하고 `projectName` 기준 단일 2-pass로 교체
- **`--summarize` 경로**: 동일한 프로젝트 단위 통합 적용
- **테스트**: 동일 프로젝트의 서로 다른 제목 세션도 머지되도록 기대값 업데이트

### v0.8.2 (2026-04-09) — Circle 동일 제목 세션 통합 요약

- **circle 동일 제목 세션 머지**: 같은 날짜 내 `projectName + normalizedTitle`이 동일한 세션이 여러 개 있으면, 개별 요약 후 통합 재요약을 생성. 각 세션의 outcome은 합산, flow는 `→`로 연결, significance는 가장 긴 것 채택, nextSteps는 마지막 세션 기준. 머지된 항목은 topic에 `(×N)` 표시
- **양쪽 요약 경로 모두 적용**: `autoSummarize` (CLI 자동 요약 — Cloudflare AI / heuristic)와 SKILL.md 흐름 (Claude Code 직접 요약 — `circle --json`의 `mergeGroup` 힌트) 양쪽에서 동작
- **`mergeGroup` 필드 추가**: `circle --json` 출력의 각 세션에 `mergeGroup` 필드 (`projectName::normalizedTitle`) 포함 — Claude Code가 SKILL.md 2단계에서 머지 대상을 식별
- **SKILL.md 업데이트**: 2단계에 "통합 재요약" 지시 추가 — 개별 분석 후 같은 `mergeGroup` 세션을 합쳐서 통합 요약 생성
- **신규 함수**: `circle.ts`의 `mergeSummariesByTitle()` — `projectName + normalizeTitle(topic)` 기준 그룹핑, 통계 합산(messageCount, tokens, duration), 요약 필드 통합
- **테스트**: 135/135 통과 (11 파일, mergeSummariesByTitle 테스트 7개 추가)

### v0.8.1 (2026-04-09) — Circle 크로스 디바이스 머지 + 무조건 발신 정책

- **Circle 크로스 디바이스 머지**: `circle.ts`의 `autoSummarize`가 D1에서 `pullCrossDeviceReports`로 다른 기기의 이미 요약된 세션을 pull하고, `sessionId` 기준 중복 제거 후 전체 기기의 작업을 통합 요약. 기존에는 circle이 로컬 세션만 요약하고 크로스 디바이스 데이터는 `out`의 이메일 렌더링에서만 사용했음
- **무조건 발신 정책**: `out.ts`에서 크로스 디바이스 이메일 중복 체크 제거 — 다른 기기에서 이미 발송했더라도 `out`은 항상 이메일 발신. 기존의 `checkCrossDeviceEmailSent` → skip 동작이 이메일 발신을 차단하는 문제 해결
- **아키텍처 정렬**: 3단계 파이프라인이 명확한 역할 분리를 따름 — `air`는 기기별 수집, `circle`은 전체 기기 통합 요약, `out`은 항상 발신
- **변경 파일**: `src/core/circle.ts` (D1 pull + merge in `autoSummarize`), `src/core/out.ts` (dedup skip 블록 제거)
- **테스트**: 128/128 통과 (11개 테스트 파일)

### v0.8.0 (2026-04-09) — 크로스 디바이스 통합 리포트 + 프로젝트별 세션 머지

- **크로스 디바이스 통합 리포트**: 여러 기기에서 작업할 때 `out` 실행 시 로컬 데이터를 D1에 먼저 push(pre-sync)한 뒤 다른 기기의 세션을 pull하여 하나의 통합 이메일 리포트로 발송.
- **프로젝트별 세션 머지**: 같은 날짜 내 동일 `프로젝트명` 세션을 자동 머지 — 통계(메시지/토큰/시간) 합산, 가장 상세한 wrapUp 채택, flow 서술을 `→` 구분자로 연결. 머지된 세션은 제목에 `(×N)` 카운트를 표시.
- **타이틀 추출 개선**: 슬래시 명령(`/sincenety` 등)으로 시작하는 세션에서 5자 이상의 의미 있는 메시지를 우선 선택. 없으면 `[프로젝트명] session`으로 폴백하여 빈 제목을 방지.
- **Graceful D1 fallback**: 모든 크로스 디바이스 기능이 try/catch로 감싸져 있어 D1 연결 불가 시 기존 단일 기기 동작으로 자연스럽게 전환.
- **신규 파일**: `src/email/merge-sessions.ts`(세션 머지 유틸리티), `src/cloud/sync.ts`에 `pullCrossDeviceReports`/`checkCrossDeviceEmailSent` 추가.
- **테스트**: 128/128 통과 (11개 테스트 파일).

### v0.7.7 (2026-04-09) — claude-code 요약 품질 개선 + Workers AI CLI 샘플 리포트

- **claude-code 요약 품질 개선**: `ai_provider = claude-code`일 때 `circle --json`이 `conversationTurns`를 출력 전 전처리 — 경로/파일명 제거, 단답 필터링, 30턴 제한, 200/300자 트렁케이션 적용 (Workers AI와 동일한 전처리). Claude Code의 직접 요약 품질 대폭 향상
- **SKILL.md 2-pass 구조화**: 2단계 지시문 전면 개편 — 세션별 1-pass 분리 처리 + overview 2-pass 종합 생성. 구체적 입출력 예시 추가로 일관된 품질 보장
- **Workers AI CLI 샘플 리포트**: `docs/sample-report-cli.html` — Workers AI(Cloudflare)가 요약한 실제 일일보고 이메일 HTML 추가. [pathcosmos.github.io/sincenety/sample-report-cli.html](https://pathcosmos.github.io/sincenety/sample-report-cli.html)에서 확인 가능
- **테스트**: 128/128 통과 (11개 테스트 파일)

### v0.7.6 (2026-04-09) — sessionId prefix 매칭 + GitHub Pages 샘플 리포트

- **sessionId prefix 매칭 폴백**: `circle --save`로 AI 요약 저장 시 sessionId가 잘리거나 변형되어도 렌더러(`renderer.ts`)가 prefix(12자) 매칭으로 올바른 세션에 AI 요약을 매핑 — 이메일에서 raw 데이터로 폴백되는 문제 방지
- **`circleSave()` 자동 교정**: 입력된 sessionId가 DB 세션과 정확히 일치하지 않으면 prefix 매칭으로 올바른 ID를 찾아 교정된 ID로 저장 — 이후 렌더링에서 항상 유효한 ID 보장
- **GitHub Pages 샘플 리포트**: `docs/index.html` 랜딩 페이지와 `docs/sample-report.html` 실제 일일보고 이메일 샘플 추가. [pathcosmos.github.io/sincenety](https://pathcosmos.github.io/sincenety/)에서 확인 가능
- **테스트**: 128/128 통과 (11개 테스트 파일)

### v0.7.4 (2026-04-09) — AI provider 라우팅 수정 + 요약 품질 개선

- **`autoSummarize()` ai_provider 미존중 버그 수정**: CLI 환경(`sincenety`, `sincenety circle`)에서 `ai_provider` 설정과 무관하게 D1 토큰만 있으면 Workers AI를 호출하던 버그 수정. 이제 `resolveAiProvider()`를 통해 `ai_provider` 설정을 존중
- **`circleJson --summarize` provider 체크 추가**: `--summarize` 플래그도 `ai_provider = cloudflare`일 때만 Workers AI 호출
- **Workers AI 실패 시 heuristic fallback**: 개별 세션에서 Workers AI가 실패하면 `summarizer.ts`의 heuristic 요약으로 대체 (데이터 손실 방지)
- **`autoSummarize()` 전 AI provider 대응**: 기존에는 `cloudflare`일 때만 실행되던 것을 모든 provider에서 실행 (cloudflare → Workers AI, anthropic → Claude API, claude-code/heuristic → 휴리스틱). `daily_reports`에 항상 기본 요약이 생성됨
- **어시스턴트 출력 캡 300 → 1500자로 확대**: 기존 300자 하드캡으로 대부분의 응답 내용이 유실되던 문제 수정. 1500자로 확대하여 요약 품질 향상
- **파일 경로/파일명 필터링**: 절대 경로(`/Users/...`, `/Volumes/...`), 상대 경로(`./foo`, `../bar`), 확장자 포함 파일명(`.ts`, `.js`, `.json` 등)을 요약 입력에서 제거하여 기술적 노이즈 감소
- **휴리스틱 fallback 요약 개선**: 대화 턴이 없을 때 사용자 입력 원문 대신 프로젝트명 + 메시지 수 표시; 결과 키워드 미발견 시 어시스턴트 출력의 첫 문장 추출로 대체
- **`tool_use` 블록 추출**: Claude Code 어시스턴트 응답이 텍스트 없는 `tool_use` 블록(Edit, Bash, Read)인 경우 도구명을 `[Edit, Bash, Read]` 형태로 추출하여 휴리스틱 요약에 활용
- **README AI 요약 엔진 섹션 갱신**: "CLI에서는 항상 Workers AI" → "모든 환경에서 `ai_provider` 존중"으로 정정

### v0.7.2 (2026-04-09) — --date 옵션 + Data Flow 다이어그램 분리

- **`--date yyyyMMdd` 옵션**: `out/outd/outw/outm` 명령에 특정 날짜 지정 가능
- **Data Flow 다이어그램 분리**: Install Flow (설치 흐름) + Run Flow (실행 흐름) 2개로 분리
- **`parseDateArg()` 헬퍼**: yyyyMMdd 파싱 + 유효성 검증 (2월30일, 13월 등 차단)
- **테스트 12개 추가** (128/128 pass)

### v0.7.0 (2026-04-09) — Scope 선택 + postinstall 셋업 위저드

- **Scope 선택 (Global / Project)**: 전체 프로젝트 추적 또는 특정 프로젝트만 추적 선택 가능 (`~/.sincenety/scope.json`)
- **postinstall 셋업 위저드**: `npm install -g` 시 대화형 3단계 설정 (scope → D1 토큰 + Cloudflare 권한 가이드 → email)
- **D1 토큰 가이드 강화**: Cloudflare Custom Token 생성 절차 및 필요 권한(Workers AI Read, D1 Edit, Account Settings Read) 상세 안내
- **schedule 명령 비활성화**: 향후 재구현 예정
- **CLI 출력 영문 전환**: setup-wizard, d1-auto-setup 등 사용자 대면 메시지 영문화
- **신규 파일**: `src/config/scope.ts`, `src/postinstall.ts`

### v0.6.5 (2026-04-08) — JSON 출력 정합성 수정

- **`--render-only` stdout/stderr 분리**: D1 sync 완료 메시지를 `console.error`로 변경하여 JSON stdout 오염 방지
- **`--render-only` 단일 JSON 출력**: 다중 보고서 타입(daily+weekly 등) 렌더링 시 개별 JSON → 단일 JSON 객체/배열로 통합
- **`--render-only` 완료 메시지 제거**: `✅ out 완료` 메시지가 JSON stdout에 섞이던 문제 수정
- **`claude-code` AI provider 옵션 문서화**: `sincenety config --ai-provider claude-code` 옵션을 README에 반영

### 향후 계획

- [x] npm publish → `npx sincenety@latest` 배포
- [x] 3단계 파이프라인 (air → circle → out)
- [x] checkpoint 기반 백필 + 변경 감지
- [x] 휴가 관리
- [x] `out` 명령 — 스마트 이메일 발신 (out/outd/outw/outm, 4 providers, 캐치업)
- [x] `config --setup` 위저드
- [x] Gmail MCP 연동 (zero-config 이메일, `gmail_create_draft`)
- [x] 클라우드 동기화 (Cloudflare D1 멀티머신 통합)
- [x] Cloudflare Workers AI integration (Qwen3-30B 요약)
- [x] Auto machine ID (하드웨어 기반, 크로스플랫폼)
- [x] Token-only D1 setup (계정/DB 자동 감지)
- [x] 통합 AI provider 라우팅 (cloudflare/anthropic/claude-code/heuristic)
- [x] 필수 설정 가드 (D1 + SMTP 미설정 시 커맨드 차단)
- [x] JSON 출력 정합성: `--render-only` stdout/stderr 분리, 단일 JSON 출력
- [x] 기본 명령: `sincenety` (인자 없음) 전체 파이프라인 실행 (air → circle → out)
- [x] 영문 CLI: 모든 사용자 대면 메시지 영문 전환
- [x] Claude Code 첫 실행 시 ai_provider 설정 필수화
- [x] Scope 선택: global (전체) / project (특정 프로젝트) 모드
- [x] Postinstall 셋업 위저드: `npm install -g` 시 대화형 3단계 설정
- [x] 날짜 지정 보고서: `--date yyyyMMdd`로 out/outd/outw/outm 특정 날짜 발송
- [x] 샘플 리포트 페이지 (GitHub Pages: [pathcosmos.github.io/sincenety](https://pathcosmos.github.io/sincenety/))
- [x] 방어적 sessionId 매칭 (prefix 폴백 + 자동 교정)
- [x] claude-code 요약 품질 개선 (턴 전처리 + SKILL.md 2-pass)
- [x] Workers AI CLI 샘플 리포트 (GitHub Pages)
- [x] 크로스 디바이스 통합 리포트 (D1 pull + circle 통합 + 무조건 발신)
- [x] 프로젝트 단위 세션 통합 (`projectName` 기준, ×N 카운트 표시)
- [x] 타이틀 추출 개선 (의미 있는 메시지 우선 + 폴백)
- [x] circle 프로젝트 단위 세션 통합 요약 (개별 요약 → 프로젝트별 통합 재요약)
- [x] 주간/월간 베이스라인 자동 생성 (`out`/`outd`/`outw`/`outm` 실행 시마다, 발송본 보호)
- [x] 파이프라인 모드 스위치 (`--mode=full|smart` + `config --pipeline-mode`)
- [x] 묵음 실패 차단 (runCircle `summaryErrors` + CLI exit code 전파)
- [ ] passphrase 설정 기능 완성
- [ ] 다국어 보고서 출력 (KO 토글 옵션)
- [ ] 보고서 내보내기 (PDF/HTML standalone)
- [ ] 유사 작업 매칭 (TF-IDF 기반)
- [ ] MariaDB/PostgreSQL 외부 DB 연결
- [ ] ccusage 연동 (토큰 비용 자동 계산)

---

## 프로젝트 수치 (v0.8.4 기준)

| 지표 | 수치 |
|------|------|
| TypeScript 소스 파일 | 20+개 |
| 테스트 | 171/171 통과 |
| CLI 명령어 | default + air, circle, out, outd, outw, outm, sync, config |
| DB 테이블 | 7개 |
| 의존성 (production) | 3개 (commander, nodemailer, sql.js) |

---

## 라이선스

MIT
