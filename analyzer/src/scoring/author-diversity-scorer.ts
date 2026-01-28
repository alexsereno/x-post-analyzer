/**
 * Port of author_diversity_scorer.rs
 *
 * Attenuates repeated-author scores:
 *   multiplier = (1 - floor) × decay^position + floor
 *
 * For the CLI we expose a single-candidate version since we score
 * one tweet at a time. The `position` parameter represents how many
 * times this author has already appeared in the feed (default 0 for
 * a standalone analysis).
 */

import { AUTHOR_DIVERSITY_DECAY, AUTHOR_DIVERSITY_FLOOR } from "../config.js";

export function authorDiversityMultiplier(
  position: number,
  decay: number = AUTHOR_DIVERSITY_DECAY,
  floor: number = AUTHOR_DIVERSITY_FLOOR
): number {
  return (1 - floor) * Math.pow(decay, position) + floor;
}

export function applyAuthorDiversity(
  score: number,
  position: number = 0
): { multiplier: number; adjustedScore: number } {
  const multiplier = authorDiversityMultiplier(position);
  return { multiplier, adjustedScore: score * multiplier };
}
