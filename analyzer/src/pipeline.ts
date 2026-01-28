/**
 * Shared scoring pipeline used by both CLI and web server.
 *
 * Runs the 4-stage scoring pipeline:
 *   PhoenixScorer (Grok) -> WeightedScorer -> AuthorDiversityScorer -> OONScorer
 * and optionally the Gemini analysis stage.
 */

import type { TweetInput, ScoredResult, GeminiAnalysis } from "./types.js";
import { computeWeightedScore } from "./scoring/weighted-scorer.js";
import { applyAuthorDiversity } from "./scoring/author-diversity-scorer.js";
import { applyOonScoring } from "./scoring/oon-scorer.js";
import { estimateEngagement } from "./agents/grok-engagement.js";
import { analyzeWithGemini } from "./agents/gemini-analysis.js";

/** Stages 1–4: Grok engagement estimation + scoring pipeline */
export async function computeScores(
  input: TweetInput,
  xaiKey: string,
  grokModel: string
): Promise<ScoredResult> {
  // Stage 1: Grok estimates engagement probabilities
  const phoenixScores = await estimateEngagement(input, xaiKey, grokModel);

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
    phoenixScores,
    rawWeightedScore: weighted.rawScore,
    weightBreakdown: weighted.breakdown,
    offsetScore: weighted.offsetScore,
    diversityMultiplier: diversity.multiplier,
    diversityAdjustedScore: diversity.adjustedScore,
    oonMultiplier: oon.multiplier,
    finalScore: oon.adjustedScore,
  };
}

/** Stage 5: Gemini analysis */
export async function analyzeScores(
  input: TweetInput,
  scored: ScoredResult,
  geminiKey: string,
  geminiModel: string
): Promise<GeminiAnalysis> {
  return analyzeWithGemini(input, scored, geminiKey, geminiModel);
}
