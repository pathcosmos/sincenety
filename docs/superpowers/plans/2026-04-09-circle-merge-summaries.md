# Circle 동일 제목 세션 통합 요약 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** circle 단계에서 동일 프로젝트+제목 세션의 개별 요약을 통합 재요약하여 중복 제거 및 품질 향상

**Architecture:** `circle.ts`에 `mergeSummariesByTitle()` 함수를 추가하여, 개별 세션 요약 완료 후 `projectName + normalizedTitle` 기준으로 그룹핑 → 같은 그룹의 요약을 heuristic 합산. `circleJson()`에는 `mergeGroup` 필드를 추가하여 SKILL.md가 Claude Code에게 그룹 정보를 전달. `autoSummarize()`에서는 `mergeSummariesByTitle()` 호출 후 `circleSave()`에 전달.

**Tech Stack:** TypeScript (ESM), vitest

---

### Task 1: `mergeSummariesByTitle()` 함수 — 테스트 작성

**Files:**
- Test: `tests/circle.test.ts`

- [ ] **Step 1: Write failing tests for mergeSummariesByTitle**

```typescript
import {
  getWeekBoundary,
  getProgressLabel,
  finalizePreviousReports,
  mergeSummariesByTitle,
} from "../src/core/circle.js";

// ... (기존 import/helper 유지)

describe("mergeSummariesByTitle", () => {
  it("returns sessions unchanged when no duplicates", () => {
    const sessions = [
      {
        sessionId: "a",
        projectName: "proj",
        topic: "이메일 기능",
        outcome: "이메일 발송 구현",
        flow: "설계 → 구현",
        significance: "이메일 발송 완료",
        nextSteps: "테스트 추가",
      },
      {
        sessionId: "b",
        projectName: "proj",
        topic: "DB 개선",
        outcome: "스키마 변경",
        flow: "분석 → 마이그레이션",
        significance: "DB 성능 향상",
        nextSteps: "",
      },
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(2);
    expect(result[0].topic).toBe("이메일 기능");
    expect(result[1].topic).toBe("DB 개선");
  });

  it("merges sessions with same projectName and topic", () => {
    const sessions = [
      {
        sessionId: "a",
        projectName: "sincenety",
        topic: "이메일 발송 기능",
        outcome: "SMTP 설정 완료",
        flow: "설정 → 테스트",
        significance: "SMTP 연동",
        nextSteps: "HTML 렌더링",
        messageCount: 10,
        totalTokens: 5000,
        inputTokens: 3000,
        outputTokens: 2000,
        durationMinutes: 30,
        model: "opus",
      },
      {
        sessionId: "b",
        projectName: "sincenety",
        topic: "이메일 발송 기능",
        outcome: "HTML 템플릿 구현",
        flow: "디자인 → 렌더링",
        significance: "이메일 템플릿 완성",
        nextSteps: "배포",
        messageCount: 15,
        totalTokens: 8000,
        inputTokens: 5000,
        outputTokens: 3000,
        durationMinutes: 45,
        model: "opus",
      },
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);

    const merged = result[0];
    expect(merged.sessionId).toBe("a");
    expect(merged.topic).toBe("이메일 발송 기능 (×2)");
    expect(merged.outcome).toContain("SMTP 설정 완료");
    expect(merged.outcome).toContain("HTML 템플릿 구현");
    expect(merged.flow).toBe("설정 → 테스트 → 디자인 → 렌더링");
    expect(merged.significance).toBe("이메일 템플릿 완성"); // longer one
    expect(merged.nextSteps).toBe("배포"); // last session
    expect(merged.messageCount).toBe(25);
    expect(merged.totalTokens).toBe(13000);
    expect(merged.inputTokens).toBe(8000);
    expect(merged.outputTokens).toBe(5000);
    expect(merged.durationMinutes).toBe(75);
  });

  it("normalizes topic for grouping (case, slash commands, trailing project name)", () => {
    const sessions = [
      {
        sessionId: "a",
        projectName: "sincenety",
        topic: "/sincenety 이메일 기능",
        outcome: "결과A",
        flow: "A",
        significance: "성과A",
        nextSteps: "",
      },
      {
        sessionId: "b",
        projectName: "sincenety",
        topic: "이메일 기능 sincenety",
        outcome: "결과B",
        flow: "B",
        significance: "성과B",
        nextSteps: "다음",
      },
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toContain("(×2)");
  });

  it("keeps separate groups for different projects", () => {
    const sessions = [
      {
        sessionId: "a",
        projectName: "projA",
        topic: "이메일 기능",
        outcome: "결과A",
        flow: "A",
        significance: "성과A",
        nextSteps: "",
      },
      {
        sessionId: "b",
        projectName: "projB",
        topic: "이메일 기능",
        outcome: "결과B",
        flow: "B",
        significance: "성과B",
        nextSteps: "",
      },
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(2);
  });

  it("handles single session (no merge needed)", () => {
    const sessions = [
      {
        sessionId: "a",
        projectName: "proj",
        topic: "작업",
        outcome: "결과",
        flow: "흐름",
        significance: "성과",
        nextSteps: "",
      },
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("작업"); // no (×N)
  });

  it("handles empty array", () => {
    const result = mergeSummariesByTitle([]);
    expect(result).toHaveLength(0);
  });

  it("merges 3+ sessions", () => {
    const sessions = [
      { sessionId: "a", projectName: "p", topic: "feat", outcome: "O1", flow: "F1", significance: "S1", nextSteps: "N1" },
      { sessionId: "b", projectName: "p", topic: "feat", outcome: "O2", flow: "F2", significance: "S2 longer text", nextSteps: "N2" },
      { sessionId: "c", projectName: "p", topic: "feat", outcome: "O3", flow: "F3", significance: "S3", nextSteps: "N3" },
    ];
    const result = mergeSummariesByTitle(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("feat (×3)");
    expect(result[0].flow).toBe("F1 → F2 → F3");
    expect(result[0].nextSteps).toBe("N3"); // last
    expect(result[0].significance).toBe("S2 longer text"); // longest
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/minim42tbtmm/temp_git/sincenety && npx vitest run tests/circle.test.ts`
Expected: FAIL — `mergeSummariesByTitle` is not exported from circle.js

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/circle.test.ts
git commit -m "test: mergeSummariesByTitle 실패 테스트 추가"
```

---

### Task 2: `mergeSummariesByTitle()` 함수 — 구현

**Files:**
- Modify: `src/core/circle.ts`

- [ ] **Step 1: Add normalizeTitle and mergeSummariesByTitle to circle.ts**

`src/core/circle.ts`에 `CircleSaveSessionInput` 정의 뒤 (약 73행 이후), Helpers 섹션 안에 추가:

```typescript
// ---------------------------------------------------------------------------
// Title normalization (circle 전용 — email/merge-sessions.ts와 독립)
// ---------------------------------------------------------------------------

/** 제목을 정규화: 소문자, 공백 정리, 프로젝트명 접미사 제거, 슬래시 커맨드 제거 */
function normalizeTitle(title: string, projectName: string): string {
  let t = title.toLowerCase().trim();
  const pn = projectName.toLowerCase();
  if (t.endsWith(pn)) {
    t = t.slice(0, -pn.length).trim();
  }
  t = t.replace(/^\/\S+\s*/, "").trim();
  t = t.replace(/\s+/g, " ");
  return t;
}

// ---------------------------------------------------------------------------
// Summary merge — 동일 제목 세션의 개별 요약을 통합
// ---------------------------------------------------------------------------

export interface MergedSummary extends CircleSaveSessionInput {
  messageCount?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMinutes?: number;
  model?: string;
  mergedCount?: number;
}

/**
 * 동일 projectName + normalizedTitle(topic) 세션의 요약을 통합.
 * - 1개 그룹: 그대로 통과
 * - 2개+ 그룹: 요약 필드 합산, 통계 합산, topic에 "(×N)" 표시
 */
export function mergeSummariesByTitle(sessions: MergedSummary[]): MergedSummary[] {
  if (sessions.length <= 1) return sessions;

  const groups = new Map<string, MergedSummary[]>();
  for (const s of sessions) {
    const project = s.projectName ?? "";
    const topic = s.topic ?? "";
    const key = `${project}::${normalizeTitle(topic, project)}`;
    const group = groups.get(key);
    if (group) {
      group.push(s);
    } else {
      groups.set(key, [s]);
    }
  }

  const merged: MergedSummary[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    const base = group[0];

    // significance: 가장 긴 것 채택
    let bestSignificance = base.significance ?? "";
    for (let i = 1; i < group.length; i++) {
      const s = group[i].significance ?? "";
      if (s.length > bestSignificance.length) {
        bestSignificance = s;
      }
    }

    // flow: 각 flow를 " → "로 연결
    const flows = group
      .map((s) => s.flow)
      .filter((f): f is string => !!f && f.length > 0);
    const mergedFlow = flows.join(" → ");

    // outcome: 각 outcome을 "\n"으로 연결
    const outcomes = group
      .map((s) => s.outcome)
      .filter((o): o is string => !!o && o.length > 0);
    const mergedOutcome = outcomes.join("\n");

    // nextSteps: 마지막 세션 것
    const lastNextSteps = group[group.length - 1].nextSteps ?? "";

    const m: MergedSummary = {
      sessionId: base.sessionId,
      projectName: base.projectName,
      topic: `${base.topic ?? ""} (×${group.length})`,
      outcome: mergedOutcome,
      flow: mergedFlow,
      significance: bestSignificance,
      nextSteps: lastNextSteps,
      messageCount: group.reduce((sum, s) => sum + (s.messageCount ?? 0), 0),
      totalTokens: group.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0),
      inputTokens: group.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0),
      outputTokens: group.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0),
      durationMinutes: group.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
      model: base.model,
      mergedCount: group.length,
    };

    merged.push(m);
  }

  return merged;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Volumes/minim42tbtmm/temp_git/sincenety && npx vitest run tests/circle.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/circle.ts
git commit -m "feat: mergeSummariesByTitle — circle 동일 제목 세션 통합 요약"
```

---

### Task 3: `autoSummarize()`에 머지 적용

**Files:**
- Modify: `src/core/circle.ts:470` (autoSummarize 함수 내, `circleSave` 호출 전)

- [ ] **Step 1: autoSummarize에서 mergeSummariesByTitle 호출 추가**

`autoSummarize()` 함수 내 `if (summaries.length > 0) {` 블록 시작 부분 (약 470행)을 수정:

기존:
```typescript
      if (summaries.length > 0) {
        let overview: string | null = null;
```

변경:
```typescript
      // 동일 제목 세션 통합 (개별 요약 → 재요약)
      const mergedSummaries = mergeSummariesByTitle(summaries);
      const mergeCount = summaries.length - mergedSummaries.length;
      if (mergeCount > 0) {
        console.log(`  🔗 ${date}: ${summaries.length} sessions → ${mergedSummaries.length} (${mergeCount} merged)`);
      }

      if (mergedSummaries.length > 0) {
        let overview: string | null = null;
```

그리고 이후 `summaries` 참조를 `mergedSummaries`로 교체:
- `overview` 생성의 `summaries.map(...)` → `mergedSummaries.map(...)`
- `circleSave(...)` 의 `sessions: summaries` → `sessions: mergedSummaries`
- 로그의 `summaries.length` → `mergedSummaries.length`

기존 `if (summaries.length > 0) {` 를 `if (mergedSummaries.length > 0) {` 로 교체하고, 블록 끝의 닫는 `}` 는 그대로 유지.

- [ ] **Step 2: Build to verify no type errors**

Run: `cd /Volumes/minim42tbtmm/temp_git/sincenety && npm run build`
Expected: 컴파일 성공

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `cd /Volumes/minim42tbtmm/temp_git/sincenety && npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/circle.ts
git commit -m "feat: autoSummarize에 동일 제목 세션 머지 적용"
```

---

### Task 4: `circleJson()`에 `mergeGroup` 필드 추가

**Files:**
- Modify: `src/core/circle.ts:207-217` (circleJson의 전처리 루프)

- [ ] **Step 1: circleJson 전처리 루프에 mergeGroup 할당 추가**

`circleJson()` 함수에서 `preprocessTurnsForClaudeCode` 루프 (약 207행) 내에 `mergeGroup` 필드를 각 세션에 추가:

기존:
```typescript
  if (!options?.summarize) {
    for (const dateStr of airResult.changedDates) {
      const dateSessions = sessions[dateStr] as any[];
      if (!dateSessions?.length) continue;
      for (const s of dateSessions) {
        if (s.conversationTurns?.length) {
          s.conversationTurns = preprocessTurnsForClaudeCode(s.conversationTurns);
        }
      }
    }
  }
```

변경:
```typescript
  if (!options?.summarize) {
    for (const dateStr of airResult.changedDates) {
      const dateSessions = sessions[dateStr] as any[];
      if (!dateSessions?.length) continue;
      for (const s of dateSessions) {
        if (s.conversationTurns?.length) {
          s.conversationTurns = preprocessTurnsForClaudeCode(s.conversationTurns);
        }
        // SKILL.md용 머지 그룹 힌트
        const project = s.projectName ?? "";
        const topic = s.title ?? s.summary ?? "";
        s.mergeGroup = `${project}::${normalizeTitle(topic, project)}`;
      }
    }
  }
```

- [ ] **Step 2: Build to verify**

Run: `cd /Volumes/minim42tbtmm/temp_git/sincenety && npm run build`
Expected: 컴파일 성공

- [ ] **Step 3: Commit**

```bash
git add src/core/circle.ts
git commit -m "feat: circleJson에 mergeGroup 힌트 추가 (SKILL.md 경로용)"
```

---

### Task 5: SKILL.md 2단계에 통합 재요약 지시 추가

**Files:**
- Modify: `src/skill/SKILL.md:83` (overview 생성 전)

- [ ] **Step 1: SKILL.md 2단계에 통합 재요약 블록 추가**

`**overview 생성 (2-pass)**` 바로 앞 (83행 직전)에 새 블록 삽입:

```markdown
**통합 재요약 (같은 주제 세션 머지)**: 세션별 분석 완료 후, `mergeGroup` 값이 동일한 세션이 2개 이상이면 개별 요약을 합쳐서 하나의 통합 요약을 생성합니다:

- **topic**: 대표 주제 선택 + "(×N)" 표시
- **outcome**: 각 세션의 outcome을 종합하여 하나의 결과물로 재작성 (단순 나열 금지)
- **flow**: 시간순으로 연결 (session1 flow → session2 flow)
- **significance**: 통합된 핵심 성과 1문장
- **nextSteps**: 마지막 세션 기준

통합된 세션은 하나의 항목으로 `circle --save`에 전달합니다 (개별 세션 대신).
`mergeGroup`이 모두 고유하면 (머지 대상 없음) 이 단계는 스킵합니다.

```

- [ ] **Step 2: 설치된 SKILL.md도 동기화**

```bash
cp /Volumes/minim42tbtmm/temp_git/sincenety/src/skill/SKILL.md /Users/lanco/.claude/skills/sincenety/SKILL.md
```

- [ ] **Step 3: Commit**

```bash
git add src/skill/SKILL.md
git commit -m "docs: SKILL.md 2단계에 동일 제목 세션 통합 재요약 지시 추가"
```

---

### Task 6: 빌드 + 전체 테스트 + 수동 검증

**Files:**
- None (검증만)

- [ ] **Step 1: Full build**

Run: `cd /Volumes/minim42tbtmm/temp_git/sincenety && npm run build`
Expected: 컴파일 성공, 에러 없음

- [ ] **Step 2: Full test suite**

Run: `cd /Volumes/minim42tbtmm/temp_git/sincenety && npx vitest run`
Expected: ALL PASS (기존 테스트 + Task 1의 새 테스트 모두)

- [ ] **Step 3: 수동 검증 — circleJson mergeGroup 확인**

Run: `cd /Volumes/minim42tbtmm/temp_git/sincenety && node dist/cli.js circle --json 2>/dev/null | head -100`
Expected: 각 세션 객체에 `mergeGroup` 필드 존재

- [ ] **Step 4: 최종 커밋 (필요 시)**

변경사항이 있으면:
```bash
git add -A
git commit -m "chore: circle 동일 제목 통합 요약 최종 정리"
```
