/**
 * Calls Grok-3-mini via the xAI API to estimate engagement probabilities
 * for 19 action types, replacing the Phoenix transformer model.
 *
 * Uses structured output (response_format.json_schema) so we get a
 * reliable JSON response matching PhoenixScores.
 */

import type { PhoenixScores, TweetInput, TokenUsage } from "../types.js";
import { XAI_API_URL } from "../config.js";
import type { CalibrationTweet } from "../calibration.js";
import { buildCalibrationPrompt } from "../calibration.js";

const STATIC_CALIBRATION = `Typical probability ranges for reference:
- favoriteScore: 0.01–0.15
- replyScore: 0.001–0.05
- retweetScore: 0.005–0.08
- photoExpandScore: 0.01–0.10 (0 if no image)
- clickScore: 0.02–0.15
- profileClickScore: 0.005–0.05
- vqvScore: 0.01–0.10 (0 if no video)
- shareScore: 0.001–0.03
- shareViaDmScore: 0.001–0.02
- shareViaCopyLinkScore: 0.001–0.02
- dwellScore: 0.05–0.30
- quoteScore: 0.001–0.03
- quotedClickScore: 0.005–0.05 (0 if not a quote tweet)
- followAuthorScore: 0.0005–0.02
- notInterestedScore: 0.0001–0.01
- blockAuthorScore: 0.0001–0.005
- muteAuthorScore: 0.0001–0.005
- reportScore: 0.00005–0.002
- dwellTime: 2.0–30.0 seconds`;

/** Clamp scores for physical constraints based on tweet metadata. */
function clampScores(scores: PhoenixScores, input: TweetInput): PhoenixScores {
  const clamped = { ...scores };

  // Probabilities must be in [0, 1]
  const probKeys: (keyof PhoenixScores)[] = [
    "favoriteScore",
    "replyScore",
    "retweetScore",
    "photoExpandScore",
    "clickScore",
    "profileClickScore",
    "vqvScore",
    "shareScore",
    "shareViaDmScore",
    "shareViaCopyLinkScore",
    "dwellScore",
    "quoteScore",
    "quotedClickScore",
    "followAuthorScore",
    "notInterestedScore",
    "blockAuthorScore",
    "muteAuthorScore",
    "reportScore",
  ];
  for (const key of probKeys) {
    clamped[key] = Math.max(0, Math.min(1, clamped[key]));
  }

  // dwellTime must be non-negative
  clamped.dwellTime = Math.max(0, clamped.dwellTime);

  // No image/gif → photoExpand should be ~0
  const hasImage = input.media === "image" || input.media === "gif";
  if (!hasImage) {
    clamped.photoExpandScore = 0;
  }

  // No video/gif → vqv should be ~0
  const hasVideo = input.media === "video" || input.media === "gif";
  if (!hasVideo) {
    clamped.vqvScore = 0;
  }

  // Not a quote tweet → quotedClick should be ~0
  if (!input.isQuote) {
    clamped.quotedClickScore = 0;
  }

  return clamped;
}

function buildSystemPrompt(calibration: CalibrationTweet[] | null): string {
  const intro = `You are an engagement prediction model for the X (Twitter) recommendation algorithm.

First, identify the TARGET AUDIENCE for this tweet:
- Who would this content resonate with? (e.g., tech Twitter, fitness community, mainstream)
- What's the niche size and how competitive is it?

Then, become that audience. Predict engagement as a typical member of that audience seeing this in their feed.

The algorithm shows tweets to relevant audiences. Evaluate assuming good audience-content fit.`;

  const calibrationSection =
    calibration && calibration.length > 0
      ? buildCalibrationPrompt(calibration)
      : STATIC_CALIBRATION;

  const factors = `Considerations:
- How does this compare to other content you see as a member of that audience?
- Would you engage with this? Would you share it? Would you follow for more?
- Media: images boost photoExpand, videos boost vqv; no media → 0
- Not a quote tweet → quotedClickScore = 0
- dwellTime is seconds, not a probability`;

  return `${intro}\n\n${calibrationSection}\n\n${factors}`;
}

function buildUserPrompt(input: TweetInput, imageDescription?: string): string {
  const parts = [`Tweet text: "${input.text}"`];
  if (input.media && input.media !== "none") {
    parts.push(`Media type: ${input.media}`);
    if (imageDescription) {
      parts.push(`Image content: ${imageDescription}`);
    }
  }
  if (input.isReply) {
    parts.push("Context: This is a reply to another tweet");
    if (input.parentText) parts.push(`Parent tweet: "${input.parentText}"`);
  }
  if (input.isQuote) {
    parts.push("Context: This is a quote tweet");
    if (input.parentText) parts.push(`Quoted tweet: "${input.parentText}"`);
  }
  if (input.followers !== undefined) {
    parts.push(`Author follower count: ${input.followers.toLocaleString()}`);
  }
  return parts.join("\n");
}

const JSON_SCHEMA = {
  name: "phoenix_scores",
  strict: true,
  schema: {
    type: "object",
    properties: {
      favoriteScore: { type: "number" },
      replyScore: { type: "number" },
      retweetScore: { type: "number" },
      photoExpandScore: { type: "number" },
      clickScore: { type: "number" },
      profileClickScore: { type: "number" },
      vqvScore: { type: "number" },
      shareScore: { type: "number" },
      shareViaDmScore: { type: "number" },
      shareViaCopyLinkScore: { type: "number" },
      dwellScore: { type: "number" },
      quoteScore: { type: "number" },
      quotedClickScore: { type: "number" },
      followAuthorScore: { type: "number" },
      notInterestedScore: { type: "number" },
      blockAuthorScore: { type: "number" },
      muteAuthorScore: { type: "number" },
      reportScore: { type: "number" },
      dwellTime: { type: "number" },
    },
    required: [
      "favoriteScore",
      "replyScore",
      "retweetScore",
      "photoExpandScore",
      "clickScore",
      "profileClickScore",
      "vqvScore",
      "shareScore",
      "shareViaDmScore",
      "shareViaCopyLinkScore",
      "dwellScore",
      "quoteScore",
      "quotedClickScore",
      "followAuthorScore",
      "notInterestedScore",
      "blockAuthorScore",
      "muteAuthorScore",
      "reportScore",
      "dwellTime",
    ],
    additionalProperties: false,
  },
};

export interface GrokEngagementResult {
  scores: PhoenixScores;
  usage: TokenUsage;
}

async function callGrokApi(
  systemPrompt: string,
  userContent: string | Array<Record<string, unknown>>,
  model: string,
  apiKey: string
): Promise<{
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; cached_tokens: number };
}> {
  const response = await fetch(XAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: JSON_SCHEMA,
      },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`xAI API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };

  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error("xAI API returned no content");
  }

  return {
    content,
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      cached_tokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

export async function estimateEngagement(
  input: TweetInput,
  apiKey: string,
  model: string,
  calibration?: CalibrationTweet[] | null,
  imageDescription?: string
): Promise<GrokEngagementResult> {
  const systemPrompt = buildSystemPrompt(calibration ?? null);
  const userText = buildUserPrompt(input, imageDescription);

  const result = await callGrokApi(systemPrompt, userText, model, apiKey);

  const rawScores = JSON.parse(result.content) as PhoenixScores;
  const scores = clampScores(rawScores, input);
  const usage: TokenUsage = {
    inputTokens: result.usage.prompt_tokens,
    outputTokens: result.usage.completion_tokens,
    cachedTokens: result.usage.cached_tokens,
    model,
  };

  return { scores, usage };
}
