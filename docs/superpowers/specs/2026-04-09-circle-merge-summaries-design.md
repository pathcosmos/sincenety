# Circle 단계 동일 제목 세션 통합 요약

## 목적

circle 2단계(AI 요약)에서 같은 프로젝트+제목의 세션이 여러 개 있으면, 개별 요약 후 통합 재요약을 생성하여 중복을 제거하고 요약 품질을 높인다.

## 현재 문제

- 같은 주제를 여러 세션에 걸쳐 작업하면 개별 요약이 각각 생성됨
- 리포트에 비슷한 내용이 반복, 토큰 낭비
- email 단계에서만 머지하므로 daily_reports DB에는 중복 상태로 저장

## 설계

### 방식: 개별 요약 → 통합 재요약 (2단계)

```
세션A: "이메일 기능" → 요약A ─┐
세션B: "이메일 기능" → 요약B ─┴→ 통합 재요약AB
세션C: "DB 개선"     → 요약C ───→ 요약C (그대로)
```

개별 요약을 먼저 만든 뒤 같은 제목끼리 재요약. 턴을 합치는 방식(1회 요약) 대비 긴 세션에도 안전.

### 적용 경로

양쪽 요약 경로 모두 적용:

1. **autoSummarize** (CLI 자동) — Cloudflare AI / heuristic
2. **SKILL.md** (Claude Code 직접) — circleJson 출력 + SKILL.md 지시

### 변경 파일

#### 1. `src/core/circle.ts` — `mergeSummariesByTitle()` 추가

```typescript
function normalizeTitle(title: string, projectName: string): string {
  // email/merge-sessions.ts와 동일 로직 (복사)
  // 소문자, 공백 정리, 프로젝트명 접미사 제거, 슬래시 커맨드 제거
}

interface MergedSummary extends CircleSaveSessionInput {
  messageCount?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMinutes?: number;
  model?: string;
  mergedCount?: number;
}

function mergeSummariesByTitle(
  sessions: MergedSummary[],
): MergedSummary[] {
  // 1. normalizeTitle(projectName, topic 또는 title)로 그룹핑
  // 2. 1개 그룹 → 그대로
  // 3. 2개+ 그룹:
  //    - topic: 첫 세션 것
  //    - outcome: 각 outcome "\n" 연결
  //    - flow: 각 flow " → " 연결
  //    - significance: 가장 긴 것
  //    - nextSteps: 마지막 세션 것
  //    - 통계: 합산
  //    - 제목에 "(×N)" 표시
  //    - mergedCount: N
}
```

#### 2. `autoSummarize()` 수정

개별 요약 완료 후 `mergeSummariesByTitle()` 호출:

```typescript
// 기존: summaries 배열 → circleSave
// 변경: summaries 배열 → mergeSummariesByTitle() → circleSave
const merged = mergeSummariesByTitle(summaries);
await circleSave(storage, { date, sessions: merged, ... });
```

Cloudflare AI 경로에서 머지된 그룹의 outcome/flow를 Workers AI로 재요약할지 여부:
- heuristic(텍스트 합산)으로 충분. Workers AI 재호출은 과도함.

#### 3. `circleJson()` 수정

JSON 출력에 `mergeHint` 추가:

```json
{
  "2026-04-09": [
    { "sessionId": "a", "projectName": "sincenety", "title": "이메일 기능", "mergeGroup": "sincenety::이메일 기능", ... },
    { "sessionId": "b", "projectName": "sincenety", "title": "이메일 기능", "mergeGroup": "sincenety::이메일 기능", ... },
    { "sessionId": "c", "projectName": "sincenety", "title": "DB 개선", "mergeGroup": "sincenety::db 개선", ... }
  ]
}
```

#### 4. `src/skill/SKILL.md` — 2단계 지시 추가

2단계 세션별 분석 후 추가 단계:

> **통합 재요약**: 같은 `mergeGroup`의 세션이 2개 이상이면, 개별 요약을 합쳐서 하나의 통합 요약을 생성합니다.
> - topic: 대표 주제 선택
> - outcome: 각 outcome을 종합하여 재작성
> - flow: 시간순 연결
> - significance: 통합 성과
> - nextSteps: 마지막 세션 기준
> - `circle --save` 시 머지된 세션으로 저장 (개별 세션 대신)

### 재요약 필드 합산 규칙

| 필드 | 합산 방식 |
|------|----------|
| sessionId | 첫 세션 ID |
| projectName | 공통값 (그룹핑 키) |
| topic | 첫 세션 topic 유지 + "(×N)" |
| outcome | 각 outcome 합산, "\n" 연결 |
| flow | 각 flow " → " 연결 |
| significance | 가장 긴 것 채택 |
| nextSteps | 마지막 세션 것 |
| messageCount, tokens 등 | 합산 |

### 건드리지 않는 것

- `email/merge-sessions.ts` — email 전용, 그대로 유지
- `email/renderer.ts` — 변경 없음
- DB 스키마 — 기존 필드로 충분
- `circleSave()` — 입력 구조 변경 없음 (머지된 세션을 그대로 받음)

### 그룹핑 키

`projectName + normalizeTitle(topic, projectName)` — email 머지와 동일 기준이지만 독립 함수.

SKILL.md 경로에서는 `mergeGroup` 필드로 Claude Code에게 그룹 정보를 전달.
