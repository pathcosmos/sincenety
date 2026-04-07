# sincenety

> **[English Documentation (README.md)](./README.md)**

**Claude Code 작업 갈무리 도구** — `sincenety` 한 번 실행으로 마지막 갈무리 이후의 모든 Claude Code 작업을 자동 분석하여 구조화된 기록을 생성합니다.

start/stop 없이, 실행 시점 기준으로 소급하여 모든 작업을 정리합니다.

```
$ sincenety

  📋 2026년 4월 7일 화요일 작업 갈무리 (12:00 ~ 18:05)
  총 4개 세션, 1605개 메시지 | 토큰: 9.0Kin / 212.7Kout
  ────────────────────────────────────────────────────────
  [claudflare_web] 11:22 ~ 14:49 (3시간 28분, 445msg, 66.4Ktok)
    pathcosmos.com 보안 강화 + 웹 분석 구축
    모델: claude-opus-4-6
  ...
  ✅ 갈무리 완료. 기록이 저장되었습니다.
```

---

## 핵심 기능

### 소급 갈무리

별도 기록 행위 없이, `sincenety` 실행 시 마지막 갈무리 시점 이후의 `~/.claude/` 데이터를 분석하여 프로젝트별/세션별 작업 내용을 자동 재구성합니다.

- **세션 JSONL 파싱** — `~/.claude/projects/[project]/[sessionId].jsonl`에서 토큰 사용량, 모델명, 정밀 타임스탬프 추출
- **history.jsonl 보조 인덱스** — 빠른 세션 목록 조회용
- **갈무리 포인트** — 매 실행 시 "여기까지 정리했음" 마커를 저장하여 중복 없이 이어서 정리

### 풍부한 작업 기록

| 항목 | 설명 |
|------|------|
| 작업 타이틀 | 첫 사용자 메시지에서 자동 추출 |
| 작업 설명 | 주요 사용자 메시지 3~5개 연결 |
| 토큰 사용량 | 입력/출력/캐시 토큰 메시지별 합산 |
| 작업 시간 | 첫 메시지 ~ 마지막 메시지 정밀 측정 |
| 사용 모델 | assistant 응답에서 모델명 추출 |
| 카테고리 | 프로젝트 경로 기반 자동 분류 |

### 이메일 리포트

Gmail SMTP를 통해 갈무리 리포트를 이메일로 발송합니다. 세션별 컬러 코딩, 토큰 대시보드, 갈무리 요약이 포함된 HTML 이메일입니다.

### 자동 스케줄링

오후 6시(기본)에 자동으로 갈무리 + 이메일 발송. macOS는 launchd, Linux는 crontab을 자동으로 설정합니다.

### 암호화 저장

모든 데이터는 AES-256-GCM으로 암호화되어 `~/.sincenety/sincenety.db`에 저장됩니다. 머신 바운드 키(hostname + username + 랜덤 salt)를 기본으로 사용하며, 선택적으로 passphrase를 설정할 수 있습니다.

---

## 설치 및 사용

### 설치

```bash
# npx로 즉시 실행 (향후 npm publish 후)
npx sincenety@latest

# 또는 로컬 빌드
git clone <repo-url>
cd sincenety
npm install
npm run build
npm link   # 글로벌 등록
```

### 기본 사용

```bash
# 갈무리 (마지막 포인트 이후)
sincenety

# 특정 시점부터 갈무리
sincenety --since "09:00"
sincenety --since "2026-04-07 09:00"

# 빠른 모드 (토큰 추출 없이 history.jsonl만 사용)
sincenety --no-detail

# 작업 로그 조회
sincenety log
sincenety log --date 2026-04-06
sincenety log --week
```

### 이메일 설정

```bash
# 수신 이메일
sincenety config --email user@gmail.com

# SMTP 설정 (Gmail 앱 비밀번호)
sincenety config --smtp-user sender@gmail.com
sincenety config --smtp-pass   # 프롬프트에서 비밀번호 입력 (쉘 히스토리 노출 방지)

# 이메일 발송
sincenety email
sincenety email --date 2026-04-06
```

> Gmail 앱 비밀번호 생성: https://myaccount.google.com/apppasswords

### 자동 갈무리 스케줄

```bash
# 오후 6시 자동 갈무리 + 이메일 설치
sincenety schedule --install

# 시간 변경
sincenety schedule --install --time 19:00

# 상태 확인 / 해제
sincenety schedule --status
sincenety schedule --uninstall
```

### Claude Code Skill

Claude Code 안에서 `/sincenety`로 직접 호출 가능합니다. `~/.claude/skills/sincenety/SKILL.md`에 등록됩니다.

---

## 아키텍처

```
sincenety/
├── src/
│   ├── cli.ts                  # CLI 진입점 (commander, 5개 서브커맨드)
│   ├── core/
│   │   └── gatherer.ts         # 갈무리 핵심 로직 (파싱→그룹핑→저장→리포트)
│   ├── parser/
│   │   ├── history.ts          # ~/.claude/history.jsonl 스트리밍 파서
│   │   └── session-jsonl.ts    # 세션 JSONL 파서 (토큰/모델/타이밍 추출)
│   ├── grouper/
│   │   └── session.ts          # sessionId+project 기준 그룹핑
│   ├── storage/
│   │   ├── adapter.ts          # StorageAdapter 인터페이스
│   │   └── sqljs-adapter.ts    # sql.js 구현 (암호화 DB, 자동 마이그레이션)
│   ├── encryption/
│   │   ├── key.ts              # PBKDF2 키 파생 (머신 바운드 + passphrase)
│   │   └── crypto.ts           # AES-256-GCM encrypt/decrypt
│   ├── report/
│   │   ├── terminal.ts         # 터미널 출력 포매터
│   │   └── markdown.ts         # 마크다운 리포트 생성
│   ├── email/
│   │   ├── sender.ts           # nodemailer 이메일 발송
│   │   └── template.ts         # Bright 컬러코딩 HTML 이메일 템플릿
│   ├── scheduler/
│   │   └── install.ts          # launchd/cron 자동 설치
│   └── types/
│       └── sql.js.d.ts         # sql.js 타입 정의
├── tests/
│   └── encryption.test.ts      # 암호화 테스트 (26개)
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
~/.claude/projects/[project]/[sessionId].jsonl  ──→  토큰/모델/타이밍 추출
                                    │
                                    ▼
                             그룹핑 + 요약 생성
                                    │
                     ┌──────────────┼──────────────┐
                     ▼              ▼              ▼
              터미널 출력     DB 저장 (암호화)    이메일 발송
```

### DB 스키마

**4개 테이블:**

| 테이블 | 설명 |
|--------|------|
| `sessions` | 세션별 작업 기록 (22개 컬럼 — 토큰, 시간, 타이틀, 설명, 모델 등) |
| `gather_reports` | 갈무리 실행마다 리포트 저장 (마크다운 + JSON) |
| `checkpoints` | 갈무리 포인트 (마지막 처리 timestamp) |
| `config` | 설정 (이메일, SMTP 등) |

DB 파일: `~/.sincenety/sincenety.db` (AES-256-GCM 암호화, 0600 권한)

### 암호화 상세

- **알고리즘**: AES-256-GCM (인증된 암호화)
- **키 파생**: PBKDF2 (SHA-256, 100,000 iterations)
- **키 소스**: `hostname + username + 랜덤 salt` (머신 바운드)
- **Salt**: `~/.sincenety/sincenety.salt` (32바이트 랜덤, 설치 시 1회 생성, 0600 권한)
- **파일 포맷**: `[4B magic "SNCT"][12B IV][ciphertext][16B auth tag]`
- **선택적 passphrase**: `sincenety config --set-passphrase` (향후 구현 예정)

---

## 기술 스택

| 구성요소 | 기술 |
|---------|------|
| 언어 | TypeScript (ESM, Node16 모듈) |
| 런타임 | Node.js >= 18 |
| CLI | commander |
| DB | sql.js (WASM SQLite, native 의존성 없음) |
| 암호화 | Node.js 내장 crypto (AES-256-GCM) |
| 이메일 | nodemailer (Gmail SMTP) |
| 테스트 | vitest |

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
npm test             # vitest 테스트
node dist/cli.js     # 직접 실행
```

### 테스트

```bash
# 암호화 테스트 (26개)
npx vitest run tests/encryption.test.ts

# 전체 테스트
npm test
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
  - Section 01: 세션 갈무리 요약 (최상단)
  - Section 02: 오늘의 수치 (토큰/비용 대시보드)
  - Section 03: 세션별 상세 작업 로그
  - Section 04: 하루의 성과
- **자동 스케줄링**: launchd (macOS) / crontab (Linux) 자동 설치
- **`--auto` 플래그**: 갈무리 + 이메일 자동 발송 (스케줄러용)

### 향후 계획

- [ ] npm publish → `npx sincenety@latest` 배포
- [ ] passphrase 설정 기능 완성
- [ ] 유사 작업 매칭 (TF-IDF 기반)
- [ ] MariaDB/PostgreSQL 외부 DB 연결 (현재 비활성화)
- [ ] 주간/월간 요약 리포트
- [ ] ccusage 연동 (토큰 비용 자동 계산)

---

## 프로젝트 수치 (2026-04-07 기준)

| 지표 | 수치 |
|------|------|
| TypeScript 소스 파일 | 15개 |
| 총 코드 라인 | 3,013줄 |
| 암호화 테스트 | 26/26 통과 |
| CLI 명령어 | 5개 (갈무리, log, config, email, schedule) |
| DB 테이블 | 4개 |
| 의존성 (production) | 3개 (commander, nodemailer, sql.js) |
| 보안 이슈 발견/수정 | 8/8 |

---

## 라이선스

MIT
