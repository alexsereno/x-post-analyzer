/**
 * Fetches and caches real tweet engagement data from the X API
 * to calibrate Grok's engagement probability estimates.
 *
 * Cache is stored at analyzer/data/calibration-cache.json with a 7-day TTL.
 * Falls back gracefully when no X_BEARER_TOKEN is available.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@xdevplatform/xdk";
import { searchRecentTweets, type XSearchTweet } from "./x-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", "data");
const CACHE_PATH = join(CACHE_DIR, "calibration-cache.json");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CalibrationTweet = XSearchTweet;

interface CalibrationCache {
  fetchedAt: string;
  tweets: CalibrationTweet[];
}

let cached: CalibrationTweet[] | null = null;

async function readCache(): Promise<CalibrationCache | null> {
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as CalibrationCache;
  } catch {
    return null;
  }
}

async function writeCache(tweets: CalibrationTweet[]): Promise<void> {
  const data: CalibrationCache = {
    fetchedAt: new Date().toISOString(),
    tweets,
  };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(data, null, 2));
}

function isCacheFresh(cache: CalibrationCache): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

const SEARCH_QUERIES = [
  { query: "lang:en -is:retweet -is:reply min_faves:100", label: "high engagement" },
  { query: "lang:en -is:retweet -is:reply has:media min_faves:50", label: "media tweets" },
  { query: "lang:en -is:retweet -is:reply -has:media -has:links", label: "low engagement text" },
];

async function fetchCalibrationTweets(client: Client): Promise<CalibrationTweet[]> {
  const all: CalibrationTweet[] = [];

  for (const { query, label } of SEARCH_QUERIES) {
    try {
      const tweets = await searchRecentTweets(client, query, 10);
      all.push(...tweets);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Calibration: failed to fetch ${label} tweets: ${msg}`);
    }
  }

  return all;
}

/**
 * Loads calibration tweets, fetching from the X API if the cache is stale.
 * Returns null if no data is available (no token, fetch failed, etc.).
 */
export async function loadCalibration(client: Client | null): Promise<CalibrationTweet[] | null> {
  // Return in-memory cache if available
  if (cached) return cached;

  // Try disk cache
  const diskCache = await readCache();
  if (diskCache && isCacheFresh(diskCache) && diskCache.tweets.length > 0) {
    cached = diskCache.tweets;
    console.log(`  Calibration: loaded ${cached.length} tweets from cache`);
    return cached;
  }

  // Need to fetch — requires a client
  if (!client) {
    if (diskCache && diskCache.tweets.length > 0) {
      // Stale cache is better than nothing
      cached = diskCache.tweets;
      console.warn("  Calibration: using stale cache (no X client to refresh)");
      return cached;
    }
    console.warn("  Calibration: no data available (no X_BEARER_TOKEN)");
    return null;
  }

  // Fetch fresh data
  console.log("  Calibration: fetching real tweets from X API...");
  const tweets = await fetchCalibrationTweets(client);

  if (tweets.length === 0) {
    if (diskCache && diskCache.tweets.length > 0) {
      cached = diskCache.tweets;
      console.warn("  Calibration: fetch returned no results, using stale cache");
      return cached;
    }
    console.warn("  Calibration: no data available");
    return null;
  }

  // Write to cache
  try {
    await writeCache(tweets);
    console.log(`  Calibration: cached ${tweets.length} tweets`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Calibration: failed to write cache: ${msg}`);
  }

  cached = tweets;
  return cached;
}

/**
 * Select a diverse subset of calibration tweets for the prompt.
 * Picks ~8-10 tweets: 3 high-engagement, 3 medium, 2-3 low.
 */
export function selectExamples(tweets: CalibrationTweet[]): CalibrationTweet[] {
  if (tweets.length <= 10) return tweets;

  const sorted = [...tweets].sort((a, b) => b.likeCount - a.likeCount);
  const high = sorted.slice(0, 3);
  const mid = sorted.slice(Math.floor(sorted.length * 0.3), Math.floor(sorted.length * 0.3) + 3);
  const low = sorted.slice(-3);

  // Deduplicate by text (in case ranges overlap)
  const seen = new Set<string>();
  const result: CalibrationTweet[] = [];
  for (const t of [...high, ...mid, ...low]) {
    const key = t.text.slice(0, 60);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }

  return result.slice(0, 10);
}

/**
 * Build a few-shot example in the PhoenixScores output format.
 * Observable rates are computed from impression data; unobservable
 * fields are left for Grok to estimate using its knowledge of X.
 */
function buildFewShotExample(t: CalibrationTweet, index: number): string {
  const truncated = t.text.length > 120 ? t.text.slice(0, 117) + "..." : t.text;
  const mediaLabel = t.mediaType === "none" ? "text only" : t.mediaType;
  const hasImage = t.mediaType === "image" || t.mediaType === "gif";
  const hasVideo = t.mediaType === "video" || t.mediaType === "gif";

  const lines: string[] = [];
  lines.push(`Example ${index}:`);
  lines.push(`Input:`);
  lines.push(`  Tweet: "${truncated}"`);
  lines.push(`  Media: ${mediaLabel} | Author followers: ${t.authorFollowers.toLocaleString()}`);
  lines.push(
    `  Engagement: ${t.likeCount.toLocaleString()} likes, ${t.replyCount.toLocaleString()} replies, ${t.retweetCount.toLocaleString()} retweets, ${t.quoteCount.toLocaleString()} quotes, ${t.bookmarkCount.toLocaleString()} bookmarks`
  );

  if (t.impressionCount && t.impressionCount > 0) {
    const imp = t.impressionCount;
    lines.push(`  Impressions: ${imp.toLocaleString()}`);
    lines.push(`Output:`);
    lines.push(`{`);
    lines.push(`  "favoriteScore": ${(t.likeCount / imp).toFixed(6)},`);
    lines.push(`  "replyScore": ${(t.replyCount / imp).toFixed(6)},`);
    lines.push(`  "retweetScore": ${(t.retweetCount / imp).toFixed(6)},`);
    lines.push(`  "photoExpandScore": ${hasImage ? "/* estimate */" : "0.0"},`);
    lines.push(`  "clickScore": /* estimate */,`);
    lines.push(`  "profileClickScore": /* estimate */,`);
    lines.push(`  "vqvScore": ${hasVideo ? "/* estimate */" : "0.0"},`);
    lines.push(
      `  "shareScore": /* estimate — bookmarks (${t.bookmarkCount}) suggest save/share intent */,`
    );
    lines.push(`  "shareViaDmScore": /* estimate */,`);
    lines.push(`  "shareViaCopyLinkScore": /* estimate */,`);
    lines.push(`  "dwellScore": /* estimate */,`);
    lines.push(`  "quoteScore": ${(t.quoteCount / imp).toFixed(6)},`);
    lines.push(`  "quotedClickScore": ${t.quoteCount > 0 ? "/* estimate */" : "0.0"},`);
    lines.push(`  "followAuthorScore": /* estimate */,`);
    lines.push(`  "notInterestedScore": /* estimate */,`);
    lines.push(`  "blockAuthorScore": /* estimate */,`);
    lines.push(`  "muteAuthorScore": /* estimate */,`);
    lines.push(`  "reportScore": /* estimate */,`);
    lines.push(`  "dwellTime": /* estimate in seconds */`);
    lines.push(`}`);
  } else {
    // No impression data — show counts only, no partial output
    lines.push(`(No impression data — use engagement counts to infer rates)`);
  }

  return lines.join("\n");
}

/**
 * Build the calibration section for the Grok system prompt.
 * Uses few-shot examples in the PhoenixScores output format
 * so Grok sees concrete input→output mappings.
 */
export function buildCalibrationPrompt(tweets: CalibrationTweet[]): string {
  const examples = selectExamples(tweets);

  // Partition: tweets with impression data first (better few-shot), then the rest
  const withImpressions = examples.filter((t) => t.impressionCount && t.impressionCount > 0);
  const withoutImpressions = examples.filter((t) => !t.impressionCount || t.impressionCount <= 0);
  const ordered = [...withImpressions, ...withoutImpressions];

  const lines: string[] = [
    "Few-shot calibration — real tweets with computed engagement rates in the exact output format.",
    "Observable rates (favorite, reply, retweet, quote) are computed from real impression data.",
    "For /* estimate */ fields, use your knowledge of X engagement patterns to fill in realistic values.\n",
  ];

  for (let i = 0; i < ordered.length; i++) {
    lines.push(buildFewShotExample(ordered[i], i + 1));
    lines.push("");
  }

  lines.push(
    "Now produce the full PhoenixScores JSON for the target tweet below.",
    "Fill in ALL fields with numeric values — no comments, no placeholders.",
    "Anchor your estimates on the real rates shown above."
  );

  return lines.join("\n");
}
