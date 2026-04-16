#!/bin/bash
# PreToolUse hook: sincenety out* 명령 실행 전 선행 요약 검증
# stdin으로 {"tool_name":"Bash","tool_input":{"command":"..."}} JSON이 들어옴

input="$(cat)"

# tool_name이 Bash가 아니면 통과
echo "$input" | grep -q '"tool_name"[[:space:]]*:[[:space:]]*"Bash"' || exit 0

# command에 sincenety out 패턴이 없으면 통과
echo "$input" | grep -q 'sincenety out' || exit 0

# sincenety out --verify 실행하여 선행 요약 상태 확인
verify_output="$(sincenety out --verify 2>/dev/null)" || {
  echo "⚠️  sincenety verify unavailable — proceeding without check" >&2
  exit 0
}

if echo "$verify_output" | grep -qE 'MISSING|STALE'; then
  echo "Run /sincenety first" >&2
  exit 2
fi

exit 0
