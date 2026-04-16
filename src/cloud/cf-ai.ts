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

  // 대화 턴을 "사용자 의도(맥락)" + "어시스턴트 작업/산출물(요약 대상)" 두 축으로 분리해 제공.
  // 사용자 발화는 의도 파악용 컨텍스트일 뿐, 출력 텍스트에 등장시키지 말 것을 프롬프트에서 명시.
  const turnTexts = conversationTurns.slice(0, 30).map((t, i) => {
    const intent = cleanText(t.userInput).slice(0, 200);
    const work = cleanText(t.assistantOutput).slice(0, 400);
    return `[턴 ${i + 1}]\n  사용자 의도(맥락): ${intent}\n  어시스턴트 수행/산출물: ${work}`;
  }).join("\n\n");

  const systemPrompt = `당신은 Claude Code 작업 세션을 분석하여 한국어 작업 보고서를 생성하는 전문가입니다.

[엄격한 출력 규칙]
1. **사용자 발화/프롬프트를 절대 그대로 인용·복사·요약 출력에 등장시키지 마세요.** 사용자 입력은 어시스턴트가 무엇을 했는지 이해하기 위한 맥락일 뿐입니다.
2. 요약은 **"무엇이 이루어졌는가"를 3인칭 관찰자 시점**으로 기술합니다. "사용자가 ~를 요청했다", "~을 물었다" 같은 표현 금지.
3. 사용자 의도와 어시스턴트의 실제 작업/산출물(코드 변경, 파일 생성, 명령 실행, 분석 결과, 의사결정)을 **상호 맥락으로 통합**하여 작업의 의미를 드러내세요.
4. 어시스턴트의 인사·확인·중간 진행 보고는 무시하고, **실제로 변경/생성/결정된 산출물**을 중심으로 정리하세요.
5. 응답은 반드시 JSON 한 객체로만, 다른 텍스트 없이 출력하세요.`;

  const userPrompt = `프로젝트: ${projectName}
대화 턴 수: ${conversationTurns.length}개

${turnTexts}

위 세션의 사용자 의도와 어시스턴트 수행 결과를 상호 맥락으로 통합하여, 작업 산출물 중심으로 한국어 요약을 생성하세요.

JSON 스키마:
{
  "topic": "이 세션에서 실제 이루어진 작업의 핵심 (20자 이내, 명사구). 사용자 발화 인용 금지.",
  "outcome": "실제로 만들어지거나 변경된 산출물·결정·해결 결과 (2-3문장, 구체적, 3인칭). 사용자가 '무엇을 물었는가'가 아니라 '무엇이 완성됐는가'를 적으세요.",
  "flow": "작업 흐름의 단계 요약 (예: '원인 분석 → 코드 수정 → 테스트 → 배포'). 각 단계는 동작 명사구. 사용자 발화 인용 금지.",
  "significance": "이 세션이 프로젝트에 기여한 핵심 가치 (1문장).",
  "nextSteps": "다음에 이어질 작업이 명확히 있으면 1문장, 없으면 빈 문자열."
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
      // 호출자(circle.autoSummarize)가 throw를 잡아 파이프라인을 중단시키도록 에러 전파.
      // 휴리스틱 fallback 없으므로 silent null 반환은 금지.
      throw new Error(`Workers AI HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json() as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Workers AI 응답에 content 필드가 없음");
    }

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
    if (err instanceof Error && err.message.startsWith("Workers AI ")) throw err;
    throw new Error(`Workers AI 요약 실패: ${err instanceof Error ? err.message : String(err)}`);
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
