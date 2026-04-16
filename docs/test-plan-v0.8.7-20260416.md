# sincenety v0.8.7 테스트 계획

> 작성일: 2026-04-16
> 수정일: 2026-04-16 (코드 크로스체크 반영)
> 대상: v0.8.6에서 추가된 9개 신규 기능

## 개요

v0.8.6에서 9개 기능을 구현했다:

| # | 기능 | 소스 파일 |
|---|------|-----------|
| 1 | 신선도 검증 | `storage/adapter.ts`, `storage/sqljs-adapter.ts`, `core/out.ts` |
| 2 | 구조화된 exit code | `core/ai-provider.ts` |
| 3 | `sincenety doctor` 명령 | `core/doctor.ts`, `cli.ts` |
| 4 | `out --verify` 플래그 | `core/out.ts`, `cli.ts` |
| 5 | 이메일 출처 배지 | `email/template.ts`, `email/renderer.ts` |
| 8 | PreToolUse hook 가드 | `hooks/guard-out.sh` |
| 10 | `circle --rerun` 플래그 | `core/circle.ts`, `cli.ts` |
| 12 | 프로젝트별 중요도 가중치 | `core/weights.ts`, `email/renderer.ts`, `cli.ts` |
| 14 | e2e 이메일 테스트 | `tests/e2e/email-render.test.ts`, `tests/e2e/email-ethereal.test.ts` |

기존 180개 테스트는 모두 통과 중이나, 신규 코드의 브랜치/엣지케이스 커버리지가 부족하다. 총 **~93개 신규 테스트**를 8개 파일(5개 신규 + 3개 기존 확장)에 추가한다.

---

## 테스트 파일 상세

### 1. `tests/freshness.test.ts` (신규, ~14개)

**대상**: `sqljs-adapter.ts`의 `getDailyReportFreshness()`, `invalidateDailyReport()`

**전략**: 실제 SqlJsAdapter + tmpdir (integration test)

#### getDailyReportFreshness (10개)

| # | 테스트명 | 설정 | 검증 |
|---|---------|------|------|
| 1 | gather/daily 둘 다 없으면 null | 빈 DB | 반환값 `null` |
| 2 | daily만 존재 | DailyReport만 저장 | `{hasDailyReport:true, hasGatherReport:false, stale:false}` |
| 3 | gather만 존재 | GatherReport만 저장 (reportDate 포함) | `{hasDailyReport:false, hasGatherReport:true, stale:false}` |
| 4 | stale 판정 | gather.updatedAt=2000 > daily.createdAt=1000 | `stale:true` |
| 5 | 신선 판정 | daily.createdAt=2000 >= gather.updatedAt=1000 | `stale:false` |
| 6 | emailed=true | daily에 emailedAt 설정 | `emailed:true` |
| 7 | emailed=false | emailedAt=null | `emailed:false` |
| 8 | timestamp 정확도 | 특정 값 저장 → 조회 | 저장한 timestamp와 일치 |
| 9 | weekly/monthly 타입 | gather + weekly daily 저장 | `hasGatherReport:false` (코드: `type === "daily"` 일 때만 gather 조회) |
| 10 | **gather.updatedAt=null (v3 마이그레이션 레거시)** | gather 저장 시 updatedAt=null | `stale:false` (stale 조건에 `gatherUpdatedAt != null` 체크) |

> **주의**: `emailedAt=0`은 JS에서 falsy — `!!emailedAt`은 `false`, `emailedAt != null`은 `true`. `getDailyReportFreshness`는 `!!` 사용(→ emailed=false), `invalidateDailyReport`는 `if (existing.emailedAt)` 사용(→ 무효화 진행). 이 비대칭은 잠재적 버그이며 테스트 #13에서 현재 동작을 문서화한다.

#### invalidateDailyReport (6개)

| # | 테스트명 | 설정 | 검증 |
|---|---------|------|------|
| 11 | 미발송 보고서 무효화 | finalized, emailedAt=null | 반환 `true`, status='stale', data_hash=NULL |
| 12 | 존재하지 않는 날짜 | 빈 DB | 반환 `false` |
| 13 | 이미 발송된 보고서 보호 | emailedAt=12345 | 반환 `false`, 보고서 변경 없음 |
| 14 | emailedAt=0 동작 (falsy 특성) | emailedAt=0 | 반환 `true` (0은 falsy → `if (existing.emailedAt)` 통과 → 무효화 진행) |
| 15 | weekly 타입 지원 | weekly report 저장 | 반환 `true` |
| 16 | **monthly 타입 지원** | monthly report 저장 | 반환 `true` |

---

### 2. `tests/ai-provider.test.ts` (신규, ~13개)

**대상**: `ai-provider.ts`의 `detectAiProvider()`, `assertAiReadyForCliPipeline()`, `emitNeedsSkillAndExit()`

**전략**: 순수 함수 직접 테스트 + `process.exit`/`process.stdout.write` mock

#### detectAiProvider (8개)

| # | 테스트명 | 입력 config | 기대값 |
|---|---------|------------|--------|
| 1 | explicit cloudflare + 자격증명 | `{provider:"cloudflare", accountId:"x", apiToken:"y"}` | `"cloudflare"` |
| 2 | explicit cloudflare 자격증명 없음 → fallthrough | `{provider:"cloudflare", anthropicKey:"k"}` | `"anthropic"` |
| 3 | explicit anthropic + key | `{provider:"anthropic", anthropicKey:"k"}` | `"anthropic"` |
| 4 | explicit anthropic key 없음 → fallthrough | `{provider:"anthropic", accountId:"a", apiToken:"t"}` | `"cloudflare"` |
| 5 | explicit claude-code | `{provider:"claude-code"}` | `"claude-code"` |
| 6 | 자동감지: d1 토큰 | `{accountId:"a", apiToken:"t"}` | `"cloudflare"` |
| 7 | 자동감지: anthropic key | `{anthropicKey:"k"}` | `"anthropic"` |
| 8 | 전부 없음 | 모두 null | `"heuristic"` |

#### assertAiReadyForCliPipeline (5개)

| # | 테스트명 | 설정 | 기대값 |
|---|---------|------|--------|
| 9 | cloudflare 통과 | mock storage: ai_provider=cloudflare, d1 자격증명 | 정상 resolve |
| 10 | anthropic 통과 | mock storage: anthropic key 설정 | 정상 resolve |
| 11 | claude-code + needsSkillCommand → JSON exit | mock storage: ai_provider=claude-code | stdout에 `action:"needs_skill"` JSON, exit(2) |
| 12 | claude-code + command 없음 → throw | mock storage: ai_provider=claude-code | Error: "슬래시 명령" |
| 13 | heuristic → throw | mock storage: 빈 설정 | Error: "AI provider가 구성되지 않아" |

> **주의**: `assertAiReadyForCliPipeline`은 내부에서 `loadAiProviderConfig(storage)`를 호출하여 DB config를 읽는다. mock storage의 `getConfig`가 올바른 키(`ai_provider`, `d1_account_id`, `d1_api_token`, `anthropic_api_key`)를 반환하도록 설정해야 한다.

#### resolveAiProvider + ANTHROPIC_API_KEY env (2개 추가)

| # | 테스트명 | 설정 | 기대값 |
|---|---------|------|--------|
| 14 | **ANTHROPIC_API_KEY env가 DB 값보다 우선** | DB anthropic_api_key=null, env ANTHROPIC_API_KEY="sk-xxx" | `"anthropic"` |
| 15 | **resolveAiProvider 비동기 래퍼** | mock storage with cloudflare config | `resolveAiProvider(storage)` returns `"cloudflare"` |

**Mock 패턴**:
```ts
vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); })
vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
// env mock for test #14:
const origEnv = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = "sk-xxx";
afterEach(() => { process.env.ANTHROPIC_API_KEY = origEnv; })
```

---

### 3. `tests/doctor.test.ts` (신규, ~12개)

**대상**: `doctor.ts`의 `runDoctor()`, `printDoctorTable()`

**전략**: mock storage + `vi.useFakeTimers()` (날짜 고정: 2026-04-16)

#### runDoctor (10개)

| # | 테스트명 | freshness 반환값 | 기대 status |
|---|---------|-----------------|------------|
| 1 | 데이터 없는 기간 | null (전부) | 모두 `NO_DATA` |
| 2 | 정상 데이터 | `{hasDailyReport:true, hasGatherReport:true, stale:false}` + 유효 summaryJson | `OK` |
| 3 | gather만 있음 | `{hasDailyReport:false, hasGatherReport:true}` | `MISSING_SUMMARY` |
| 4 | daily 있으나 빈 요약 | summaryJson=`"[]"` | `EMPTY_SUMMARY` |
| 5 | 깨진 summaryJson | summaryJson=`"{broken"` | `EMPTY_SUMMARY` |
| 6 | stale 상태 | `{stale:true}` + 유효 summaryJson | `STALE` |
| 7 | 기본 days=14 | - | `rows.length === 14` |
| 8 | 커스텀 days=3 | - | `rows.length === 3` |
| 9 | 날짜 내림차순 | - | `rows[0].date > rows[1].date` |
| 10 | emailed 플래그 반영 | `{emailed:true}` | `row.emailed === true` |

#### printDoctorTable (4개)

| # | 테스트명 | 입력 rows | 검증 |
|---|---------|----------|------|
| 11 | 테이블 헤더 | 임의 | console.log에 "sincenety doctor" 포함 |
| 12 | **STALE row → `--rerun` 제안** | `[{status:"STALE", date:"2026-04-15"}]` | 출력에 `--rerun 2026-04-15` 포함 |
| 13 | **MISSING_SUMMARY row → `/sincenety` 또는 `circle` 제안 (--rerun 아님)** | `[{status:"MISSING_SUMMARY"}]` | 출력에 `/sincenety` 포함, `--rerun` 미포함 |
| 14 | **아이콘 매핑** | OK/STALE/EMPTY_SUMMARY/MISSING_SUMMARY/NO_DATA 각 1개 | ✅/⚠️/⛔/❌/⬜ 각각 출력 |

> **주의**: `runDoctor`는 내부에서 `getDailyReportFreshness` **AND** `getDailyReport`를 호출한다 (`hasDailyReport=true`일 때 summaryJson 파싱을 위해). mock storage는 반드시 두 메서드 모두 stub해야 한다.

**Fake Timer 설정**:
```ts
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 3, 16)); })
afterEach(() => { vi.useRealTimers(); })
```

---

### 4. `tests/weights.test.ts` (신규, ~18개)

**대상**: `weights.ts`의 모든 exported 함수

**전략**: 순수 함수 직접 테스트 + mock storage (config Map)

#### isWeightLevel (6개)

| # | 입력 | 기대값 |
|---|-----|--------|
| 1 | `"high"` | `true` |
| 2 | `"normal"` | `true` |
| 3 | `"low"` | `true` |
| 4 | `"critical"` | `false` |
| 5 | `42` | `false` |
| 6 | `null` | `false` |

#### resolveWeight (6개)

| # | weights 맵 | projectKey | 기대값 |
|---|-----------|------------|--------|
| 7 | `{"/a/b":"high"}` | `"/a/b"` | `"high"` |
| 8 | `{"myproject":"low"}` | `"/home/user/myproject"` | `"low"` (basename fallback) |
| 9 | `{"other":"high"}` | `"unmatched"` | `"normal"` |
| 10 | `{"x":"high"}` | `""` | `"normal"` |
| 11 | `{"/a/b":"high","b":"low"}` | `"/a/b"` | `"high"` (정확 우선) |
| 12 | `{"proj":"low"}` | `"/home/proj/"` | `"low"` (trailing slash) |

#### getProjectWeights (5개)

| # | config 값 | 기대값 |
|---|----------|--------|
| 13 | 키 없음 | `{}` |
| 14 | `'{"a":"high","b":"low"}'` | `{a:"high", b:"low"}` |
| 15 | `'{"a":"critical","b":"low"}'` | `{b:"low"}` (유효하지 않은 값 필터) |
| 16 | `"not json"` | `{}` |
| 17 | **`'"string"'` (유효 JSON이지만 non-object)** | `{}` |

#### resolveWeight 추가 (1개)

| # | weights 맵 | projectKey | 기대값 |
|---|-----------|------------|--------|
| 18 | **`{}`** | **`"myproject"` (슬래시 없음)** | `"normal"` (exact miss → basename = 자기 자신 → miss → default) |

#### setProjectWeight (4개)

| # | 테스트명 | 검증 |
|---|---------|------|
| 19 | 신규 추가 | `{}` → `{"/a":"high"}` |
| 20 | 기존 업데이트 | `"high"` → `"low"` |
| 21 | `"clear"`로 삭제 | `{"/a":"high"}` → `{}` |
| 22 | 다른 키 보존 | `{"/a":"high","/b":"low"}` → clear "/a" → `{"/b":"low"}` |

---

### 5. `tests/guard-hook.test.ts` (신규, ~5개)

**대상**: `hooks/guard-out.sh` 쉘 스크립트

**전략**: `child_process.execSync` + PATH에 mock sincenety 바이너리 주입

| # | stdin JSON | mock sincenety 출력 | 기대값 |
|---|-----------|---------------------|--------|
| 1 | `{"tool_name":"Read","tool_input":{}}` | - | exit 0 (Bash 아님, verify 미실행) |
| 2 | `{"tool_name":"Bash","tool_input":{"command":"ls -la"}}` | - | exit 0 (sincenety out 아님) |
| 3 | `{"tool_name":"Bash","tool_input":{"command":"sincenety circle"}}` | - | exit 0 (out 아님) |
| 4 | `{"tool_name":"Bash","tool_input":{"command":"sincenety outd"}}` | echo "MISSING" | exit 2 + stderr "Run /sincenety first" |
| 5 | `{"tool_name":"Bash","tool_input":{"command":"sincenety out"}}` | echo "✅ OK" | exit 0 |
| 6 | **`{"tool_name":"Bash","tool_input":{"command":"sincenety outd"}}` (outd 패턴)** | echo "✅ OK" | exit 0 (outd도 감지됨 — `grep 'sincenety out'` 매칭) |
| 7 | **`sincenety out --verify` 자체가 실패 (DB 없음 등)** | exit 1 (에러) | exit 0 (verify 실패 시 `2>/dev/null`로 출력 비고 → MISSING/STALE 미감지 → 통과) |

**Mock binary 생성**: tmpdir에 `sincenety` 스크립트 생성 → `echo` 고정 출력, `chmod +x`, PATH 앞에 추가

> **주의**: 스크립트의 `grep 'sincenety out'`은 `outd`/`outw`/`outm`도 모두 매칭한다 (의도된 동작). 테스트 #6에서 이를 명시적으로 확인한다. 테스트 #7은 `sincenety out --verify` 자체가 에러로 종료되는 경우(DB 없음 등) 스크립트가 조용히 통과하는 동작을 검증 — 이는 정상적인 fallback이지만 인지해야 할 동작이다.

---

### 6. `tests/out.test.ts` (기존 확장, +10개)

**대상**: `out.ts`의 `printVerifyTable()`, `findUnsentReports()`

#### printVerifyTable (6개)

| # | 테스트명 | 검증 |
|---|---------|------|
| 1 | 헤더 출력 | console.log에 "Verify report readiness" 포함 |
| 2 | OK 상태 마크 | "✅ OK" 출력 |
| 3 | MISSING 상태 마크 | "❌ MISSING" 출력 |
| 4 | STALE 상태 마크 | "⚠️  STALE" 출력 |
| 5 | EMAILED 상태 마크 | "📧 SENT" 출력 |
| 6 | 빈 배열 | 크래시 없이 테이블 구조 출력 |

#### findUnsentReports (5개)

| # | 테스트명 | mock getDailyReport | 기대값 |
|---|---------|--------------------|----|
| 7 | finalized+미발송 weekly | finalized, emailedAt=null | `["weekly"]` |
| 8 | 이미 발송 weekly | emailedAt 존재 | `[]` |
| 9 | 전월 미발송 monthly | finalized, emailedAt=null | `["monthly"]` |
| 10 | 둘 다 미발송 | 양쪽 finalized | `["weekly","monthly"]` |
| 11 | **월초(1~7일) 지난주 계산이 이전 달로 넘어가는 케이스** | today=2026-04-03 → lastWeek=2026-03-27 → monday=2026-03-23 | 올바른 주차 키로 조회 |

---

### 7. `tests/circle.test.ts` (기존 확장, +6개)

**대상**: `runCircle`의 `rerun` 옵션

**전략**: 실제 SqlJsAdapter, AI는 cloudflare mock (기존 circle.test.ts 패턴)

| # | 테스트명 | 설정 | 검증 |
|---|---------|------|------|
| 1 | rerun → invalidate + changedDates 병합 | finalized daily, emailedAt=null | changedDates에 해당 날짜 포함 |
| 2 | 이미 발송 → 스킵 + 경고 | emailedAt=12345 | console.warn 호출, changedDates 미포함 |
| 3 | 존재하지 않는 날짜 → 경고 | 빈 DB | console.warn 호출, 크래시 없음 |
| 4 | 복수 날짜 혼합 | 1개 발송 + 1개 미발송 | 미발송 것만 changedDates에 포함 |
| 5 | smart 모드 + rerun 조합 | mode="smart" | invalidation 수행, weekly/monthly 스킵 |
| 6 | changedDates 중복 제거 | air가 감지한 날짜 + rerun 동일 날짜 | Set으로 중복 없음 |

---

### 8. `tests/e2e/email-render.test.ts` (기존 확장, +4개)

**대상**: 이메일 배지(#5) + 가중치 렌더링(#12)

| # | 테스트명 | 설정 | 검증 |
|---|---------|------|------|
| 1 | AI provider 배지 렌더링 | ai_provider=cloudflare + d1 자격증명 | HTML에 "AI: cloudflare" 포함 |
| 2 | provider 미설정 시 배지 미출력 | AI config 없음 | HTML에 "AI:" 미포함 |
| 3 | low weight 프로젝트 축약 | project_weights에 low 등록 | **Flow/nextSteps 섹션 미포함, 단 wrapUp 카드 자체는 존재** (축약 1줄 표시) |
| 4 | high/normal weight 전체 유지 | project_weights에 high 등록 | HTML에 Flow/nextSteps 포함 |
| 5 | **resolveAiProvider 에러 시 배지 미출력** | config에 잘못된 provider 설정 (`.catch(() => null)` 경로) | HTML에 "AI:" 미포함 |

---

## 횡단 관심사

### Mock Storage 확장

기존 mock storage에 신규 인터페이스 메서드 추가 필요:

```ts
getDailyReportFreshness: vi.fn().mockResolvedValue(null),
invalidateDailyReport: vi.fn().mockResolvedValue(false),
```

각 테스트 파일에서 인라인으로 확장 (공유 fixture 파일 없음 — 기존 패턴 유지).

### Fake Timers

`doctor.test.ts`에서 `new Date()` 의존 → 날짜 고정 필수:

```ts
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 3, 16)); })
afterEach(() => { vi.useRealTimers(); })
```

### process.exit / stdout Mock

`ai-provider.test.ts`에서 `emitNeedsSkillAndExit()` 테스트:

```ts
vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`exit:${code}`);
})
vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
```

`expect(() => emitNeedsSkillAndExit(signal)).toThrow("exit:2")`로 검증.

---

## 실행 순서 (병렬화 가능 구간)

```
Phase 1 (독립, 병렬 subagent 3개)
├── freshness.test.ts
├── weights.test.ts
└── ai-provider.test.ts

Phase 2 (독립, 병렬 subagent 2개)
├── doctor.test.ts
└── guard-hook.test.ts

Phase 3 (기존 파일 수정, 순차)
├── out.test.ts 확장
├── circle.test.ts 확장
└── email-render.test.ts 확장
```

---

## 검증

```bash
npm run build && npm test
```

- 기존 180 passed + 신규 ~96 = **~276 tests** 전부 통과
- `ETHEREAL_TEST=1 npm test`로 e2e SMTP 포함 검증 (옵셔널)

---

## 요약 테이블

| 파일 | 대상 기능 | 신규/확장 | 예상 테스트 수 |
|------|----------|----------|-------------|
| `tests/freshness.test.ts` | #1 신선도 | 신규 | 16 |
| `tests/ai-provider.test.ts` | #2 구조화 exit | 신규 | 15 |
| `tests/doctor.test.ts` | #3 Doctor | 신규 | 14 |
| `tests/weights.test.ts` | #12 가중치 | 신규 | 22 |
| `tests/guard-hook.test.ts` | #8 Hook 가드 | 신규 | 7 |
| `tests/out.test.ts` | #4 Verify | 확장 | +11 |
| `tests/circle.test.ts` | #10 Rerun | 확장 | +6 |
| `tests/e2e/email-render.test.ts` | #5 배지, #12 렌더 | 확장 | +5 |
| **합계** | | | **~96** |

---

## 리뷰 반영 사항 (2026-04-16 코드 크로스체크)

코드 리뷰에서 발견된 12개 이슈를 반영했다:

| # | 카테고리 | 내용 | 대응 |
|---|---------|------|------|
| 1 | **정확성** | freshness #9 설명 오류 — "gather는 daily 전용"이 아니라 코드가 `type === "daily"` 조건부로 조회 | 설명 수정 |
| 2 | **누락** | gather.updatedAt=null (v3 마이그레이션 레거시 데이터) 경로 미테스트 | freshness #10 추가 |
| 3 | **누락** | invalidateDailyReport monthly 타입 미테스트 | freshness #16 추가 |
| 4 | **잠재 버그** | emailedAt=0의 `!!` vs `if()` 비대칭 — 문서화 + 명시적 테스트 | freshness 주의사항 추가, #14 보강 |
| 5 | **누락** | ANTHROPIC_API_KEY env var 우선순위 미테스트 | ai-provider #14 추가 |
| 6 | **누락** | resolveAiProvider 비동기 래퍼 미테스트 | ai-provider #15 추가 |
| 7 | **정확성** | doctor #12가 STALE/MISSING 제안을 혼동 — 실제 코드는 다른 메시지 출력 | doctor #12/#13 분리 |
| 8 | **누락** | doctor mock에 getDailyReport stub 필요 (getDailyReportFreshness만으로 불충분) | 주의사항 추가 |
| 9 | **누락** | doctor printDoctorTable 아이콘 매핑 미테스트 | doctor #14 추가 |
| 10 | **정확성** | email-render #3: low weight는 wrapUp 카드 전체 제거가 아니라 Flow/nextSteps만 축약 | 검증 기준 수정 |
| 11 | **누락** | guard-hook에서 outd 패턴 매칭 + verify 실패 시 조용한 통과 미테스트 | guard-hook #6/#7 추가 |
| 12 | **누락** | findUnsentReports 월초 경계 (1~7일에서 이전 달로 넘어가는 주차 계산) | out #11 추가 |
