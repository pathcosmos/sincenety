# sincenety

> **[English Documentation (README.md)](./README.md)**

**Claude Code 작업 갈무리 도구** — 3단계 파이프라인으로 Claude Code 작업 이력을 자동 수집, 요약, 보고합니다.

start/stop 없이, 실행 시점에 소급하여 모든 작업을 자동 정리합니다.

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

## 핵심 기능

### 3단계 파이프라인: air → circle → out

**v0.5.0** CLI를 명확한 파이프라인으로 구성합니다:

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
   - 휴가일에 [휴가] 라벨 자동 부여

3. **`sincenety out`** — 스마트 이메일 발신
   - `out`: 일일보고 항상 발송, 금요일에 +주간보고, 월말에 +월간보고
   - 미발송 캐치업: 금요일 놓치면 → 월요일에 주간보고 자동 발송
   - 4가지 provider: Gmail MCP / Resend / Gmail SMTP / Custom SMTP
   - `outd` / `outw` / `outm`: 일일 / 주간 / 월간 강제 발신
   - `--preview`, `--render-only`, `--history`

### CLI 명령어 (9개)

| 명령어 | 설명 |
|--------|------|
| `sincenety air` | 환기 -- 날짜별 자동 백필 수집 |
| `sincenety circle` | 순환 정화 -- LLM 요약 (--json/--save/--type) |
| `sincenety out` | 스마트 발신 (요일+캐치업 자동) |
| `sincenety outd` / `outw` / `outm` | 강제 일일/주간/월간 발신 |
| `sincenety sync` | D1 중앙 동기화 |
| `sincenety config` | 설정 (--setup, --vacation, --d1-*) |
| `sincenety schedule` | 자동 스케줄 |

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

4단계 우선순위 시스템으로 자동 AI 요약:

```
1. Claude Code 안 (SKILL.md) → Claude Code가 직접 요약 (최고 품질)
2. D1 토큰 있음            → Cloudflare Workers AI (Qwen3-30B) 자동
3. ANTHROPIC_API_KEY       → Claude API
4. 없음                    → 휴리스틱 fallback
```

- **Cloudflare Workers AI (Qwen3-30B)** 한국어 텍스트 요약 특화
- D1 토큰만 있으면 자동 활성화 — 별도 API 키 불필요
- `circle` 실행 시 자동 요약: 세션별 topic/outcome/flow/significance + 일일 overview
- 무료 tier: 10,000 neurons/일 (개인 사용 충분, 하루 ~300회 요약 가능)
- 월간 비용 ~$0.02 (사실상 무료)

Claude Code 안에서 실행 시 SKILL.md 연동으로 최고 품질 요약. Claude Code 밖에서는 D1 토큰이 설정되어 있으면 Workers AI가 자동으로 동작합니다.

### 이메일 AI 요약 통합

이메일 보고서에 `daily_reports`의 AI 요약이 포함됩니다:
- **overview 섹션**: 이메일 최상단에 하루 종합 요약
- **세션별 매핑**: `daily_reports` wrapUp 데이터가 각 세션의 topic/outcome/flow/significance에 매핑
- **Gmail 102KB 클립 방지**: 세션당 actions를 최대 5건으로 제한, 텍스트 길이 최적화

### 첫 실행 설정 안내

이메일 미설정 시 5회차 실행마다 `config --setup` 안내를 표시합니다. 비차단 — 이메일 없이도 모든 기능이 동작합니다.

### 휴가 관리

- **Google Calendar 자동 감지** — SKILL.md가 Claude Code에게 Google Calendar 휴가 이벤트 확인 지시
- **CLI 수동 등록** — `config --vacation 2026-04-10 2026-04-11`
- **휴가 키워드** (한국어 + 영어): 휴가/vacation/연차/PTO/병가/sick/반차/half-day
- **휴가 유형**: vacation / sick / holiday / half / other
- **보고서 연동** — `circle`에서 휴가일에 [휴가] 라벨 표시, `out`은 휴가일 자동 스킵

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

### 자동 스케줄링

오후 6시(기본)에 자동으로 갈무리. macOS는 launchd, Linux는 crontab을 자동으로 설정합니다.

### 클라우드 동기화 (Cloudflare D1)

Cloudflare D1을 통한 멀티머신 데이터 통합:

- **로컬 우선**: 암호화된 로컬 DB가 원본 (source of truth)
- **`sincenety sync`**로 로컬 데이터를 중앙 D1 데이터베이스에 push (push / pull-config / status / init)
- **자동 동기화**: `out` 완료 후 자동 sync (non-fatal -- 네트워크 오류가 이메일 발송을 차단하지 않음)
- **공유 설정**: SMTP 설정 한 번이면 `sync --pull-config`로 새 머신에서 즉시 사용
- **머신 ID**: 하드웨어 기반 자동 감지 (아래 참조), `config --machine-name`으로 커스텀 식별
- **의존성 무추가**: D1 REST API는 native `fetch` 사용 -- 새 패키지 없음

### Token-Only D1 설정

D1 토큰 하나면 나머지는 전부 자동:

```bash
sincenety config --d1-token cfp_xxxxxxxx
# ✅ 계정 자동 감지
# ✅ D1 DB 자동 생성/연결
# ✅ machine_id 자동 감지 (하드웨어 UUID 기반)
# ✅ Workers AI 자동 활성화
# ✅ 스키마 세팅 완료
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

### 설치

```bash
# npx로 즉시 실행
npx sincenety@latest

# 또는 글로벌 설치
npm install -g sincenety

# 또는 로컬 빌드
git clone https://github.com/pathcosmos/sincenety.git
cd sincenety
npm install && npm run build
npm link
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

# 휴가 관리
sincenety config --vacation 2026-04-10 2026-04-11
sincenety config --vacation-list
sincenety config --vacation-clear 2026-04-10
```

> Gmail 앱 비밀번호 생성: https://myaccount.google.com/apppasswords

### schedule — 자동 갈무리 스케줄

```bash
# 오후 6시 자동 갈무리 설치
sincenety schedule --install

# 시간 변경
sincenety schedule --install --time 19:00

# 상태 확인 / 해제
sincenety schedule --status
sincenety schedule --uninstall
```

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
│   ├── cli.ts                  # CLI 진입점 (commander: 9개 명령 — air, circle, out, sync, config, schedule)
│   ├── core/
│   │   ├── air.ts              # Phase 1: 날짜별 갈무리 (백필 + 해시)
│   │   ├── circle.ts           # Phase 2: LLM 요약 파이프라인 (finalization + 저장)
│   │   ├── out.ts              # Phase 3: 스마트 이메일 발신 (out/outd/outw/outm)
│   │   ├── gatherer.ts         # 갈무리 핵심 로직 (파싱→그룹핑→저장)
│   │   └── summarizer.ts       # AI 요약 (Claude API + 휴리스틱 fallback)
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
│   │   ├── terminal.ts         # 터미널 테이블 출력 (유니코드 박스 드로잉, 한글 폭 계산)
│   │   └── markdown.ts         # 마크다운 리포트 생성
│   ├── email/
│   │   ├── sender.ts           # nodemailer 이메일 발송
│   │   ├── renderer.ts         # HTML 이메일 렌더러 (보고서 → HTML)
│   │   ├── resend.ts           # Resend API 이메일 provider
│   │   ├── provider.ts         # 이메일 provider 추상화 (Gmail MCP/Resend/SMTP)
│   │   └── template.ts         # Bright 컬러코딩 HTML 이메일 템플릿
│   ├── vacation/
│   │   ├── manager.ts          # 휴가 CRUD (등록/조회/삭제/확인)
│   │   └── detector.ts         # 휴가 키워드 감지 (한국어+영어)
│   ├── config/
│   │   └── setup-wizard.ts     # 대화형 3선택 설정 위저드
│   ├── cloud/
│   │   ├── d1-client.ts        # Cloudflare D1 REST API 클라이언트
│   │   ├── d1-schema.ts        # D1 스키마 정의 및 마이그레이션
│   │   ├── d1-auto-setup.ts    # Token-only 자동 설정 (계정/DB 감지)
│   │   ├── cf-ai.ts            # Cloudflare Workers AI 클라이언트 (Qwen3-30B)
│   │   └── sync.ts             # 동기화 로직 (push/pull/status/init)
│   ├── util/
│   │   └── machine-id.ts       # 크로스플랫폼 하드웨어 ID 감지
│   ├── scheduler/
│   │   └── install.ts          # launchd/cron 자동 설치
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

### 데이터 흐름

```
~/.claude/history.jsonl  ──→  세션 목록 추출 (sessionId + project)
                                    │
                                    ▼
~/.claude/projects/[project]/[sessionId].jsonl  ──→  토큰/모델/타이밍/대화턴 추출
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
                  sincenety air           (날짜별 그룹핑)
                  (checkpoint 백필,        (자정 경계)
                   data hash 감지)
                        │
                        ▼
                  gather_reports DB
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
     터미널 요약    air --json    circle
     출력          (날짜별)     (자동 finalization)
                                     │
                        ┌────────────┼────────────┐
                        ▼            ▼            ▼
                  circle --json  circle --save  sincenety out
                  (SKILL.md)    (daily_reports)  (스마트 발신)
                                                      │
                                        ┌─────────────┼─────────────┐
                                        ▼             ▼             ▼
                                    outd (일일)   outw (주간)   outm (월간)
                                        │
                                  4 providers:
                                  Gmail MCP / Resend /
                                  Gmail SMTP / Custom SMTP
                                        │
                                        ▼
                                  sincenety sync
                                  (out 완료 후 자동)
                                        │
                                        ▼
                                  Cloudflare D1
                                  (멀티머신 통합)
                        │
                        ▼
                  Claude Code
                  AI 요약 생성
```

### DB 스키마 (v4)

**7개 테이블:**

| 테이블 | 설명 |
|--------|------|
| `sessions` | 세션별 작업 기록 (22개 컬럼 — 토큰, 시간, 타이틀, 설명, 모델 등) |
| `gather_reports` | 갈무리 리포트 (마크다운 + JSON, report_date, data_hash, updated_at) |
| `daily_reports` | AI 요약 보고 (status, progress_label, data_hash; UNIQUE(report_date, report_type)) |
| `checkpoints` | 갈무리 포인트 (마지막 처리 timestamp) |
| `config` | 설정 (이메일, SMTP, provider 등) |
| `vacations` | 휴가/공휴일 (date, type, source, label) |
| `email_logs` | 이메일 발송 이력 |

자동 마이그레이션: v1 → v2 → v3 → v4

DB 파일: `~/.sincenety/sincenety.db` (AES-256-GCM 암호화, 0600 권한)

### 암호화 상세

- **알고리즘**: AES-256-GCM (인증된 암호화)
- **키 파생**: PBKDF2 (SHA-256, 100,000 iterations)
- **키 소스**: `hostname + username + 랜덤 salt` (머신 바운드)
- **Salt**: `~/.sincenety/sincenety.salt` (32바이트 랜덤, 설치 시 1회 생성, 0600 권한)
- **파일 포맷**: `[4B magic "SNCT"][12B IV][ciphertext][16B auth tag]`

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
| 테스트 | vitest (116개, 11개 테스트 파일) |

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
npm test             # vitest 테스트 (116개)
node dist/cli.js     # 직접 실행
```

### 테스트

```bash
# 전체 테스트 (116개)
npm test

# 개별 테스트
npx vitest run tests/encryption.test.ts   # 암호화 (26개)
npx vitest run tests/migration-v4.test.ts # DB 마이그레이션 (7개)
npx vitest run tests/air.test.ts          # air 명령 (7개)
npx vitest run tests/circle.test.ts       # circle 명령 (10개)
npx vitest run tests/out.test.ts          # out 명령 (28개)
```

### 로컬 npx 테스트

```bash
npx .                # 현재 디렉토리를 npx로 실행
```

---

## 개발 이력

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
- **자동 스케줄링**: launchd (macOS) / crontab (Linux) 자동 설치

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
- [ ] passphrase 설정 기능 완성
- [ ] 유사 작업 매칭 (TF-IDF 기반)
- [ ] MariaDB/PostgreSQL 외부 DB 연결
- [ ] ccusage 연동 (토큰 비용 자동 계산)

---

## 프로젝트 수치 (v0.5.0 기준)

| 지표 | 수치 |
|------|------|
| TypeScript 소스 파일 | 20개 |
| 테스트 | 116/116 통과 |
| CLI 명령어 | 9개 (air, circle, out, outd, outw, outm, sync, config, schedule) |
| DB 테이블 | 7개 |
| 의존성 (production) | 3개 (commander, nodemailer, sql.js) |

---

## 라이선스

MIT
