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
 * Build the calibration section for the Grok system prompt.
 */
export function buildCalibrationPrompt(tweets: CalibrationTweet[]): string {
  const examples = selectExamples(tweets);

  const lines: string[] = [
    "Calibration — here are real tweets with their actual engagement metrics.",
    "Use these to calibrate your probability estimates.\n",
  ];

  for (let i = 0; i < examples.length; i++) {
    const t = examples[i];
    const truncated = t.text.length > 120 ? t.text.slice(0, 117) + "..." : t.text;
    const mediaLabel = t.mediaType === "none" ? "text only" : t.mediaType;

    lines.push(`Example ${i + 1}:`);
    lines.push(`Tweet: "${truncated}"`);
    lines.push(`Media: ${mediaLabel} | Author followers: ${t.authorFollowers.toLocaleString()}`);

    const engagement = `Engagement: ${t.likeCount.toLocaleString()} likes, ${t.replyCount.toLocaleString()} replies, ${t.retweetCount.toLocaleString()} retweets, ${t.quoteCount.toLocaleString()} quotes, ${t.bookmarkCount.toLocaleString()} bookmarks`;
    lines.push(engagement);

    if (t.impressionCount && t.impressionCount > 0) {
      const likeRate = (t.likeCount / t.impressionCount).toFixed(4);
      const replyRate = (t.replyCount / t.impressionCount).toFixed(5);
      const retweetRate = (t.retweetCount / t.impressionCount).toFixed(5);
      lines.push(
        `Impressions: ${t.impressionCount.toLocaleString()} → like rate: ${likeRate}, reply rate: ${replyRate}, retweet rate: ${retweetRate}`
      );
    }
    lines.push("");
  }

  lines.push(
    "Now estimate probabilities for the target tweet below.",
    "For actions not directly observable above (click, profileClick, dwell, vqv, etc.),",
    "use the engagement counts as anchoring signals — tweets with higher like/reply",
    "counts generally have proportionally higher click and dwell rates."
  );

  return lines.join("\n");
}
