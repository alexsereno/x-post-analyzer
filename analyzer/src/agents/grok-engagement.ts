/**
 * Calls Grok-3-mini via the xAI API to estimate engagement probabilities
 * for 19 action types, replacing the Phoenix transformer model.
 *
 * Uses structured output (response_format.json_schema) so we get a
 * reliable JSON response matching PhoenixScores.
 */

import type { PhoenixScores, TweetInput } from "../types.js";
import { XAI_API_URL } from "../config.js";

const SYSTEM_PROMPT = `You are an engagement prediction model for the X (Twitter) recommendation algorithm.
Given a tweet, estimate the probability that an average viewer will take each of the 19 engagement actions.

Calibration guidance — typical ranges for an average tweet:
- favoriteScore: 0.01–0.15 (likes are the most common action)
- replyScore: 0.001–0.05 (replies are less common)
- retweetScore: 0.005–0.08 (retweets are moderately common)
- photoExpandScore: 0.01–0.10 (only if image present, else ~0)
- clickScore: 0.02–0.15 (clicking to expand/read)
- profileClickScore: 0.005–0.05 (clicking the author's profile)
- vqvScore: 0.01–0.10 (video quality view, only if video present, else ~0)
- shareScore: 0.001–0.03 (sharing via share button)
- shareViaDmScore: 0.001–0.02 (sharing via DM)
- shareViaCopyLinkScore: 0.001–0.02 (copying the link)
- dwellScore: 0.05–0.30 (pausing to read)
- quoteScore: 0.001–0.03 (quote tweeting)
- quotedClickScore: 0.005–0.05 (clicking a quoted tweet)
- followAuthorScore: 0.0005–0.02 (following the author)
- notInterestedScore: 0.001–0.05 (marking not interested)
- blockAuthorScore: 0.0001–0.005 (blocking author)
- muteAuthorScore: 0.0001–0.005 (muting author)
- reportScore: 0.00005–0.002 (reporting the tweet)
- dwellTime: 2.0–30.0 (expected dwell time in seconds, NOT a probability)

Factors to consider:
- Text length, clarity, and emotional valence
- Media type (images boost photoExpand, videos boost vqv)
- Call-to-action presence (questions boost reply, "RT if" boosts retweet)
- Controversy potential (increases both engagement AND negative signals)
- Follower context (larger audiences have lower per-viewer engagement rates)
- Whether the tweet is a reply or quote (affects visibility and engagement patterns)

Keep estimates realistic. Most probabilities should be well under 0.10.
dwellTime is in seconds (not a probability).`;

function buildUserPrompt(input: TweetInput): string {
  const parts = [`Tweet text: "${input.text}"`];
  if (input.media && input.media !== "none") {
    parts.push(`Media: ${input.media}`);
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

export async function estimateEngagement(
  input: TweetInput,
  apiKey: string,
  model: string
): Promise<PhoenixScores> {
  const response = await fetch(XAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
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
  };

  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error("xAI API returned no content");
  }

  return JSON.parse(content) as PhoenixScores;
}
