/**
 * Port of oon_scorer.rs (lines 20-22)
 *
 * Out-of-network posts get their score multiplied by OON_WEIGHT_FACTOR.
 * In-network posts keep their score unchanged.
 */

import { OON_WEIGHT_FACTOR } from "../config.js";

export function applyOonScoring(
  score: number,
  inNetwork: boolean
): { multiplier: number; adjustedScore: number } {
  const multiplier = inNetwork ? 1.0 : OON_WEIGHT_FACTOR;
  return { multiplier, adjustedScore: score * multiplier };
}
