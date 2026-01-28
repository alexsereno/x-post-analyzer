/**
 * Calls Gemini 3 Pro via the Google AI API to provide reasoning,
 * strengths/weaknesses, and suggestions based on the scored result.
 */

import type { ScoredResult, GeminiAnalysis, TweetInput } from "../types.js";
import { GEMINI_API_URL } from "../config.js";

function buildPrompt(input: TweetInput, result: ScoredResult): string {
  const topContributors = [...result.weightBreakdown]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 8);

  const breakdownText = topContributors
    .map(
      (e) =>
        `  ${e.action}: P=${e.probability.toFixed(4)} × W=${e.weight} = ${e.contribution.toFixed(4)}`
    )
    .join("\n");

  return `You are analysing a tweet's virality potential using the X recommendation algorithm's scoring pipeline.

Tweet text: "${input.text}"
${input.isReply && input.parentText ? `Replying to: "${input.parentText}"` : ""}
${input.isQuote && input.parentText ? `Quoting: "${input.parentText}"` : ""}
${input.media && input.media !== "none" ? `Media: ${input.media}` : ""}
${input.followers !== undefined ? `Follower count: ${input.followers.toLocaleString()}` : ""}

## Engagement Probabilities (from Grok-3-mini)
${Object.entries(result.phoenixScores)
  .map(([k, v]) => `  ${k}: ${(v as number).toFixed(4)}`)
  .join("\n")}

## Weighted Score Breakdown (top contributors)
${breakdownText}

## Scores
Raw weighted score: ${result.rawWeightedScore.toFixed(4)}
After offset: ${result.offsetScore.toFixed(4)}
After author diversity (×${result.diversityMultiplier.toFixed(2)}): ${result.diversityAdjustedScore.toFixed(4)}
After OON adjustment (×${result.oonMultiplier.toFixed(2)}): ${result.finalScore.toFixed(4)}

Provide your analysis as JSON with these fields:
- assessment: 2-3 sentence overall assessment
- viralityRating: integer 1-10
- strengths: array of 2-4 strengths, each referencing which P(action) it relates to
- weaknesses: array of 2-4 weaknesses, each referencing which P(action) it relates to
- suggestions: array of 2-4 actionable suggestions, each noting which P(action) it would improve
- revisedTweet: a revised version of the tweet incorporating your suggestions`;
}

export async function analyzeWithGemini(
  input: TweetInput,
  result: ScoredResult,
  apiKey: string,
  model: string
): Promise<GeminiAnalysis> {
  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(input, result) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            assessment: { type: "STRING" },
            viralityRating: { type: "INTEGER" },
            strengths: { type: "ARRAY", items: { type: "STRING" } },
            weaknesses: { type: "ARRAY", items: { type: "STRING" } },
            suggestions: { type: "ARRAY", items: { type: "STRING" } },
            revisedTweet: { type: "STRING" },
          },
          required: [
            "assessment",
            "viralityRating",
            "strengths",
            "weaknesses",
            "suggestions",
            "revisedTweet",
          ],
        },
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };

  const text = data.candidates[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API returned no content");
  }

  return JSON.parse(text) as GeminiAnalysis;
}
