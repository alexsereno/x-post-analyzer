/**
 * Port of weighted_scorer.rs
 *
 * Computes: score = Σ(weight_i × P(action_i)) then applies offset logic.
 */

import type { PhoenixScores, WeightBreakdownEntry } from "../types.js";
import {
  WEIGHTS,
  WEIGHTS_SUM,
  NEGATIVE_WEIGHTS_SUM,
  NEGATIVE_SCORES_OFFSET,
  MIN_VIDEO_DURATION_MS,
} from "../config.js";

interface WeightedScorerInput {
  scores: PhoenixScores;
  videoDurationMs?: number;
}

export interface WeightedScorerResult {
  rawScore: number;
  offsetScore: number;
  breakdown: WeightBreakdownEntry[];
}

function vqvWeightEligibility(videoDurationMs?: number): number {
  if (videoDurationMs !== undefined && videoDurationMs > MIN_VIDEO_DURATION_MS) {
    return WEIGHTS.vqv;
  }
  return 0.0;
}

/** Port of weighted_scorer.rs offset_score (lines 83-91) */
function offsetScore(combinedScore: number): number {
  if (WEIGHTS_SUM === 0) {
    return Math.max(combinedScore, 0);
  }
  if (combinedScore < 0) {
    return ((combinedScore + NEGATIVE_WEIGHTS_SUM) / WEIGHTS_SUM) * NEGATIVE_SCORES_OFFSET;
  }
  return combinedScore + NEGATIVE_SCORES_OFFSET;
}

/** Port of weighted_scorer.rs compute_weighted_score (lines 39-82) */
export function computeWeightedScore(input: WeightedScorerInput): WeightedScorerResult {
  const { scores, videoDurationMs } = input;
  const vqvWeight = vqvWeightEligibility(videoDurationMs);

  const pairs: Array<[string, number, number]> = [
    ["favorite", scores.favoriteScore, WEIGHTS.favorite],
    ["reply", scores.replyScore, WEIGHTS.reply],
    ["retweet", scores.retweetScore, WEIGHTS.retweet],
    ["photoExpand", scores.photoExpandScore, WEIGHTS.photoExpand],
    ["click", scores.clickScore, WEIGHTS.click],
    ["profileClick", scores.profileClickScore, WEIGHTS.profileClick],
    ["vqv", scores.vqvScore, vqvWeight],
    ["share", scores.shareScore, WEIGHTS.share],
    ["shareViaDm", scores.shareViaDmScore, WEIGHTS.shareViaDm],
    ["shareViaCopyLink", scores.shareViaCopyLinkScore, WEIGHTS.shareViaCopyLink],
    ["dwell", scores.dwellScore, WEIGHTS.dwell],
    ["quote", scores.quoteScore, WEIGHTS.quote],
    ["quotedClick", scores.quotedClickScore, WEIGHTS.quotedClick],
    ["dwellTime", scores.dwellTime, WEIGHTS.dwellTime],
    ["followAuthor", scores.followAuthorScore, WEIGHTS.followAuthor],
    ["notInterested", scores.notInterestedScore, WEIGHTS.notInterested],
    ["blockAuthor", scores.blockAuthorScore, WEIGHTS.blockAuthor],
    ["muteAuthor", scores.muteAuthorScore, WEIGHTS.muteAuthor],
    ["report", scores.reportScore, WEIGHTS.report],
  ];

  const entries: WeightBreakdownEntry[] = pairs.map(([action, probability, weight]) => ({
    action,
    probability,
    weight,
    contribution: probability * weight,
  }));

  const rawScore = entries.reduce((sum, e) => sum + e.contribution, 0);
  const finalScore = offsetScore(rawScore);

  return { rawScore, offsetScore: finalScore, breakdown: entries };
}
