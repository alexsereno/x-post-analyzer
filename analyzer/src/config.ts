/**
 * Scoring weights and configuration.
 *
 * The actual weight values are excluded from the open-source release
 * (home-mixer/lib.rs:5). These are estimated defaults based on the
 * algorithm's structure and the positive/negative categorisation
 * documented in the codebase.
 */

export const WEIGHTS = {
  favorite: 1.0,
  reply: 11.0,
  retweet: 4.0,
  photoExpand: 0.3,
  click: 0.5,
  profileClick: 1.5,
  vqv: 0.8,
  share: 5.0,
  shareViaDm: 6.0,
  shareViaCopyLink: 3.0,
  dwell: 0.5,
  quote: 8.0,
  quotedClick: 0.5,
  dwellTime: 0.01,
  followAuthor: 12.0,
  notInterested: -74.0,
  blockAuthor: -74.0,
  muteAuthor: -74.0,
  report: -200.0,
} as const;

/** Sum of all positive weights */
export const POSITIVE_WEIGHTS_SUM =
  WEIGHTS.favorite +
  WEIGHTS.reply +
  WEIGHTS.retweet +
  WEIGHTS.photoExpand +
  WEIGHTS.click +
  WEIGHTS.profileClick +
  WEIGHTS.vqv +
  WEIGHTS.share +
  WEIGHTS.shareViaDm +
  WEIGHTS.shareViaCopyLink +
  WEIGHTS.dwell +
  WEIGHTS.quote +
  WEIGHTS.quotedClick +
  WEIGHTS.dwellTime +
  WEIGHTS.followAuthor;

/** Sum of all negative weights */
export const NEGATIVE_WEIGHTS_SUM =
  WEIGHTS.notInterested + WEIGHTS.blockAuthor + WEIGHTS.muteAuthor + WEIGHTS.report;

/** Total sum of all weights (positive + negative) */
export const WEIGHTS_SUM = POSITIVE_WEIGHTS_SUM + NEGATIVE_WEIGHTS_SUM;

/** Offset applied to normalise negative scores (from weighted_scorer.rs:83-91) */
export const NEGATIVE_SCORES_OFFSET = 1.0;

/** Minimum video duration (ms) for VQV weight to apply */
export const MIN_VIDEO_DURATION_MS = 5000;

/** Author diversity scorer defaults (from author_diversity_scorer.rs) */
export const AUTHOR_DIVERSITY_DECAY = 0.5;
export const AUTHOR_DIVERSITY_FLOOR = 0.2;

/** Out-of-network weight factor (from oon_scorer.rs) */
export const OON_WEIGHT_FACTOR = 0.5;

/** API endpoints */
export const XAI_API_URL = "https://api.x.ai/v1/chat/completions";
export const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
