# sincenety v0.8.7 개선 작업 상세 계획

> 작성일: 2026-04-16
> 근거: test-results-v0.8.7-20260416.md 테스트 실행 결과

---

## P0 — 즉시 수정 (버그/데이터 무결성)

### P0-1. `emailedAt=0` 비대칭 통일

**현황**:
- `getDailyReportFreshness`: `!!daily?.emailedAt` — `0`은 falsy → `emailed=false`
- `invalidateDailyReport`: `if (existing.emailedAt)` — `0`은 falsy → 무효화 **진행**
- `autoSummarizeWeekly/Monthly`: `emailedAt != null` — `0`은 non-null → 보호됨

동일한 `emailedAt` 필드에 대해 3가지 서로 다른 체크 패턴을 사용 중. `emailedAt=0`인 레코드는 현실적으로 `updateDailyReportEmail(id, 0, "")` 호출에서만 발생하지만, 비대칭은 잠재적 데이터 손실 위험.

**수정 계획**:

| 파일 | 위치 | 현재 | 변경 |
|------|------|------|------|
| `src/storage/sqljs-adapter.ts` | `getDailyReportFreshness` | `!!daily?.emailedAt` | `daily?.emailedAt != null` |
| `src/storage/sqljs-adapter.ts` | `invalidateDailyReport` | `if (existing.emailedAt)` | `if (existing.emailedAt != null)` |

**테스트 영향**:
- `tests/freshness.test.ts` #6: `emailed=true` (emailedAt 설정) → 변경 없음 ✅
- `tests/freshness.test.ts` #14: `emailedAt=0` → 기대값 변경: `true` → `false` (invalidation blocked)

```diff
# src/storage/sqljs-adapter.ts — getDailyReportFreshness
- const emailed = !!daily?.emailedAt;
+ const emailed = daily?.emailedAt != null;

# src/storage/sqljs-adapter.ts — invalidateDailyReport
- if (existing.emailedAt) return false;
+ if (existing.emailedAt != null) return false;
```

```diff
# tests/freshness.test.ts
- it("emailedAt=0 (JS falsy) → invalidation proceeds", ...
-   expect(ok).toBe(true);
+ it("emailedAt=0 → treated as emailed, invalidation blocked", ...
+   expect(ok).toBe(false);
```

**검증**: `npm test -- tests/freshness.test.ts`

---

### P0-2. weights.test.ts typo 수정

**현황**: 이미 수정 완료 (`'{""/a":"high"}'` → `'{"/a":"high"}'`).
**상태**: ✅ 해결됨

---

## P1 — 단기 (기능 정확성/완결성)

### P1-1. `circle.ts` needsSummary에 rerunDates 병합

**현황**:
```ts
// circle.ts line 864
needsSummary: airResult.changedDates,  // rerunDates 누락
```
`allChanged`(air + rerun 병합)는 `autoSummarize`에 전달되지만, `CircleResult.needsSummary`는 `airResult.changedDates`만 반환. 호출자(out.ts, SKILL.md)가 rerun된 날짜를 식별할 수 없음.

**수정 계획**:

```diff
# src/core/circle.ts — runCircle 반환부
  return {
    airResult,
    finalized,
-   needsSummary: airResult.changedDates,
+   needsSummary: allChanged,
    summaryErrors,
  };
```

**테스트 영향**:
- `tests/circle.test.ts` rerun 테스트에서 `needsSummary` 검증 추가 가능:
```ts
it("needsSummary includes rerun dates", async () => {
  // ... setup ...
  const result = await runCircle(adapter, { rerun: [date], ... });
  expect(result.needsSummary).toContain(date);
});
```

**검증**: `npm test -- tests/circle.test.ts`

---

### P1-2. renderer.ts `resolveAiProvider` catch 경로 테스트

**현황**:
```ts
// renderer.ts line 223
const aiProvider = await resolveAiProvider(storage).catch(() => null);
```
`resolveAiProvider`는 정상 상황에서 에러를 던지지 않으므로 `.catch` 경로에 도달할 수 없음. `getConfig`가 throw하는 경우(DB 손상 등)에만 도달.

**수정 계획**:
1. 테스트 추가: `email-render.test.ts`에 mock storage로 `getConfig` throw 유도
2. 또는: `.catch(() => null)` 대신 명시적 try/catch + 로그

```ts
// 옵션 A: 테스트만 추가 (기존 코드 유지)
it("resolveAiProvider throw 시 배지 미출력", async () => {
  // getConfig가 throw하는 storage 주입 (SqlJsAdapter 래핑)
  // → aiProvider = null → 배지 미출력
});
```

```ts
// 옵션 B: catch에 경고 로그 추가
const aiProvider = await resolveAiProvider(storage).catch((err) => {
  console.warn(`  ⚠️  AI provider detection failed: ${err.message}`);
  return null;
});
```

**추천**: 옵션 A (테스트만 추가). 코드 변경 최소화.

**검증**: `npm test -- tests/e2e/email-render.test.ts`

---

### P1-3. `runDoctor`에 today 파라미터 주입

**현황**:
```ts
// doctor.ts
export async function runDoctor(storage: StorageAdapter, days = 14): Promise<DoctorRow[]> {
  const today = new Date();  // 내부에서 현재 시각 사용
```
테스트에서 `vi.useFakeTimers()`를 사용해야 하므로 타이머 오염 위험.

**수정 계획**:
```diff
- export async function runDoctor(storage: StorageAdapter, days = 14): Promise<DoctorRow[]> {
-   const today = new Date();
+ export async function runDoctor(storage: StorageAdapter, days = 14, today?: Date): Promise<DoctorRow[]> {
+   const now = today ?? new Date();
```

**테스트 영향**:
- `tests/doctor.test.ts`에서 `vi.useFakeTimers()` 제거 가능
- `runDoctor(storage, 3, new Date(2026, 3, 16))`으로 날짜 직접 전달

**검증**: `npm test -- tests/doctor.test.ts`

---

## P2 — 중기 (코드 품질/유지보수)

### P2-1. 공유 test helper 파일

**현황**: 6개 테스트 파일에서 `createAdapter`, `makeDailyReport`, `makeGatherReport`, `createMockStorage` 등이 각각 인라인으로 정의됨. 중복 ~120줄.

**수정 계획**:
1. `tests/helpers.ts` 생성
2. 공통 팩토리/유틸 추출:

```ts
// tests/helpers.ts
export function createAdapter(): Promise<{ adapter: SqlJsAdapter; tmpDir: string }>;
export function cleanupAdapter(adapter: SqlJsAdapter, tmpDir: string): Promise<void>;
export function makeDailyReport(overrides?: Partial<DailyReport>): DailyReport;
export function makeGatherReport(overrides?: Partial<GatherReport>): GatherReport;
export function createMockStorage(entries?: Record<string, string>): {
  storage: StorageAdapter; configMap: Map<string, string>;
};
```

3. 기존 테스트에서 import로 교체

**영향받는 파일**:
- `tests/freshness.test.ts` — `createAdapter`, `makeDailyReport`, `makeGatherReport`
- `tests/doctor.test.ts` — `createMockStorage`, `makeDailyReport`
- `tests/ai-provider.test.ts` — `createMockStorage`
- `tests/weights.test.ts` — `createMockStorage`
- `tests/circle.test.ts` — `createAdapter`
- `tests/e2e/email-render.test.ts` — `createAdapter`, `makeSession` 등

**검증**: `npm test` 전체 통과

---

### P2-2. guard-out.sh에 `set -e` + verify 실패 처리 결정

**현황**:
```bash
verify_output="$(sincenety out --verify 2>/dev/null)"
```
`sincenety out --verify`가 에러로 종료(exit 1)하면 `verify_output`이 빈 문자열 → MISSING/STALE 미감지 → 가드 통과.

**옵션 A (현재 유지 — 조용히 통과)**:
- 장점: hook 실패가 사용자 작업을 블록하지 않음
- 단점: DB 미초기화 상태에서 요약 없이 발송 가능

**옵션 B (에러 시 블록)**:
```bash
verify_output="$(sincenety out --verify 2>&1)" || {
  echo "sincenety out --verify failed — run /sincenety first" >&2
  exit 2
}
```
- 장점: 안전 — DB 문제도 감지
- 단점: DB 미설치 상태에서 모든 out 명령 블록됨

**옵션 C (에러 시 경고만)**:
```bash
verify_output="$(sincenety out --verify 2>/dev/null)" || {
  echo "⚠️ sincenety verify unavailable — proceeding without check" >&2
  exit 0
}
```

**추천**: 옵션 C. 에러 시 경고를 남기되 블록하지 않음.

**검증**: `npm test -- tests/guard-hook.test.ts`

---

### P2-3. `resolveAiProvider` 결과에 따른 배지 표시 정책

**현황**: `"heuristic"` provider도 이메일 footer에 `AI: heuristic`으로 표시됨. 이는 사용자에게 혼란을 줄 수 있음 — heuristic은 "AI 없음"을 의미하므로.

**수정 계획**:
```diff
# src/email/renderer.ts
- aiProvider: aiProvider ?? undefined,
+ aiProvider: aiProvider && aiProvider !== "heuristic" ? aiProvider : undefined,
```

**테스트 영향**:
- `tests/e2e/email-render.test.ts` "AI provider 미설정 시 heuristic으로 표시" → "AI provider 미설정 시 배지 미출력"으로 변경

**검증**: `npm test -- tests/e2e/email-render.test.ts`

---

### P2-4. `printVerifyTable` / `printDoctorTable` 유니코드 정렬

**현황**: 이모지(✅, ⚠️, ⛔, ❌, ⬜, 📧)의 터미널 폭이 환경마다 달라 테이블 정렬이 깨질 수 있음.

**수정 계획**:
1. 기존 `displayWidth()` 함수(`cli.ts`에 존재)를 `src/util/display-width.ts`로 추출
2. `printVerifyTable`/`printDoctorTable`에서 `padEndW`를 사용하여 이모지 폭 보정

**영향**: `src/core/out.ts`, `src/core/doctor.ts`, `src/cli.ts` (공통 유틸 추출)

**검증**: 수동 — 터미널에서 `sincenety doctor` 및 `sincenety out --verify` 실행

---

## 실행 우선순위 및 일정

```
Phase 1 — P0 (즉시, 30분)
├── P0-1. emailedAt=0 비대칭 통일 ← 데이터 무결성
└── P0-2. ✅ 이미 완료

Phase 2 — P1 (단기, 1시간)
├── P1-1. needsSummary에 rerunDates 병합
├── P1-2. resolveAiProvider catch 테스트 추가
└── P1-3. runDoctor today 파라미터 주입

Phase 3 — P2 (중기, 2~3시간)
├── P2-1. 공유 test helper 파일
├── P2-2. guard-out.sh 에러 처리
├── P2-3. heuristic 배지 미표시
└── P2-4. 유니코드 정렬 보정
```

---

## 변경 파일 요약

| 개선 | 수정 파일 | 테스트 파일 |
|------|----------|------------|
| P0-1 | `sqljs-adapter.ts` (2줄) | `freshness.test.ts` (1개 기대값) |
| P1-1 | `circle.ts` (1줄) | `circle.test.ts` (+1개 검증) |
| P1-2 | - | `email-render.test.ts` (+1개) |
| P1-3 | `doctor.ts` (2줄) | `doctor.test.ts` (리팩터링) |
| P2-1 | - | `tests/helpers.ts` 신설, 6개 파일 import 변경 |
| P2-2 | `hooks/guard-out.sh` (3줄) | `guard-hook.test.ts` (#7 수정) |
| P2-3 | `renderer.ts` (1줄) | `email-render.test.ts` (#2 수정) |
| P2-4 | `out.ts`, `doctor.ts`, `cli.ts` → `util/display-width.ts` | 수동 확인 |
