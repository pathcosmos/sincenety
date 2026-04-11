---
name: sincenety
description: Use when the user wants to log, review, or summarize their Claude Code work sessions — triggered by /sincenety, requests to track work history, or "what did I work on today"
---

# sincenety — 작업 갈무리

실행 한 번으로 Claude Code 작업을 자동 분석하여 구조화된 기록을 생성합니다.

## 워크플로우: 갈무리 (기본)

사용자가 `/sincenety`를 입력하면 아래 5단계를 순서대로 수행합니다.

### 0단계: 휴가 감지 (Google Calendar MCP 있을 때)

Google Calendar MCP가 사용 가능하면 (`gcal_list_events` 호출 성공):
1. `gcal_list_events`로 해당 기간의 종일 이벤트 조회
2. 제목에 휴가/연차/PTO/병가/반차 키워드 감지
3. 감지된 날짜를 자동 등록: `sincenety config --vacation YYYY-MM-DD --vacation-type vacation`
4. 이미 등록된 날짜는 스킵

### 1단계: AI provider 확인 + 데이터 수집

먼저 `sincenety config` 출력에서 `ai_provider` 값을 확인합니다.

**첫 실행 시 (ai_provider 미설정)**: Claude Code 안에서 실행 중이라면 반드시 ai_provider를 설정합니다:
```bash
sincenety config --ai-provider claude-code
```
이렇게 하면 Claude Code가 직접 요약을 생성합니다. Cloudflare Workers AI를 사용하려면 `cloudflare`로 설정합니다.

**cloudflare인 경우** (Workers AI가 요약 생성):
```bash
sincenety circle --json --summarize
```
Workers AI가 각 세션을 요약하여 `aiSummary` 필드에 포함합니다. → 2단계 스킵, 바로 3단계로.

**그 외 (auto, anthropic, 미설정)** (Claude Code가 직접 요약):
```bash
sincenety circle --json
```
내부적으로 `air`(데이터 수집)를 자동 실행한 뒤, 요약이 필요한 날짜의 세션 데이터를 JSON으로 출력합니다.
각 세션에 `conversationTurns` (사용자 입력 + 어시스턴트 응답 쌍)이 포함됩니다. → 2단계에서 직접 요약.

### 2단계: AI 요약 생성

**`--summarize` 사용 시**: 1단계 JSON에 이미 `aiSummary`가 포함되어 있습니다. 각 세션의 `aiSummary`를 세션별 요약(1-pass)으로 사용한 뒤, 아래의 **프로젝트별 통합 재요약 (2-pass)**과 **overview 생성 (final-pass)**을 동일하게 수행합니다. overview는 `{날짜}_overview` 키에 포함되어 있으면 참고하되, 프로젝트 통합 후 재생성합니다.

**Claude Code 직접 분석 시**: 1단계 JSON의 각 날짜별 세션을 **한 세션씩 순서대로** 분석합니다.
(참고: conversationTurns는 이미 전처리되어 있습니다 — 경로/파일명 제거, 단답 필터, 30턴 제한, 200/300자 트렁케이션 적용 완료)

**세션별 분석 (1-pass)**: 각 세션의 `conversationTurns`를 읽고 아래 필드를 생성합니다:

- **topic**: 핵심 주제 (20자 이내)
- **outcome**: 실제로 이루어진 작업과 결과물 (2-3문장, 구체적)
- **flow**: 작업 흐름 단계별 요약 (예: 'A → B → C')
- **significance**: 핵심 성과 (1문장)
- **nextSteps**: 다음에 이어서 할 작업 (있으면, 1문장)

**중요 원칙**:
- 사용자 입력을 나열하지 말고, 입력+출력을 종합하여 "결과적으로 무엇이 만들어졌는지"를 서술
- 코드 파일명, 경로, 기술적 구현 세부사항보다 **비즈니스 수준의 성과**에 초점
- 일일 업무 보고서 수준의 품질이어야 합니다

**예시**:
```
conversationTurns 입력:
[1] 사용자: Cloudflare Pages에 배포할 수 있도록 설정해줘
    결과: wrangler.toml 파일을 생성하고 빌드 설정을 구성했습니다. npm run deploy 명령으로...
[2] 사용자: greyscale 디자인으로 전환해줘
    결과: CSS 변수를 수정하여 컬러 팔레트를 greyscale로 변경했습니다...

요약 출력:
{
  "topic": "웹사이트 배포 및 디자인",
  "outcome": "Cloudflare Pages에 사이트를 배포하고 greyscale 디자인을 적용했다. 빌드 설정과 CSS 팔레트를 구성하여 라이브 사이트에 반영했다.",
  "flow": "배포 설정 → 빌드 구성 → greyscale 디자인 적용 → 라이브 반영",
  "significance": "사이트 정식 배포 및 디자인 통일 완료",
  "nextSteps": ""
}
```

**프로젝트별 통합 재요약 (2-pass)**: 세션별 분석 완료 후, 같은 `projectName`의 세션을 모두 하나로 통합합니다. 최종 결과는 **프로젝트 수 = 항목 수**입니다:

- **topic**: 프로젝트 전체를 아우르는 주제 (20자 이내)
- **outcome**: 해당 프로젝트에서 이루어진 모든 작업을 종합하여 하나의 결과물로 재작성 (단순 나열 금지, 흐름을 가진 서술)
- **flow**: 시간순으로 전체 작업 흐름 연결
- **significance**: 프로젝트 수준의 핵심 성과 1문장
- **nextSteps**: 마지막 작업 기준

프로젝트별로 1개 세션만 있으면 해당 세션의 요약을 그대로 사용합니다.

**overview 생성 (final-pass)**: 프로젝트별 통합까지 완료된 후, 각 프로젝트의 topic/significance를 종합하여 하루 전체를 관통하는 **overview**를 2-3문장으로 작성합니다. 개별 프로젝트를 나열하지 말고, 하루의 큰 흐름과 핵심 성과를 서술합니다.

### 3단계: 일일보고 저장

2단계에서 생성한 요약을 JSON으로 구성하여 DB에 저장합니다:

```bash
echo '{ "date": "YYYY-MM-DD", "overview": "하루 종합 서술", "sessions": [...] }' \
  | sincenety circle --save
```

sessions 배열의 각 항목:
```json
{
  "sessionId": "1단계 JSON의 sessionId",
  "projectName": "프로젝트명",
  "topic": "핵심 주제",
  "outcome": "결과물",
  "flow": "작업 흐름",
  "significance": "성과",
  "nextSteps": "후속 작업"
}
```

주간보고 저장:
```bash
echo '{ "date": "YYYY-MM-DD", "overview": "주간 종합", "sessions": [...] }' \
  | sincenety circle --save --type weekly
```

### 4단계: 리포트 표시

요약된 내용을 터미널에 구조화하여 보여줍니다:

```
📋 YYYY-MM-DD (요일) 작업 갈무리

## 오늘의 요약
[overview: 전체 세션을 관통하는 하루 작업 흐름]

### 1. [프로젝트명] — 주제 (시간, 메시지수, 토큰)
**결과물**: ...
**흐름**: ...
**성과**: ...

### 2. [프로젝트명] — 주제
...
```

### 5단계: 이메일 발송 (설정된 경우)

발송 경로 자동 판단:

**경로 A: Gmail MCP (Claude Code 안, 설정 불필요)**
1. `gmail_get_profile` 호출 — 성공하면 Gmail MCP 사용 가능
2. `sincenety out --render-only` 실행 → JSON 출력 (subject, recipient, html)
3. JSON에서 subject, recipient, html 추출
4. `gmail_create_draft`로 이메일 초안 생성 (`contentType: "text/html"`)
5. 사용자에게 확인 후 발송 (또는 초안 유지)

**경로 B: SMTP/Resend (설정 필요)**
```bash
sincenety out
```

**경로 C: 설정 없음**
터미널 출력만 (이메일 스킵)

**참고:** 휴가일에는 발신이 자동 스킵됩니다 (강제 발신: `sincenety outd`)

## 파이프라인 모드 (v0.8.4+)

`out`/`outd`/`outw`/`outm`는 실행 시 내부적으로 `circle`을 돌려 파이프라인을 최신화합니다. 두 가지 모드가 있습니다:

- **full (기본)** — 매 실행마다 이번 주 weekly, 이번 달 monthly의 baseline을 자동으로 재생성합니다. 이 baseline은 해당 기간의 daily 요약들을 프로젝트 단위로 머지한 휴리스틱 요약입니다. 토큰을 조금 더 쓰되 누락 없이 항상 최신 상태를 유지합니다.
- **smart** — 기존 동작. daily만 요약하고 weekly/monthly는 요일 트리거(금요일/말일)나 catchup 감지 시에만 생성.

**안전 규칙**: `emailedAt != null`인 weekly/monthly row는 **절대 덮어쓰지 않습니다**. 이미 발송된 보고서의 무결성을 보장합니다.

설정 / 전환:
```bash
sincenety config --pipeline-mode full    # 또는 smart
sincenety out --mode full                # 1회만
```

## 워크플로우: 주간/월간 보고 고품질 재요약

full 모드에서는 weekly/monthly baseline이 자동 생성되므로, `outw`/`outm`을 바로 실행해도 빈 결과가 나오지 않습니다. 하지만 baseline은 휴리스틱 머지라 품질이 제한적이므로, Claude Code가 발송 전에 고품질로 재요약해서 덮어쓰는 것을 권장합니다.

### 1. baseline 생성 확인 (자동)

`sincenety out`을 실행하면 다음 로그가 보입니다:
```
📅 weekly baseline refreshed
📆 monthly baseline refreshed
```
이 시점에 이번 주/달 row가 DB에 준비된 상태입니다.

### 2. 기간 내 데이터 조회 및 분석

```bash
sincenety circle --json
```
출력된 JSON에서 대상 기간의 daily 세션들을 분석합니다. daily 요약(topic/outcome/flow/significance/nextSteps)이 이미 있으므로, 이를 입력으로 받아 주간/월간 단위의 상위 요약을 작성합니다.

### 3. 재요약 저장 (baseline 덮어쓰기)

```bash
echo '{ "date": "YYYY-MM-DD", "overview": "주간 종합", "sessions": [...] }' \
  | sincenety circle --save --type weekly
```

- `date`는 **주의 월요일** (weekly) 또는 **달의 1일** (monthly)
- `sessions`는 프로젝트 단위로 통합된 상위 요약 항목들
- `overview`는 해당 기간 전체를 관통하는 2-3문장 서술

`circle --save`는 `emailedAt`이 null이면 덮어쓰고, 이미 발송됐으면 그대로 둡니다.

### 4. 발송

```bash
sincenety outw    # 이번 주 weekly 즉시 발송
sincenety outm    # 이번 달 monthly 즉시 발송
```

혹은 Gmail MCP 경로:
```bash
sincenety outw --render-only
```
→ JSON을 받아 `gmail_create_draft`에 전달.

## How It Works

- `~/.claude/history.jsonl`과 세션 JSONL을 스트리밍 파싱
- 사용자 입력 + 어시스턴트 응답을 대화 턴으로 구성
- 날짜별로 그룹핑 (자정 경계, startedAt 기준)
- 암호화된 로컬 DB (`~/.sincenety/sincenety.db`)에 저장
- **자동 백필**: 마지막 실행 이후 빠진 날짜 자동 수집
- **변경 감지**: 데이터 해시로 미변경 날짜 스킵 (토큰 절약)
- **자동 완료 처리**: 자정 넘기면 전날 확정, 월요일엔 직전 주 확정
- **일일보고**: Claude Code 세션이 직접 대화 내용을 분석하여 자연스러운 요약 생성
- **주간/월간 보고**: 일일보고를 모아서 종합 요약 (계층형 — 토큰 절약)
