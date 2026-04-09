/**
 * Cloudflare Workers AI — Qwen3-30B 한국어 요약
 */

const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

export interface SessionSummary {
  topic: string;
  outcome: string;
  flow: string;
  significance: string;
  nextSteps?: string;
}

export interface CfAiConfig {
  accountId: string;
  apiToken: string;
  model?: string;  // override default model
}

/**
 * Summarize a work session using Cloudflare Workers AI
 */
export async function summarizeSession(
  config: CfAiConfig,
  projectName: string,
  conversationTurns: Array<{ userInput: string; assistantOutput: string }>,
): Promise<SessionSummary | null> {
  const model = config.model ?? MODEL;

  // Build turn text (limit to avoid token overflow)
  const turnTexts = conversationTurns.slice(0, 30).map((t, i) => {
    const input = cleanText(t.userInput).slice(0, 200);
    const output = cleanText(t.assistantOutput).slice(0, 300);
    return `[${i + 1}] 사용자: ${input}\n    결과: ${output}`;
  }).join("\n\n");

  const systemPrompt = `당신은 Claude Code 작업 세션을 분석하여 한국어로 구조화된 요약을 생성하는 전문가입니다.
반드시 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.`;

  const userPrompt = `프로젝트: ${projectName}
대화 턴 수: ${conversationTurns.length}개

${turnTexts}

위 세션을 분석하여 아래 JSON 형식으로 요약하세요:
{
  "topic": "핵심 주제 (20자 이내)",
  "outcome": "실제로 이루어진 작업과 결과물 (2-3문장, 구체적)",
  "flow": "작업 흐름 단계별 요약 (예: A → B → C)",
  "significance": "핵심 성과 (1문장)",
  "nextSteps": "다음에 이어서 할 작업 (있으면, 1문장, 없으면 빈 문자열)"
}`;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2048,
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      console.warn(`  ⚠️ Workers AI response error (${res.status}): ${text.slice(0, 100)}`);
      return null;
    }

    const json = await res.json() as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;

    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    return {
      topic: parsed.topic ?? "",
      outcome: parsed.outcome ?? "",
      flow: parsed.flow ?? "",
      significance: parsed.significance ?? "",
      nextSteps: parsed.nextSteps || undefined,
    };
  } catch (err) {
    console.warn(`  ⚠️ Workers AI summary failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Generate daily overview from multiple session summaries
 */
export async function generateOverview(
  config: CfAiConfig,
  date: string,
  sessionSummaries: SessionSummary[],
): Promise<string | null> {
  const model = config.model ?? MODEL;

  const summaryText = sessionSummaries.map((s, i) =>
    `${i + 1}. [${s.topic}] ${s.outcome} (${s.significance})`
  ).join("\n");

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "당신은 하루의 작업을 종합하는 한국어 보고서 작성자입니다. 2-3문장으로 간결하게 종합하세요." },
            { role: "user", content: `${date} 작업 요약:\n${summaryText}\n\n위 내용을 2-3문장으로 종합하세요. 텍스트만 출력하세요.` },
          ],
          temperature: 0.3,
          max_tokens: 1024,
        }),
      },
    );

    if (!res.ok) return null;
    const json = await res.json() as any;
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/Caveat:.*?(?=\n|$)/gi, "")
    .replace(/Base directory for this skill:.*?(?=\n|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
