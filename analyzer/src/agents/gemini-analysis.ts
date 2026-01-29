/**
 * Calls Gemini 3 Pro via the Google AI API to provide reasoning,
 * strengths/weaknesses, and suggestions based on the scored result.
 */

import type {
  ScoredResult,
  GeminiAnalysis,
  TweetInput,
  TokenUsage,
  PriorRunContext,
} from "../types.js";
import { GEMINI_API_URL } from "../config.js";

function buildHistorySection(priorRuns?: PriorRunContext[]): string {
  if (!priorRuns || priorRuns.length === 0) {
    return "";
  }

  const entries = priorRuns.map((run, i) => {
    const typeLabel = run.tweetType !== "tweet" ? ` (${run.tweetType})` : "";
    const mediaLabel = run.mediaType ? ` [${run.mediaType}]` : "";

    // Format weight breakdown - show top 5 contributors
    const topBreakdown = [...run.weightBreakdown]
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 5)
      .map(
        (w) =>
          `${w.action}: P=${w.probability.toFixed(4)} × W=${w.weight} = ${w.contribution.toFixed(4)}`
      )
      .join("\n      ");

    return `### Run ${i + 1}${typeLabel}${mediaLabel}
Tweet: "${run.text}"
Score: ${run.finalScore.toFixed(4)} | Virality: ${run.viralityRating}/10
Assessment: ${run.assessment}
Top contributors:
      ${topBreakdown}`;
  });

  return `

## Prior Runs (${priorRuns.length} recent analyses)

Use this history to inform your analysis:
- Identify patterns in what scores well vs poorly for THIS user's writing style
- Reference specific prior runs when relevant (e.g., "Similar to your Run #3 which scored X...")
- Compare engagement probabilities across runs to spot trends
- Tailor suggestions to their actual performance patterns, not generic advice

${entries.join("\n\n")}
`;
}

function buildPrompt(
  input: TweetInput,
  result: ScoredResult,
  priorRuns?: PriorRunContext[]
): string {
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
${input.media && input.media !== "none" ? `Media: ${input.media}${input.mediaData ? " (image attached below - analyze its content and how it complements the tweet)" : ""}` : ""}
${input.followers !== undefined ? `Follower count: ${input.followers.toLocaleString()}` : ""}

## How the Algorithm Weights Engagement

The scoring formula is Score = Σ(weight × probability). These are the weights, from most to least impactful:

**Highest value actions (what to optimize for):**
- followAuthor (12.0) — the single most valuable signal. Content that makes people follow you is king.
- reply (11.0) — replies are almost as valuable as follows. Conversation-starting content wins.
- quote (8.0) — quote tweets signal strong engagement. Tweetable, commentable ideas score high.
- shareViaDm (6.0) and share (5.0) — content people want to send to friends is heavily rewarded.
- retweet (4.0) — straightforward amplification signal.

**Medium value:**
- shareViaCopyLink (3.0), profileClick (1.5), favorite (1.0)

**Low value:**
- vqv (0.8), dwell (0.5), click (0.5), photoExpand (0.3)

**Severe penalties:**
- report (-200.0), notInterested/blockAuthor/muteAuthor (-74.0 each)

The algorithm massively rewards content that drives replies, follows, quotes, and sharing — not just likes. A tweet that gets 100 likes but no replies scores far worse than one with fewer likes but many replies and quotes.

## Things That Do NOT Help (Do Not Suggest These)

- **Hashtags**: Do NOT suggest adding hashtags. X's CEO has publicly stated multiple times that hashtags hurt distribution. The algorithm does not boost posts with hashtags — they look spammy and reduce reach.
- **Emojis**: Do NOT suggest adding emojis. They do not improve algorithmic scoring and make posts look less authentic. Never add emojis to the revised tweet unless the original already uses them intentionally.
- **Engagement bait**: Do NOT suggest "like and retweet" CTAs, follow-begging, or similar tactics. The algorithm penalizes inauthentic engagement patterns.
- **Thread hooks**: Do NOT suggest "thread 🧵" or "1/" style thread openers for standalone tweets.
- **Explicit questions to bait replies**: Do NOT suggest adding questions like "What do you think?" or "Have you experienced this?" to the end of tweets. If you ask a question and nobody responds, you look desperate. The best reply-driving tweets INVITE questions without asking them explicitly.
- **Padding for length**: X now supports long-form tweets, but longer is NOT better. Write the minimum length needed to land the point with impact. A tight 60-character banger outperforms a padded 280-character version. Never add filler words, unnecessary context, or redundant phrases. If the revised tweet can be shorter without losing punch, make it shorter.

## How to Actually Drive Replies (High-Value Tactics)

The best tweets make people WANT to respond without begging for it. Tactics that work:

- **Personal stakes + uncertainty**: Share something you're about to do or going through. Example: "I am about to go under the SMILE laser to have my vision laser-corrected. The doctors are putting me on Valium. Wish me luck!" — This naturally invites "good luck!" replies, questions about the procedure, and people sharing their own experiences. No question asked, but replies flow naturally.
- **Intriguing incompleteness**: Leave something unsaid that people will want to ask about. Tease information rather than dumping it all.
- **Contrarian or surprising takes**: State something that challenges assumptions. People reply to disagree, add nuance, or validate.
- **Relatable struggles or wins**: Personal updates that others identify with generate "same!" and story-sharing replies.
- **Expertise flex with implicit invitation**: Share knowledge in a way that invites follow-up questions ("After 10 years of X, here's what I've learned...").

The goal is to create a "reply vacuum" — content so engaging that NOT responding feels like missing out.

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
${buildHistorySection(priorRuns)}
Provide your analysis as JSON with these fields:
- assessment: 2-3 sentence overall assessment. Reference the specific weight values to explain why the score is what it is.
- viralityRating: integer 1-10
- strengths: array of 2-4 strengths, each referencing which P(action) it relates to and its weight
- weaknesses: array of 2-4 weaknesses, each referencing which P(action) it relates to and its weight
- suggestions: array of 2-4 actionable suggestions focused on driving replies, follows, quotes, and shares (the highest-weighted actions). Each should note which P(action) it would improve and why that matters given the weight.
- revisedTweet: a revised version of the tweet incorporating your suggestions. Do NOT add hashtags or emojis unless the original tweet already uses them.`;
}

export interface GeminiAnalysisResult {
  analysis: GeminiAnalysis;
  usage: TokenUsage;
}

export async function analyzeWithGemini(
  input: TweetInput,
  result: ScoredResult,
  apiKey: string,
  model: string,
  priorRuns?: PriorRunContext[]
): Promise<GeminiAnalysisResult> {
  const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

  // Build parts array - text first, then image if available
  const parts: Array<Record<string, unknown>> = [{ text: buildPrompt(input, result, priorRuns) }];

  // Add image if mediaData is provided (base64 data URI)
  if (input.mediaData) {
    const match = input.mediaData.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const [, mimeType, base64Data] = match;
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Data,
        },
      });
      const sizeKb = Math.round((base64Data.length * 3) / 4 / 1024);
      console.log(`[Gemini] Including image: ${mimeType}, ~${sizeKb}KB`);
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
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
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  const text = data.candidates[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API returned no content");
  }

  const analysis = JSON.parse(text) as GeminiAnalysis;
  const usage: TokenUsage = {
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    cachedTokens: 0,
    model,
  };

  return { analysis, usage };
}
