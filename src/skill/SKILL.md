---
name: sincenety
description: Use when the user wants to log, review, or summarize their Claude Code work sessions — triggered by /sincenety, requests to track work history, or "what did I work on today"
---

# sincenety — 작업 갈무리

실행 한 번으로 Claude Code 작업을 자동 분석하여 구조화된 기록을 생성합니다.

## 워크플로우: 갈무리 (기본)

사용자가 `/sincenety`를 입력하면 아래 5단계를 순서대로 수행합니다.

### 1단계: 데이터 수집 + 요약 필요 데이터 출력

```bash
sincenety circle --json
```

내부적으로 `air`(데이터 수집)를 자동 실행한 뒤, 요약이 필요한 날짜의 세션 데이터를 JSON으로 출력합니다.
자동 백필: 마지막 실행 이후 빠진 날짜도 자동으로 수집합니다.
각 세션에 `conversationTurns` (사용자 입력 + 어시스턴트 응답 쌍)이 포함됩니다.

### 2단계: AI 요약 생성

1단계 JSON의 각 날짜별 세션 `conversationTurns`를 분석하여 **직접 요약을 생성**합니다.
사용자 입력과 어시스턴트 응답을 **함께** 분석하여:

- **topic**: 핵심 주제 (20자 이내)
- **outcome**: 실제로 이루어진 작업과 결과물 (2-3문장, 구체적)
- **flow**: 작업 흐름 단계별 요약 (예: 'A → B → C')
- **significance**: 핵심 성과 (1문장)
- **nextSteps**: 다음에 이어서 할 작업 (있으면, 1문장)

**중요**: 사용자 입력을 나열하는 것이 아니라, 입력+출력을 종합하여 "결과적으로 무엇이 이루어졌는지"를 자연스럽게 서술합니다. 일일 업무 보고서 수준의 품질이어야 합니다.

또한 하루 전체를 종합하는 **overview**도 작성합니다 (2-3문장).

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
1. Gmail MCP 사용 가능? → `gmail_get_profile` 확인 후 `sincenety out --render-only`로 HTML 획득 → `gmail_create_draft`로 발송
2. SMTP/Resend 설정됨? → `sincenety out`으로 발송 (요일 기준 일일/주간/월간 자동 판단)
3. 설정 없음? → 터미널 출력만 (이메일 스킵)

```bash
sincenety out
```

## 워크플로우: 주간/월간 보고 생성

1. 기간 내 일일보고를 JSON으로 조회:
```bash
sincenety circle --json
```

2. JSON을 분석하여 주간/월간 종합 요약을 **직접 생성**

3. 저장:
```bash
echo '{ "date": "YYYY-MM-DD", "overview": "주간 종합", "sessions": [...] }' \
  | sincenety circle --save --type weekly
```

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
