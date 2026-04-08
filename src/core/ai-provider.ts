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
