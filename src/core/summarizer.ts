/**
 * 세션 요약 생성 — AI(Cloudflare Workers AI / Anthropic) 전용.
 *
 * v0.8.6부터 휴리스틱 fallback 완전 제거. AI가 동작하지 않으면 반드시 throw.
 * 호출측은 AiUnavailableError를 잡아 sincenety 파이프라인을 중단해야 함.
 *
 * 설계 원칙: "요약이 안 된 건 차라리 내보내지 않는다." 입력 텍스트를 정규식으로
 * 이어붙여 AI 요약인 척 내보내는 것은 silent failure로 간주되어 금지.
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
  /** 다음에 이어서 할 작업 */
  nextSteps?: string;
}

interface Turn {
  userInput: string;
  assistantOutput: string;
  timestamp: number;
}

/**
 * AI 요약이 불가능한 상태에서 호출됐을 때 throw되는 에러.
 * 파이프라인 진입점(autoSummarize 등)에서 잡아 즉시 중단해야 함.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** XML/시스템 태그/파일 경로 제거 — AI 프롬프트 품질 향상용 */
function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/Caveat:.*?(?=[\n|]|$)/gi, "")
    .replace(/Base directory for this skill:.*?(?=[\n|]|$)/gi, "")
    .replace(/(?:\/(?:Users|Volumes|home|tmp|var|opt|etc|usr)\/)\S+/g, "")
    .replace(/(?:\.\.?\/)\S+/g, "")
    .replace(/\b[\w.-]+\.(?:ts|js|tsx|jsx|json|jsonl|md|yaml|yml|toml|css|html|sql|sh|py|go|rs)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** 의미 있는 대화 턴만 필터 (AI 프롬프트 길이 절약) */
function filterTurns(turns: Turn[]): Turn[] {
  return turns.filter((t) => {
    const input = clean(t.userInput);
    if (input.length <= 3) return false;
    const lower = input.toLowerCase();
    if (["ok", "yes", "네", "응", "ㅇㅇ", "좋아", "됐어", "확인", "ㅇ"].includes(lower)) return false;
    return true;
  });
}

// ─── Anthropic API 경로 ──────────────────────────────────

let cachedApiKey: string | null | undefined;

async function getApiKey(storage?: StorageAdapter): Promise<string | null> {
  if (cachedApiKey !== undefined) return cachedApiKey;

  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) { cachedApiKey = envKey; return envKey; }

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
): Promise<SessionSummary> {
  const apiKey = await getApiKey(storage);
  if (!apiKey) {
    throw new AiUnavailableError(
      "Anthropic API 키를 찾을 수 없습니다 (ANTHROPIC_API_KEY 환경변수 또는 config.anthropic_api_key).",
    );
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const turnTexts = turns.slice(0, 30).map((t, i) => {
    const intent = trunc(clean(t.userInput), 200);
    const work = trunc(clean(t.assistantOutput), 400);
    return `[턴 ${i + 1}]\n  사용자 의도(맥락): ${intent}\n  어시스턴트 수행/산출물: ${work}`;
  }).join("\n\n");

  const prompt = `당신은 Claude Code 작업 세션을 분석하여 한국어 작업 보고서를 생성하는 전문가입니다.

[엄격한 출력 규칙]
1. **사용자 발화/프롬프트를 절대 그대로 인용·복사·요약 출력에 등장시키지 마세요.** 사용자 입력은 어시스턴트가 무엇을 했는지 이해하기 위한 맥락일 뿐입니다.
2. 요약은 **"무엇이 이루어졌는가"를 3인칭 관찰자 시점**으로 기술합니다. "사용자가 ~를 요청했다", "~을 물었다" 같은 표현 금지.
3. 사용자 의도와 어시스턴트의 실제 작업/산출물(코드 변경, 파일 생성, 명령 실행, 분석 결과, 의사결정)을 **상호 맥락으로 통합**하여 작업의 의미를 드러내세요.
4. 어시스턴트의 인사·확인·중간 진행 보고는 무시하고, **실제로 변경/생성/결정된 산출물**을 중심으로 정리하세요.

프로젝트: ${session.projectName}
시간: ${new Date(session.startedAt).toLocaleTimeString("ko-KR")} ~ ${new Date(session.endedAt).toLocaleTimeString("ko-KR")}
총 메시지: ${session.messageCount}개

대화 기록:
${turnTexts}

위 세션을 분석하여 작업 산출물 중심으로 JSON으로만 응답하세요:
{
  "topic": "이 세션에서 실제 이루어진 작업의 핵심 (20자 이내, 명사구)",
  "outcome": "실제로 만들어지거나 변경된 산출물·결정·해결 결과 (2-3문장, 구체적, 3인칭)",
  "flow": "작업 흐름의 단계 요약 (예: '원인 분석 → 코드 수정 → 테스트 → 배포')",
  "significance": "이 세션이 프로젝트에 기여한 핵심 가치 (1문장)"
}
JSON만 출력하세요.`;

  // Anthropic SDK 에러(network, rate limit, auth)를 silent catch하지 않음.
  // 호출자가 AI 실패로 판단하고 파이프라인 중단하도록 그대로 전파.
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
  if (!jsonMatch) {
    throw new Error(`Anthropic 응답에서 JSON을 찾을 수 없음: ${trunc(text, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    topic: parsed.topic ?? "",
    outcome: parsed.outcome ?? "",
    flow: parsed.flow ?? "",
    significance: parsed.significance ?? "",
  };
}

// ─── Workers AI 경로 ─────────────────────────────────────

async function summarizeWithWorkersAI(
  session: SessionGroup,
  turns: Turn[],
  storage: StorageAdapter,
): Promise<SessionSummary> {
  const { loadAiProviderConfig } = await import("./ai-provider.js");
  const config = await loadAiProviderConfig(storage);
  if (!config.accountId || !config.apiToken) {
    throw new AiUnavailableError(
      "Cloudflare Workers AI 설정 누락 (d1_account_id / d1_api_token 필요).",
    );
  }

  const { summarizeSession: cfSummarize } = await import("../cloud/cf-ai.js");
  const cfConfig = { accountId: config.accountId, apiToken: config.apiToken };

  const cfTurns = turns.map((t) => ({
    userInput: t.userInput,
    assistantOutput: t.assistantOutput,
  }));

  const result = await cfSummarize(cfConfig, session.projectName, cfTurns);
  if (!result) {
    // cf-ai.ts가 null을 반환하는 경우(응답 파싱 실패, API 에러 등)는 AI 실패로 간주.
    throw new Error(`Workers AI 요약 실패 (session=${session.sessionId}, project=${session.projectName}).`);
  }
  return result;
}

// ─── Public API ─────────────────────────────────────────

/**
 * 단일 세션 요약. AI provider가 없거나 호출 실패 시 throw.
 * 휴리스틱 fallback 없음 — 호출자는 반드시 에러를 처리해야 함.
 */
export async function summarizeSession(
  session: SessionGroup,
  storage?: StorageAdapter,
): Promise<SessionSummary> {
  if (!storage) {
    throw new AiUnavailableError("storage 어댑터가 필요합니다 (AI provider 설정을 읽어야 함).");
  }

  const turns = filterTurns(session.conversationTurns ?? []);

  const { resolveAiProvider } = await import("./ai-provider.js");
  const provider = await resolveAiProvider(storage);

  if (provider === "cloudflare") {
    return summarizeWithWorkersAI(session, turns, storage);
  }
  if (provider === "anthropic") {
    return summarizeWithClaude(session, turns, storage);
  }

  // claude-code: 이 경로는 /sincenety 슬래시 명령(circle --json/--save)로만 유효.
  // CLI/cron에서 summarizeSession이 직접 호출됐다면 요약 주체가 없음 → 중단.
  if (provider === "claude-code") {
    throw new AiUnavailableError(
      "ai_provider=claude-code는 /sincenety 슬래시 명령에서만 동작합니다. " +
        "CLI/cron 실행 시에는 ai_provider를 'cloudflare' 또는 'anthropic'으로 설정하세요.",
    );
  }

  // heuristic / 미설정
  throw new AiUnavailableError(
    "AI provider가 설정되지 않았습니다. " +
      "`sincenety config --ai-provider cloudflare` 또는 `sincenety config --ai-provider anthropic`을 실행하세요.",
  );
}

/**
 * 여러 세션 일괄 요약. 하나라도 실패하면 throw (Promise.all 전파).
 */
export async function summarizeSessions(
  sessions: SessionGroup[],
  storage?: StorageAdapter,
): Promise<Map<string, SessionSummary>> {
  const map = new Map<string, SessionSummary>();
  const results = await Promise.all(
    sessions.map((s) => summarizeSession(s, storage)),
  );
  sessions.forEach((s, i) => map.set(s.sessionId, results[i]));
  return map;
}
