/** Mirrors PhoenixScores from candidate_pipeline/candidate.rs */
export interface PhoenixScores {
  favoriteScore: number;
  replyScore: number;
  retweetScore: number;
  photoExpandScore: number;
  clickScore: number;
  profileClickScore: number;
  vqvScore: number;
  shareScore: number;
  shareViaDmScore: number;
  shareViaCopyLinkScore: number;
  dwellScore: number;
  quoteScore: number;
  quotedClickScore: number;
  followAuthorScore: number;
  notInterestedScore: number;
  blockAuthorScore: number;
  muteAuthorScore: number;
  reportScore: number;
  dwellTime: number;
}

/** Input from the user via CLI flags */
export interface TweetInput {
  text: string;
  media?: "image" | "video" | "gif" | "poll" | "link" | "none";
  followers?: number;
  isReply?: boolean;
  isQuote?: boolean;
  parentText?: string;
  videoDurationMs?: number;
  inNetwork?: boolean;
}

/** Result after all scoring stages */
export interface ScoredResult {
  phoenixScores: PhoenixScores;
  rawWeightedScore: number;
  weightBreakdown: WeightBreakdownEntry[];
  offsetScore: number;
  diversityMultiplier: number;
  diversityAdjustedScore: number;
  oonMultiplier: number;
  finalScore: number;
}

export interface WeightBreakdownEntry {
  action: string;
  probability: number;
  weight: number;
  contribution: number;
}

/** Token usage from an LLM API call */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  model: string;
}

/** X API usage tracking (free tier: 100 reads/mo, 500 posts/mo) */
export interface XApiUsage {
  reads: number;
  writes: number;
  endpoints: string[];
}

/** Cost breakdown for a single run */
export interface RunCost {
  grok?: { usage: TokenUsage; cost: number };
  gemini?: { usage: TokenUsage; cost: number };
  xApi?: XApiUsage;
  totalCost: number;
}

/** Gemini analysis output */
export interface GeminiAnalysis {
  assessment: string;
  viralityRating: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  revisedTweet: string;
}
