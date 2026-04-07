/**
 * 세션 요약 생성 — 대화 턴(입력+출력) 기반 분석
 *
 * ANTHROPIC_API_KEY가 있으면 Claude API로 실제 작업 내용을 요약,
 * 없으면 대화 턴에서 헬리스틱으로 작업 결과를 추출.
 */

import type { SessionGroup } from "../grouper/session.js";
import type { StorageAdapter } from "../storage/adapter.js";

export interface SessionSummary {
  /** 세션의 핵심 주제 (짧은 제목) */
  topic: string;
  /** 실제로 이루어진 작업과 결과물 */
  outcome: string;
  /** 작업 흐름 (어떤 순서로 진행했는지) */
  flow: string;
  /** 이 작업의 의미/중요도 */
  significance: string;
}

interface Turn {
  userInput: string;
  assistantOutput: string;
  timestamp: number;
}

/** XML/시스템 태그 제거 */
function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/Caveat:.*?(?=[\n|]|$)/gi, "")
    .replace(/Base directory for this skill:.*?(?=[\n|]|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** 의미 있는 대화 턴만 필터 */
function filterTurns(turns: Turn[]): Turn[] {
  return turns.filter((t) => {
    const input = clean(t.userInput);
    if (input.length <= 3) return false;
    const lower = input.toLowerCase();
    if (["ok", "yes", "네", "응", "ㅇㅇ", "좋아", "됐어", "확인", "ㅇ"].includes(lower)) return false;
    return true;
  });
}

// ─── Claude API 요약 ──────────────────────────────────

/** API 키 캐시 (세션 내 반복 호출 방지) */
let cachedApiKey: string | null | undefined;

async function getApiKey(storage?: StorageAdapter): Promise<string | null> {
  if (cachedApiKey !== undefined) return cachedApiKey;

  // 1. 환경변수
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) { cachedApiKey = envKey; return envKey; }

  // 2. sincenety config DB
  if (storage) {
    const dbKey = await storage.getConfig("anthropic_api_key");
    if (dbKey) { cachedApiKey = dbKey; return dbKey; }
  }

  cachedApiKey = null;
  return null;
}

async function summarizeWithClaude(
  session: SessionGroup,
  turns: Turn[],
  storage?: StorageAdapter,
): Promise<SessionSummary | null> {
  const apiKey = await getApiKey(storage);
  if (!apiKey) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    // 대화 턴을 컨텍스트로 전달 (최대 30턴, 각 300자 제한)
    const turnTexts = turns.slice(0, 30).map((t, i) => {
      const input = trunc(clean(t.userInput), 200);
      const output = trunc(clean(t.assistantOutput), 300);
      return `[${i + 1}] 사용자: ${input}\n    결과: ${output}`;
    }).join("\n\n");

    const prompt = `아래는 Claude Code 작업 세션의 대화 기록입니다. 사용자 입력과 어시스턴트의 실제 작업 결과가 포함되어 있습니다.

프로젝트: ${session.projectName}
시간: ${new Date(session.startedAt).toLocaleTimeString("ko-KR")} ~ ${new Date(session.endedAt).toLocaleTimeString("ko-KR")}
총 메시지: ${session.messageCount}개

대화 기록:
${turnTexts}

위 세션을 분석하여 **실제로 이루어진 작업 기준으로** 요약해주세요.
사용자가 입력한 것이 아니라, 결과적으로 무엇이 만들어지고 변경되었는지에 초점을 맞춰주세요.

JSON 형식으로 응답:
{
  "topic": "핵심 주제 20자 이내 (예: 'Cloudflare Analytics 설정')",
  "outcome": "실제로 완료된 작업과 결과물 (2-3문장, 구체적으로)",
  "flow": "작업 흐름을 단계별로 (예: '프로젝트 분석 → 코드 수정 → 테스트 → 배포')",
  "significance": "이 세션의 핵심 성과 (1문장)"
}
JSON만 출력하세요.`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text as string)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      topic: parsed.topic ?? "",
      outcome: parsed.outcome ?? "",
      flow: parsed.flow ?? "",
      significance: parsed.significance ?? "",
    };
  } catch {
    return null;
  }
}

// ─── 헬리스틱 요약 (API 없을 때) ─────────────────────

function summarizeHeuristic(
  session: SessionGroup,
  turns: Turn[],
): SessionSummary {
  if (turns.length === 0) {
    return {
      topic: session.projectName,
      outcome: clean(session.title ?? session.summary),
      flow: "",
      significance: "",
    };
  }

  // 의미 있는 대화 턴에서 작업 내용 추출
  const workItems: string[] = [];
  for (const turn of turns) {
    const input = clean(turn.userInput);
    const output = clean(turn.assistantOutput);

    if (input.length <= 10 && output.length <= 10) continue;

    // 어시스턴트 응답에서 작업 결과 키워드 추출
    if (output) {
      // "완료", "생성", "설정", "수정" 등 결과 표현 추출
      const resultPatterns = [
        /(?:완료|생성|설정|수정|추가|삭제|배포|설치|업데이트|구현|적용|변경|해결|발송)[^.]*\./g,
        /(?:created|updated|installed|configured|fixed|deployed|added|removed)[^.]*\./gi,
      ];
      for (const pattern of resultPatterns) {
        const matches = output.match(pattern);
        if (matches) {
          workItems.push(...matches.map((m) => trunc(m.trim(), 80)));
        }
      }
    }

    // 결과 키워드가 없으면 입력에서 작업 의도 추출
    if (workItems.length === 0 && input.length > 15) {
      workItems.push(trunc(input, 60));
    }
  }

  // topic: 첫 의미있는 입력에서 핵심
  const firstInput = clean(turns[0].userInput);
  const topic = trunc(firstInput, 50);

  // outcome: 추출된 작업 결과물 또는 주요 대화 턴 요약
  let outcome: string;
  if (workItems.length > 0) {
    const unique = [...new Set(workItems)].slice(0, 5);
    outcome = unique.join(". ");
  } else {
    // 작업 결과를 못 찾으면 주요 턴의 입력→출력 요약
    const keyTurns = turns.filter((t) => clean(t.userInput).length > 15).slice(0, 4);
    outcome = keyTurns.map((t) => {
      const input = trunc(clean(t.userInput), 40);
      const output = trunc(clean(t.assistantOutput), 60);
      return output ? `${input} → ${output}` : input;
    }).join(" | ");
  }

  // flow: 주요 전환점만 추출하여 흐름 구성
  const keyTurns = turns.filter((t) => clean(t.userInput).length > 15);
  const flowSteps = keyTurns.slice(0, 6).map((t) => {
    const input = trunc(clean(t.userInput), 30);
    const output = clean(t.assistantOutput);
    // 출력에서 핵심 동사/결과 추출
    const actionMatch = output.match(/(?:했습니다|완료|생성|설정|확인|분석|수정|추가|실행)[^.]{0,20}/);
    return actionMatch ? `${input} → ${actionMatch[0].trim()}` : input;
  });
  const flow = flowSteps.join(" → ");

  // significance: 세션 전체의 핵심 성과
  const lastTurn = turns[turns.length - 1];
  const lastOutput = clean(lastTurn?.assistantOutput ?? "");
  const significance = lastOutput
    ? trunc(lastOutput, 150)
    : trunc(firstInput, 150);

  return {
    topic: topic || session.projectName,
    outcome: trunc(outcome || clean(session.description ?? session.summary), 300),
    flow: trunc(flow, 300),
    significance: trunc(significance, 200),
  };
}

// ─── Public API ───────────────────────────────────────

export async function summarizeSession(
  session: SessionGroup,
  storage?: StorageAdapter,
): Promise<SessionSummary> {
  const turns = filterTurns(session.conversationTurns ?? []);

  // Claude API 시도
  const aiSummary = await summarizeWithClaude(session, turns, storage);
  if (aiSummary) return aiSummary;

  // fallback: 대화 턴 기반 헬리스틱
  return summarizeHeuristic(session, turns);
}

export async function summarizeSessions(
  sessions: SessionGroup[],
  storage?: StorageAdapter,
): Promise<Map<string, SessionSummary>> {
  const map = new Map<string, SessionSummary>();

  // API 키 확인
  const apiKey = await getApiKey(storage);
  if (apiKey) {
    // API 사용 시 병렬 처리 (세션별 독립)
    const results = await Promise.all(
      sessions.map((s) => summarizeSession(s, storage)),
    );
    sessions.forEach((s, i) => map.set(s.sessionId, results[i]));
  } else {
    // 헬리스틱은 순차 (빠르므로 병렬 불필요)
    for (const s of sessions) {
      map.set(s.sessionId, await summarizeSession(s));
    }
  }

  return map;
}
