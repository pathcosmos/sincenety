---
name: sincenety
description: Use when the user wants to log, review, or summarize their Claude Code work sessions — triggered by /sincenety, requests to track work history, or "what did I work on today"
---

# sincenety — 작업 갈무리

실행 한 번으로 마지막 갈무리 이후의 모든 Claude Code 작업을 자동 분석하여 구조화된 기록을 생성합니다.

## Usage

사용자가 `/sincenety`를 입력하거나 작업 기록을 요청하면:

1. `sincenety` CLI를 실행하여 갈무리를 수행합니다
2. 결과를 사용자에게 보여줍니다

```bash
# 기본 갈무리 (마지막 포인트 이후)
npx sincenety

# 특정 시점부터
npx sincenety --since "09:00"

# 로그 조회
npx sincenety log
npx sincenety log --week
```

## How It Works

- `~/.claude/history.jsonl`을 스트리밍 파싱
- `sessionId` + `project` 기준으로 그룹핑
- 암호화된 로컬 DB (`~/.sincenety/sincenety.db`)에 저장
- 갈무리 포인트로 중복 방지
