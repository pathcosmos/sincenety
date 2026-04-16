/**
 * AI Provider 추상화 — Cloudflare Workers AI / Anthropic / Claude Code 자동 감지 및 라우팅
 *
 * 우선순위:
 * 1. 명시적 ai_provider 설정 ("cloudflare" | "anthropic" | "claude-code")
 * 2. 자동 감지: d1 토큰 → "cloudflare", ANTHROPIC_API_KEY → "anthropic"
 * 3. 없으면 "heuristic"
 */

import type { StorageAdapter } from "../storage/adapter.js";

export type AiProvider = "cloudflare" | "anthropic" | "claude-code" | "heuristic";

export interface AiProviderConfig {
  provider: string | null;
  accountId: string | null;
  apiToken: string | null;
  anthropicKey: string | null;
}

/**
 * 설정으로부터 AI provider 감지 (순수 함수)
 */
export function detectAiProvider(config: AiProviderConfig): AiProvider {
  const explicit = config.provider?.toLowerCase();

  if (explicit) {
    if (explicit === "cloudflare" && config.accountId && config.apiToken) return "cloudflare";
    if (explicit === "anthropic" && config.anthropicKey) return "anthropic";
    if (explicit === "claude-code") return "claude-code";
    // 명시 설정이 있지만 자격 증명이 없으면 auto-detect로 fallthrough
  }

  // 자동 감지
  if (config.accountId && config.apiToken) return "cloudflare";
  if (config.anthropicKey) return "anthropic";

  return "heuristic";
}

/**
 * DB + 환경변수에서 AI provider 관련 설정을 일괄 로드
 */
export async function loadAiProviderConfig(
  storage: StorageAdapter,
): Promise<AiProviderConfig> {
  const [provider, accountId, apiToken, dbAnthropicKey] = await Promise.all([
    storage.getConfig("ai_provider"),
    storage.getConfig("d1_account_id"),
    storage.getConfig("d1_api_token"),
    storage.getConfig("anthropic_api_key"),
  ]);

  const anthropicKey = process.env.ANTHROPIC_API_KEY || dbAnthropicKey;

  return { provider, accountId, apiToken, anthropicKey };
}

/**
 * Storage에서 설정을 읽어 AI provider를 결정
 */
export async function resolveAiProvider(
  storage: StorageAdapter,
): Promise<AiProvider> {
  const config = await loadAiProviderConfig(storage);
  return detectAiProvider(config);
}

/**
 * CLI/cron 경로에서 AI 요약이 반드시 필요한 파이프라인 진입 시 호출되는 가드.
 * 이 가드를 통과하지 못하면 sincenety 전체 실행을 중단해야 함.
 *
 * - `cloudflare` / `anthropic` (자격 증명 존재) → 통과
 * - `claude-code` → 중단 (이 provider는 /sincenety 슬래시 명령에서만 유효)
 * - 설정 없음(heuristic) → 중단
 *
 * @throws Error with clear remediation message
 */
export async function assertAiReadyForCliPipeline(
  storage: StorageAdapter,
): Promise<void> {
  const config = await loadAiProviderConfig(storage);
  const provider = detectAiProvider(config);

  if (provider === "cloudflare" || provider === "anthropic") return;

  const hint =
    "설정 방법:\n" +
    "  - Cloudflare: `sincenety config` 재실행 후 D1 토큰 입력\n" +
    "  - Anthropic:  `sincenety config --ai-provider anthropic` + ANTHROPIC_API_KEY 환경변수";

  if (provider === "claude-code") {
    throw new Error(
      "ai_provider=claude-code는 /sincenety 슬래시 명령에서만 AI 요약이 가능합니다. " +
        "CLI 또는 cron에서 직접 `sincenety`를 실행하려면 Cloudflare 또는 Anthropic을 설정하세요.\n\n" +
        hint,
    );
  }

  throw new Error(
    "AI provider가 구성되지 않아 요약을 생성할 수 없습니다. " +
      "sincenety는 요약 품질 보장을 위해 AI 없이 파이프라인을 실행하지 않습니다.\n\n" +
      hint,
  );
}
