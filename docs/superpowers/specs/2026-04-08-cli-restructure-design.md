# sincenety CLI 재구조화 설계

> 2026-04-08 — v0.3.0 목표

## 개요

기존 7개 서브커맨드(`기본`, `log`, `config`, `email`, `schedule`, `save-daily`, `report`)를 3단계 파이프라인(`air` → `circle` → `out`) + 유틸(`config`, `schedule`)로 재구조화한다.

## 명령어 체계

### 핵심 파이프라인

| 명령어 | 별칭 | 역할 |
|--------|------|------|
| `sincenety air` | 환기 | 기록 수집/저장 (날짜별 upsert) |
| `sincenety circle` | 순환 정화 | LLM 요약 — 일일/주간/월간 보고 생성 |
| `sincenety out` | 발신 | 스마트 이메일 발신 (요일 + 미발송 캐치업) |
| `sincenety outd` | 일일 발신 | 일일보고 메일 강제 발신 |
| `sincenety outw` | 주간 발신 | 주간보고 메일 강제 발신 |
| `sincenety outm` | 월간 발신 | 월간보고 메일 강제 발신 |

### 유틸리티

| 명령어 | 역할 |
|--------|------|
| `sincenety config` | 설정 관리 (이메일 발송 초기 세팅 포함) |
| `sincenety config --setup` | 대화형 이메일 설정 위저드 |
| `sincenety schedule` | 자동 스케줄 (향후 변경 예정) |

### 삭제 대상

| 기존 명령어 | 대체 |
|------------|------|
| 기본 action (인자 없이 실행) | `air` |
| `log` | 삭제 — 조회는 이메일로 대체 |
| `report` | 삭제 — 조회는 이메일로 대체 |
| `email` | `out` / `outd` / `outw` / `outm` |
| `save-daily` | `circle` 내부로 흡수 |

---

## Phase 1: `air` — 환기

### 동작

```
sincenety air
```

인자 없이 실행. 자동으로 범위를 판단한다.

### 알고리즘

1. DB에서 **마지막 `air` 실행 시점** (checkpoint) 조회
2. 범위 결정:
   - 첫 실행: `history.jsonl`의 가장 오래된 기록부터 ~ 현재 (전체 백필)
   - 이후: 마지막 checkpoint 날짜의 00:00 ~ 현재
3. `history.jsonl` + 세션 JSONL 파싱 (기존 `gather` 로직)
4. 각 세션의 `startedAt`을 기준으로 **날짜별 그룹핑** (자정 경계)
5. 날짜별로 `gather_reports`에 **upsert** (같은 날짜면 덮어쓰기)
6. **빈 날짜 처리**: 세션이 없는 날짜도 빈 `gather_reports` 레코드 생성 (주간/월간 연속성 보장)
7. checkpoint 갱신

### 날짜 그룹핑 규칙

- 세션이 자정을 걸치면 (23:50~01:30) → `startedAt` 기준 날짜에 귀속 (분할 안 함)
- 타임존: 로컬 시스템 타임존 기준

### 멀티데이 백필

- 자동 판단: checkpoint 이후 ~ 현재까지 빠진 날짜 전부 수집
- 첫 실행: history.jsonl 전체 기록을 날짜별로 분류하여 저장
- 터미널 출력: `"3일분 미수집 발견, 백필합니다"` 
- `--json` 플래그 유지: 날짜별 JSON 출력 (circle 파이프용)

---

## Phase 2: `circle` — 순환 정화

### 동작

```
sincenety circle
```

인자 없이 실행. 내부적으로 `air` → 요약 → 보고 생성.

### 알고리즘

1. **`air` 먼저 실행** — 데이터 최신화 (무조건, 매번)
2. 오늘 날짜/요일 확인
3. **자동 완료 처리** — 직전 일/주/월 보고를 `finalized`로 전환 (경계 판단)
4. **휴가 감지** — Google Calendar MCP 또는 수동 등록된 휴가 확인
5. **변경 감지** — `air`로 데이터가 갱신된 날짜만 재요약 (토큰 절약)
6. 보고 생성:
   - **일일보고** → 오늘 날짜 upsert (휴가일이면 `[휴가]` 표시)
   - **주간보고** → 이번 주 (월~일) upsert
   - **월간보고** → 이번 달 (1일~말일) upsert

### 계층형 요약 (토큰 절약)

```
raw 세션 데이터  →  일일보고 (세션 단위 요약)
                        ↓
                   주간보고 (일일보고들을 종합)
                        ↓
                   월간보고 (주간보고들을 종합)
```

- 주간보고는 raw 세션을 다시 읽지 않고 일일보고를 종합
- 월간보고는 주간보고를 종합
- 상위로 갈수록 LLM 입력 토큰 대폭 절감

### 자동 완료 처리

보고 상태: `in_progress` (진행중) / `finalized` (확정)

| 조건 | 동작 |
|------|------|
| 자정 넘기면 | 전날 일일보고 → `finalized` |
| 월요일 되면 | 직전 주 (월~일) 주간보고 → `finalized` |
| 1일 되면 | 직전 월 월간보고 → `finalized` |

진행중 표시:
- 주간: `[진행중 — 3/7일]`
- 월간: `[진행중 — 8/30일]`

### 변경 감지

- 각 날짜의 `gather_reports.data_hash`와 `daily_reports.data_hash` 비교
- `air` 갱신 후 데이터가 변경되지 않았으면 → 해당 날짜 재요약 스킵
- 터미널 출력: `"4/7 변경 없음 — 스킵, 4/8 갱신 — 요약 생성"`

### 휴가 감지

**Claude Code 안 (SKILL.md 경유):**
1. `gcal_list_events`로 해당 기간 일정 조회
2. "휴가", "vacation", "연차", "PTO", "병가", "sick" 등 키워드 감지
3. 해당 날짜를 `vacations` 테이블에 `source: gcal_auto`로 저장

**CLI 단독:**
- `vacations` 테이블의 수동 등록 데이터만 사용

### SKILL.md 연동

`circle`은 Claude Code 내에서 실행됨 (SKILL.md 경유):

1. `sincenety circle --json` → 요약 필요한 세션 데이터 출력
   (내부적으로 `air` 자동 실행)
2. Claude Code가 직접 요약 생성
3. `echo '{...}' | sincenety circle --save` → DB 저장

CLI 단독 실행 시 (Claude Code 밖):
- `ANTHROPIC_API_KEY` 있으면 API 호출
- 없으면 휴리스틱 fallback (기존 summarizer.ts)

---

## Phase 3: `out` — 발신

### 스마트 발신

```
sincenety out      # 요일/날짜 + 미발송 캐치업 자동 판단
sincenety outd     # 강제 일일보고만
sincenety outw     # 강제 주간보고만
sincenety outm     # 강제 월간보고만
```

### `out` 스마트 판단 로직

`out` 실행 시 아래 4단계를 순서대로 판단:

```
① outd — 항상 (오늘 일일보고)
② 미발송 일일보고 있으면 → 해당 일일보고도 발송
③ 금요일 OR 미발송 주간보고 있으면 → outw
④ 월 마지막 날 OR 미발송 월간보고 있으면 → outm
```

**미발송 캐치업 시나리오:**

| 시나리오 | `out` 동작 |
|----------|-----------|
| 월~목 정상 실행 | outd (일일) |
| 금요일 정상 실행 | outd + outw (일일 + 주간) |
| 금요일 놓침 → 월요일 실행 | outd + outw캐치업 (직전 주 미발송 주간) |
| 3일 안 돌림 → 오늘 실행 | outd + 미발송 일일보고들 캐치업 |
| 월말 놓침 → 다음달 1일 실행 | outd + outm캐치업 (직전 월 미발송) |
| 휴가 복귀 | 휴가 기간 스킵, 복귀일 기준으로 캐치업 |

### 휴가일 처리

- 휴가일에는 `out` 발신 스킵 (schedule 자동 실행 포함)
- 복귀일에 `out` 실행 → 미발송 보고만 캐치업
- 캐치업 시 휴가일 일일보고는 `[휴가]`로 표시

### 체인 실행

보고 데이터가 DB에 없으면:
- `outd` → 내부적으로 `circle` 실행 (→ `air` → 요약 → 일일보고 생성 → 발송)
- `outw` → `circle` 실행 후 주간보고 발송
- `outm` → `circle` 실행 후 월간보고 발송

### 재발송

재발송 제한 없음. 매번 새 이력 row를 `email_logs`에 기록. 갱신 정책과 일관.

### 옵션

- `out --preview` — 발송 안 하고 터미널에 요약만 표시 (실수 방지)
- `out --render-only` — HTML/제목/수신자를 stdout으로 출력 (Gmail MCP 연동용)
- `out --history` — 최근 발송 내역 조회 (날짜, 타입, 수신자, 상태)
- `out --catchup` — 미발송 보고 전부 강제 발송 (수동 캐치업)

### 4가지 발송 경로

| 경로 | 환경 | 설정 | 장점 |
|------|------|------|------|
| **A. Gmail MCP** | Claude Code 안 | 없음 (이미 인증됨) | 제로 설정 |
| **B. Resend API** | CLI / Claude Code | API 키 1개 | 간편, 무료 100통/일 |
| **C. Gmail SMTP** | CLI / 스케줄러 | 앱 비밀번호 | 익숙함, 무료 |
| **D. 커스텀 SMTP** | CLI / 스케줄러 | host/port/user/pass | 회사 메일 등 |

### 발송 우선순위

```
1. Gmail MCP 감지?     → MCP로 발송 (Claude Code 안, SKILL.md 경유)
2. Resend API 키 있음? → Resend HTTP API (fetch, 외부 의존성 제로)
3. SMTP 설정 있음?     → nodemailer 발송
4. 없음                → 설정 안내 ANSI 테이블 표시
```

### Gmail MCP 연동 (Claude Code 안)

SKILL.md에서 `out` 실행 시:

1. `gmail_get_profile` 호출 시도 → 성공하면 Gmail MCP 경로
2. `sincenety out --render-only` → HTML/제목/수신자 stdout 출력
3. `gmail_create_draft` → HTML 이메일 초안 생성
4. `gmail_send_draft` → 발송 (또는 초안 상태로 유지, 사용자 선택)

SMTP 설정 없이 `/sincenety` 한 번이면 끝.

### Resend API 연동

```typescript
// email/resend.ts — 외부 의존성 제로 (Node 18+ fetch 내장)
async function sendViaResend(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "sincenety <onboarding@resend.dev>", to, subject, html }),
  });
  return res.json();
}
```

- 무료 tier: 100통/일, 카드 등록 불필요
- API 키 1개만 설정: `sincenety config --resend-key re_xxxxxxxx`

---

## `config` — 설정 관리

### 인자 없이 실행: 현재 상태 ANSI 테이블 표시

```
sincenety config

┌──────────────┬──────────────────────┬────────────┐
│ 항목         │ 값                   │ 상태       │
├──────────────┼──────────────────────┼────────────┤
│ 발송 방식    │ Gmail SMTP           │ ✅ 설정됨  │
│ email        │ lanco.gh@gmail.com   │ ✅ 설정됨  │
│ smtp_host    │ smtp.gmail.com       │ ✅ 기본값  │
│ smtp_port    │ 587                  │ ✅ 기본값  │
│ smtp_user    │ lanco.gh@gmail.com   │ ✅ 설정됨  │
│ smtp_pass    │ ********             │ ✅ 설정됨  │
│ resend_key   │ (미설정)             │ — 선택사항 │
│ 휴가 등록    │ 2건                  │ ✅         │
└──────────────┴──────────────────────┴────────────┘
```

미설정 시:

```
┌──────────────┬──────────────────────┬────────────┐
│ 항목         │ 값                   │ 상태       │
├──────────────┼──────────────────────┼────────────┤
│ 발송 방식    │ (미설정)             │ ❌ 필요    │
│ email        │ (미설정)             │ ❌ 필요    │
│ smtp_pass    │ (미설정)             │ ❌ 필요    │
├──────────────┴──────────────────────┴────────────┤
│ 📋 설정: sincenety config --setup                │
│ 💡 Claude Code 안에서는 Gmail MCP로 자동 발송 가능│
│ ⏩ 이메일 없이 air, circle은 정상 동작합니다      │
└──────────────────────────────────────────────────┘
```

### `config --setup` 대화형 위저드

```
sincenety 이메일 설정
─────────────────────
발송 방식 선택:
  1. Gmail SMTP (앱 비밀번호 필요)
  2. Resend API (API 키 1개, 추천 ⭐)
  3. 커스텀 SMTP (직접 입력)

선택 [1]:
```

#### Gmail SMTP 선택 시

```
  Gmail 이메일 주소: lanco.gh@gmail.com
  
  📋 Gmail 앱 비밀번호가 필요합니다:
     https://myaccount.google.com/apppasswords
  
  앱 비밀번호 (16자리): ●●●● ●●●● ●●●● ●●●●
  
  연결 테스트 중...
  ✅ Gmail SMTP 연결 성공!
```

#### Resend 선택 시

```
  📋 Resend API 키 발급:
     https://resend.com/api-keys
     (무료 — 100통/일, 카드 등록 불필요)

  API 키: re_xxxxxxxx
  수신 이메일: lanco.gh@gmail.com

  연결 테스트 중...
  ✅ Resend 연결 성공!
```

#### 커스텀 SMTP 선택 시

```
  SMTP 호스트: mail.company.com
  SMTP 포트 [587]: 465
  SMTP 사용자: user@company.com
  SMTP 비밀번호: ●●●●●●●●
  수신 이메일: boss@company.com

  연결 테스트 중...
  ✅ SMTP 연결 성공!
```

### 개별 설정 (기존 유지 + 확장)

```bash
# Gmail SMTP
sincenety config --email you@gmail.com
sincenety config --smtp-user you@gmail.com
sincenety config --smtp-pass                    # 프롬프트 입력
sincenety config --smtp-pass "xxxx xxxx xxxx"   # 직접 전달 (Claude Code용)

# 커스텀 SMTP
sincenety config --smtp-host mail.company.com
sincenety config --smtp-port 465

# Resend
sincenety config --resend-key re_xxxxxxxx

# 발송 방식 변경
sincenety config --provider gmail|resend|smtp

# 휴가 관리
sincenety config --vacation 2026-04-10 2026-04-11
sincenety config --vacation --range 2026-04-10 2026-04-14
sincenety config --vacation --type sick 2026-04-15        # 병가
sincenety config --vacation --list                         # 조회
sincenety config --vacation --clear 2026-04-10             # 삭제
```

### 첫 실행 감지 + ANSI 안내

`air`, `circle`, `out` 어떤 명령이든 최초 실행 시 ANSI 테이블로 안내:

- `air`/`circle`: 안내 표시 후 **정상 실행 계속** (5회에 1번 리마인드)
- `out`: 이메일 설정 없으면 **안내 표시 + 중단** (발송 불가)

### 연결 테스트

`config --setup` 완료 시 자동으로 SMTP/Resend 연결 테스트:
- 성공: `✅ 연결 성공`
- 실패: `❌ 인증 실패 — 앱 비밀번호를 확인하세요` (즉시 발견)

---

## 휴가 관리

### 데이터 소스 (우선순위)

```
1. Google Calendar MCP (Claude Code 안, 자동 감지)
2. 수동 등록 (CLI config --vacation)
```

### Google Calendar 자동 감지 (Claude Code 안)

SKILL.md에서 `circle` 실행 시:
1. `gcal_list_events`로 해당 기간 일정 조회
2. 키워드 감지: "휴가", "vacation", "연차", "PTO", "병가", "sick", "대휴", "반차"
3. 종일 이벤트 (all-day event) 우선 감지
4. 해당 날짜를 `vacations` 테이블에 `source: gcal_auto`로 저장
5. 수동 등록(`source: manual`)이 이미 있으면 수동 우선

### 보고에 미치는 영향

| 보고 유형 | 휴가 처리 |
|----------|----------|
| 일일보고 | 휴가일 → `[휴가]` 표시, 빈 보고 대신 |
| 주간보고 | `"5일 중 3일 활동 (2일 휴가)"` 근무일수 표시 |
| 월간보고 | `"근무 18일 / 휴가 2일 / 주말 10일"` 통계 |
| 이메일 제목 | `[sincenety] 4/7~4/11 주간보고 (3일 근무)` |
| `out` 스마트 발신 | 휴가일엔 발신 스킵 → 복귀일에 캐치업 |

### 휴가 유형

| 유형 | 키워드 | CLI 옵션 |
|------|--------|----------|
| `vacation` | 휴가, vacation, 연차, PTO | (기본) |
| `sick` | 병가, sick | `--type sick` |
| `holiday` | 공휴일, holiday | `--type holiday` |
| `half` | 반차, half-day | `--type half` |
| `other` | 대휴, 기타 | `--type other` |

---

## DB 스키마 변경 (v4)

### 기존 테이블 변경

**`gather_reports`** — 컬럼 추가:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `report_date` | TEXT | 해당 날짜 (YYYY-MM-DD), 날짜별 upsert 키 |
| `data_hash` | TEXT | 내용 해시 (변경 감지용) |
| `updated_at` | INTEGER | 마지막 갱신 시각 (ms) |

**`daily_reports`** — 컬럼 추가:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `status` | TEXT | `in_progress` / `finalized` |
| `progress_label` | TEXT | `진행중 — 3/7일` 등 (nullable) |
| `data_hash` | TEXT | gather 데이터 해시 (변경 감지용) |

### 신규 테이블: `email_logs`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `sent_at` | INTEGER | 발송 시각 (ms) |
| `report_type` | TEXT | daily / weekly / monthly |
| `report_date` | TEXT | 대상 날짜 (YYYY-MM-DD) |
| `period_from` | TEXT | 보고 시작일 |
| `period_to` | TEXT | 보고 종료일 |
| `recipient` | TEXT | 수신자 |
| `subject` | TEXT | 제목 |
| `body_html` | TEXT | HTML 본문 전체 |
| `body_text` | TEXT | plain text 본문 |
| `provider` | TEXT | gmail_mcp / resend / gmail_smtp / custom_smtp |
| `status` | TEXT | sent / failed / draft |
| `error_message` | TEXT | 실패 시 에러 (nullable) |

### 신규 테이블: `vacations`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | INTEGER PK | 자동증가 |
| `date` | TEXT UNIQUE | YYYY-MM-DD |
| `type` | TEXT | vacation / sick / holiday / half / other |
| `source` | TEXT | manual / gcal_auto |
| `label` | TEXT | 사용자 지정 라벨 (nullable) |
| `created_at` | INTEGER | 등록 시각 (ms) |

### `config` 추가 키

| 키 | 설명 |
|----|------|
| `provider` | `gmail` / `resend` / `smtp` (발송 방식) |
| `resend_key` | Resend API 키 |
| `setup_shown_count` | 안내 표시 횟수 (리마인드 빈도 조절) |

### 마이그레이션

v3 → v4 자동 마이그레이션:
- `gather_reports`에 `report_date`, `data_hash`, `updated_at` 컬럼 ADD
- `daily_reports`에 `status`, `progress_label`, `data_hash` 컬럼 ADD
- `email_logs` 테이블 CREATE
- `vacations` 테이블 CREATE
- `schema_version` → 4

---

## 전체 데이터 플로우

```
sincenety air
  │
  ├─ checkpoint 확인 → 범위 자동 판단 (첫 실행: 전체 백필)
  ├─ history.jsonl + 세션 JSONL 파싱
  ├─ 날짜별 그룹핑 (자정 경계)
  ├─ 빈 날짜도 레코드 생성
  └─ gather_reports upsert (날짜별 덮어쓰기, data_hash 갱신)
       │
sincenety circle
  │
  ├─ air 내부 실행 (데이터 최신화)
  ├─ 자동 완료 처리 (직전 일/주/월 finalized)
  ├─ 휴가 감지 (Google Calendar MCP / 수동 등록)
  ├─ 변경 감지 (data_hash 비교, 미변경 스킵)
  ├─ 일일보고 생성/갱신 (LLM 요약, 휴가일 표시)
  ├─ 주간보고 생성/갱신 (일일보고 종합, 근무일수 통계)
  └─ 월간보고 생성/갱신 (주간보고 종합, 근무/휴가/주말 통계)
       │
sincenety out
  │
  ├─ 보고 없으면 circle 내부 실행
  ├─ 스마트 판단:
  │    ① outd (항상)
  │    ② 미발송 일일보고 캐치업
  │    ③ 금요일 OR 미발송 주간 → outw
  │    ④ 월말 OR 미발송 월간 → outm
  │    ⑤ 휴가일이면 발신 스킵 (복귀일 캐치업)
  ├─ 발송 경로 선택:
  │    1. Gmail MCP (Claude Code 안, 제로 설정)
  │    2. Resend API (API 키 1개)
  │    3. Gmail SMTP (앱 비밀번호)
  │    4. 커스텀 SMTP
  ├─ HTML 이메일 생성 (AI 요약 반영)
  ├─ 발송 + email_logs 기록 (본문 포함)
  └─ --preview / --render-only / --history / --catchup 옵션
```

## SKILL.md 변경

`/sincenety` 실행 시 워크플로우:

```
1단계: sincenety circle --json
       (내부적으로 air 자동 실행)
       → 요약 필요 데이터 + 휴가 정보 출력
       
2단계: Google Calendar MCP로 휴가 감지 (가능하면)
       → sincenety config --vacation (자동 등록)

3단계: Claude Code가 직접 요약 생성
       → 휴가일 반영, 근무일수 통계 포함

4단계: echo '{...}' | sincenety circle --save
       → DB 저장

5단계: 발송 경로 판단
       Gmail MCP 가능? → gmail_create_draft + gmail_send_draft
       아니면?         → sincenety out (SMTP/Resend)
```

---

## 삭제 대상 코드

| 파일/기능 | 처리 |
|----------|------|
| cli.ts 기본 action | → `air` 서브커맨드로 이동 |
| cli.ts `log` 커맨드 | 삭제 |
| cli.ts `report` 커맨드 | 삭제 |
| cli.ts `email` 커맨드 | → `out`/`outd`/`outw`/`outm`으로 대체 |
| cli.ts `save-daily` 커맨드 | → `circle --save`로 흡수 |
| report/terminal.ts `formatLogReport` | 삭제 |

## 신규 파일

| 파일 | 역할 |
|------|------|
| `src/email/resend.ts` | Resend API 발송 (fetch, 의존성 제로) |
| `src/email/provider.ts` | 발송 경로 추상화 (Gmail MCP / Resend / SMTP 통합) |
| `src/vacation/detector.ts` | 휴가 감지 (Google Calendar 키워드 매칭) |
| `src/vacation/manager.ts` | 휴가 CRUD (수동 등록/조회/삭제) |

---

## 버전

- package.json: `0.2.1` → `0.3.0`
- DB schema: v3 → v4
