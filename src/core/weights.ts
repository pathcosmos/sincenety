/**
 * #12 프로젝트별 중요도 가중치.
 *
 * config의 `project_weights` 키에 JSON 객체로 저장: { "<path>": "high"|"normal"|"low" }.
 * 이메일 렌더러가 이를 읽어 low 프로젝트 세션을 1줄로 축약한다.
 */

import type { StorageAdapter } from "../storage/adapter.js";

export type WeightLevel = "high" | "normal" | "low";
export const WEIGHT_LEVELS: readonly WeightLevel[] = ["high", "normal", "low"] as const;
export const PROJECT_WEIGHTS_CONFIG_KEY = "project_weights";

export function isWeightLevel(v: unknown): v is WeightLevel {
  return typeof v === "string" && (WEIGHT_LEVELS as readonly string[]).includes(v);
}

export async function getProjectWeights(
  storage: StorageAdapter,
): Promise<Record<string, WeightLevel>> {
  const raw = await storage.getConfig(PROJECT_WEIGHTS_CONFIG_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, WeightLevel> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (isWeightLevel(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function setProjectWeight(
  storage: StorageAdapter,
  path: string,
  level: WeightLevel | "clear",
): Promise<void> {
  const current = await getProjectWeights(storage);
  if (level === "clear") {
    delete current[path];
  } else {
    current[path] = level;
  }
  await storage.setConfig(PROJECT_WEIGHTS_CONFIG_KEY, JSON.stringify(current));
}

/**
 * 프로젝트명(또는 경로)에 대한 가중치 조회.
 * 정확 일치 우선 → basename 일치 → "normal" 기본값.
 */
export function resolveWeight(
  weights: Record<string, WeightLevel>,
  projectKey: string,
): WeightLevel {
  if (!projectKey) return "normal";
  if (weights[projectKey]) return weights[projectKey];
  // basename/경로 말단 매칭 허용
  const base = projectKey.split("/").filter(Boolean).pop() ?? "";
  if (base && weights[base]) return weights[base];
  return "normal";
}
