/**
 * Shared scoring pipeline used by both CLI and web server.
 *
 * Runs the 4-stage scoring pipeline:
 *   PhoenixScorer (Grok) -> WeightedScorer -> AuthorDiversityScorer -> OONScorer
 * and optionally the Gemini analysis stage.
 */

import type { TweetInput, ScoredResult, GeminiAnalysis, TokenUsage, RunCost } from "./types.js";
import type { CalibrationTweet } from "./calibration.js";
import { computeWeightedScore } from "./scoring/weighted-scorer.js";
import { applyAuthorDiversity } from "./scoring/author-diversity-scorer.js";
import { applyOonScoring } from "./scoring/oon-scorer.js";
import { estimateEngagement } from "./agents/grok-engagement.js";
import { analyzeWithGemini } from "./agents/gemini-analysis.js";
import { getXApiUsage } from "./x-client.js";

export interface ComputeScoresResult {
  scored: ScoredResult;
  grokUsage: TokenUsage;
}

/** Stages 1–4: Grok engagement estimation + scoring pipeline */
export async function computeScores(
  input: TweetInput,
  xaiKey: string,
  grokModel: string,
  calibration?: CalibrationTweet[] | null
): Promise<ComputeScoresResult> {
  // Stage 1: Grok estimates engagement probabilities
  const { scores: phoenixScores, usage: grokUsage } = await estimateEngagement(
    input,
    xaiKey,
    grokModel,
    calibration
  );

  // Stage 2: Weighted scorer
  const weighted = computeWeightedScore({
    scores: phoenixScores,
    videoDurationMs: input.videoDurationMs,
  });

  // Stage 3: Author diversity scorer (position=0 for standalone analysis)
  const diversity = applyAuthorDiversity(weighted.offsetScore, 0);

  // Stage 4: OON scorer
  const oon = applyOonScoring(diversity.adjustedScore, input.inNetwork ?? false);

  return {
    scored: {
      phoenixScores,
      rawWeightedScore: weighted.rawScore,
      weightBreakdown: weighted.breakdown,
      offsetScore: weighted.offsetScore,
      diversityMultiplier: diversity.multiplier,
      diversityAdjustedScore: diversity.adjustedScore,
      oonMultiplier: oon.multiplier,
      finalScore: oon.adjustedScore,
    },
    grokUsage,
  };
}

export interface AnalyzeScoresResult {
  analysis: GeminiAnalysis;
  geminiUsage: TokenUsage;
}

/** Stage 5: Gemini analysis */
export async function analyzeScores(
  input: TweetInput,
  scored: ScoredResult,
  geminiKey: string,
  geminiModel: string
): Promise<AnalyzeScoresResult> {
  const { analysis, usage } = await analyzeWithGemini(input, scored, geminiKey, geminiModel);
  return { analysis, geminiUsage: usage };
}

/** Gemini pricing tier boundary (tokens) */
const GEMINI_LONG_PROMPT_THRESHOLD = 200_000;

/** Calculate cost breakdown from usage data */
export function calculateCost(grokUsage?: TokenUsage, geminiUsage?: TokenUsage): RunCost {
  const grokInputRate = parseFloat(process.env.GROK_INPUT_COST_PER_MILLION || "0");
  const grokCachedInputRate = parseFloat(process.env.GROK_CACHED_INPUT_COST_PER_MILLION || "0");
  const grokOutputRate = parseFloat(process.env.GROK_OUTPUT_COST_PER_MILLION || "0");

  let totalCost = 0;
  const cost: RunCost = { totalCost: 0 };

  if (grokUsage) {
    const uncachedInput = grokUsage.inputTokens - grokUsage.cachedTokens;
    const gCost =
      (uncachedInput / 1_000_000) * grokInputRate +
      (grokUsage.cachedTokens / 1_000_000) * grokCachedInputRate +
      (grokUsage.outputTokens / 1_000_000) * grokOutputRate;
    cost.grok = { usage: grokUsage, cost: gCost };
    totalCost += gCost;
  }

  if (geminiUsage) {
    const isLong = geminiUsage.inputTokens > GEMINI_LONG_PROMPT_THRESHOLD;
    const geminiInputCost = parseFloat(
      isLong
        ? process.env.GEMINI_INPUT_COST_PER_MILLION_LONG || "0"
        : process.env.GEMINI_INPUT_COST_PER_MILLION || "0"
    );
    const geminiOutputCost = parseFloat(
      isLong
        ? process.env.GEMINI_OUTPUT_COST_PER_MILLION_LONG || "0"
        : process.env.GEMINI_OUTPUT_COST_PER_MILLION || "0"
    );
    const gCost =
      (geminiUsage.inputTokens / 1_000_000) * geminiInputCost +
      (geminiUsage.outputTokens / 1_000_000) * geminiOutputCost;
    cost.gemini = { usage: geminiUsage, cost: gCost };
    totalCost += gCost;
  }

  const xApiUsage = getXApiUsage();
  if (xApiUsage.reads > 0 || xApiUsage.writes > 0) {
    cost.xApi = xApiUsage;
  }

  cost.totalCost = totalCost;
  return cost;
}
