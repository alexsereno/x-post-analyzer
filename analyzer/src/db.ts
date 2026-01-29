/**
 * SQLite database layer for persistent history and usage tracking.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, "..", "data");
const DB_PATH = join(DB_DIR, "analyzer.db");

let db: Database.Database;

export function initDb(): void {
  mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      tweet_text TEXT NOT NULL,
      tweet_type TEXT NOT NULL DEFAULT 'tweet',
      media_type TEXT,
      video_duration_ms INTEGER,
      parent_url TEXT,
      parent_text TEXT,
      parent_author_name TEXT,
      parent_author_username TEXT,
      parent_tweet_id TEXT,
      author_name TEXT,
      author_handle TEXT,
      author_avatar TEXT,
      follower_count INTEGER DEFAULT 0,
      in_network INTEGER NOT NULL DEFAULT 0,
      scored_result TEXT,
      gemini_analysis TEXT,
      cost_data TEXT,
      posted_tweet_id TEXT,
      final_score REAL
    );

    CREATE TABLE IF NOT EXISTS x_api_usage (
      month TEXT NOT NULL,
      type TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (month, type)
    );
  `);
}

export interface RunRow {
  id: string;
  created_at: number;
  tweet_text: string;
  tweet_type: string;
  media_type: string | null;
  video_duration_ms: number | null;
  parent_url: string | null;
  parent_text: string | null;
  parent_author_name: string | null;
  parent_author_username: string | null;
  parent_tweet_id: string | null;
  author_name: string | null;
  author_handle: string | null;
  author_avatar: string | null;
  follower_count: number;
  in_network: number;
  scored_result: string | null;
  gemini_analysis: string | null;
  cost_data: string | null;
  posted_tweet_id: string | null;
  final_score: number | null;
}

export interface SaveRunInput {
  id: string;
  tweetText: string;
  tweetType: string;
  mediaType?: string | null;
  videoDurationMs?: number | null;
  parentUrl?: string | null;
  parentText?: string | null;
  parentAuthorName?: string | null;
  parentAuthorUsername?: string | null;
  parentTweetId?: string | null;
  authorName?: string | null;
  authorHandle?: string | null;
  authorAvatar?: string | null;
  followerCount?: number;
  inNetwork: boolean;
  scoredResult: unknown;
  costData?: unknown;
  finalScore: number;
}

export function saveRun(entry: SaveRunInput): void {
  const stmt = db.prepare(`
    INSERT INTO runs (
      id, created_at, tweet_text, tweet_type, media_type, video_duration_ms,
      parent_url, parent_text, parent_author_name, parent_author_username, parent_tweet_id,
      author_name, author_handle, author_avatar, follower_count, in_network,
      scored_result, cost_data, final_score
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  stmt.run(
    entry.id,
    Date.now(),
    entry.tweetText,
    entry.tweetType,
    entry.mediaType ?? null,
    entry.videoDurationMs ?? null,
    entry.parentUrl ?? null,
    entry.parentText ?? null,
    entry.parentAuthorName ?? null,
    entry.parentAuthorUsername ?? null,
    entry.parentTweetId ?? null,
    entry.authorName ?? null,
    entry.authorHandle ?? null,
    entry.authorAvatar ?? null,
    entry.followerCount ?? 0,
    entry.inNetwork ? 1 : 0,
    JSON.stringify(entry.scoredResult),
    entry.costData ? JSON.stringify(entry.costData) : null,
    entry.finalScore
  );
}

export function updateRunAnalysis(id: string, analysis: unknown, costData: unknown): void {
  db.prepare(
    `
    UPDATE runs SET gemini_analysis = ?, cost_data = ? WHERE id = ?
  `
  ).run(JSON.stringify(analysis), JSON.stringify(costData), id);
}

export function updateRunPosted(id: string, postedTweetId: string): void {
  db.prepare(
    `
    UPDATE runs SET posted_tweet_id = ? WHERE id = ?
  `
  ).run(postedTweetId, id);
}

export interface RunSummary {
  id: string;
  timestamp: number;
  text: string;
  tweetType: string;
  mediaType: string | null;
  parentText: string | null;
  parentAuthorUsername: string | null;
  authorName: string | null;
  authorHandle: string | null;
  authorAvatar: string | null;
  inNetwork: boolean;
  finalScore: number | null;
  postedTweetId: string | null;
}

export function listRuns(): RunSummary[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, tweet_text, tweet_type, media_type,
              parent_text, parent_author_username,
              author_name, author_handle, author_avatar,
              in_network, final_score, posted_tweet_id
       FROM runs ORDER BY created_at DESC LIMIT 200`
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as string,
    timestamp: r.created_at as number,
    text: r.tweet_text as string,
    tweetType: r.tweet_type as string,
    mediaType: r.media_type as string | null,
    parentText: r.parent_text as string | null,
    parentAuthorUsername: r.parent_author_username as string | null,
    authorName: r.author_name as string | null,
    authorHandle: r.author_handle as string | null,
    authorAvatar: r.author_avatar as string | null,
    inNetwork: (r.in_network as number) === 1,
    finalScore: r.final_score as number | null,
    postedTweetId: r.posted_tweet_id as string | null,
  }));
}

export interface RunDetail {
  id: string;
  timestamp: number;
  text: string;
  tweetType: string;
  mediaType: string | null;
  videoDurationMs: number | null;
  parentUrl: string | null;
  parentText: string | null;
  parentAuthorName: string | null;
  parentAuthorUsername: string | null;
  parentTweetId: string | null;
  authorName: string | null;
  authorHandle: string | null;
  authorAvatar: string | null;
  followerCount: number;
  inNetwork: boolean;
  scoredResult: unknown | null;
  geminiAnalysis: unknown | null;
  costData: unknown | null;
  postedTweetId: string | null;
  finalScore: number | null;
}

export function getRun(id: string): RunDetail | null {
  const r = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
  if (!r) return null;

  return {
    id: r.id,
    timestamp: r.created_at,
    text: r.tweet_text,
    tweetType: r.tweet_type,
    mediaType: r.media_type,
    videoDurationMs: r.video_duration_ms,
    parentUrl: r.parent_url,
    parentText: r.parent_text,
    parentAuthorName: r.parent_author_name,
    parentAuthorUsername: r.parent_author_username,
    parentTweetId: r.parent_tweet_id,
    authorName: r.author_name,
    authorHandle: r.author_handle,
    authorAvatar: r.author_avatar,
    followerCount: r.follower_count,
    inNetwork: r.in_network === 1,
    scoredResult: r.scored_result ? JSON.parse(r.scored_result) : null,
    geminiAnalysis: r.gemini_analysis ? JSON.parse(r.gemini_analysis) : null,
    costData: r.cost_data ? JSON.parse(r.cost_data) : null,
    postedTweetId: r.posted_tweet_id,
    finalScore: r.final_score,
  };
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function incrementXApiUsage(reads: number, writes: number): void {
  const month = currentMonth();
  const upsert = db.prepare(`
    INSERT INTO x_api_usage (month, type, count) VALUES (?, ?, ?)
    ON CONFLICT(month, type) DO UPDATE SET count = count + excluded.count
  `);

  if (reads > 0) upsert.run(month, "read", reads);
  if (writes > 0) upsert.run(month, "write", writes);
}

export interface MonthlyUsage {
  month: string;
  reads: number;
  writes: number;
}

export interface MonthlyCost {
  month: string;
  totalCost: number;
  runCount: number;
}

export function getMonthlyCost(): MonthlyCost {
  const month = currentMonth();
  const [year, mon] = month.split("-").map(Number);
  const startMs = new Date(year, mon - 1, 1).getTime();
  const endMs = new Date(year, mon, 1).getTime();

  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(
          COALESCE(json_extract(cost_data, '$.scoreCost.totalCost'), 0) +
          COALESCE(json_extract(cost_data, '$.geminiCost.totalCost'), 0)
        ), 0) AS total_cost,
        COUNT(*) AS run_count
      FROM runs
      WHERE created_at >= ? AND created_at < ? AND cost_data IS NOT NULL`
    )
    .get(startMs, endMs) as { total_cost: number; run_count: number };

  return { month, totalCost: row.total_cost, runCount: row.run_count };
}

export interface MonthCostEntry {
  month: string;
  totalCost: number;
  runCount: number;
}

export function getAllMonthlyCosts(): MonthCostEntry[] {
  const rows = db
    .prepare(
      `SELECT
        strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month,
        COALESCE(SUM(
          COALESCE(json_extract(cost_data, '$.scoreCost.totalCost'), 0) +
          COALESCE(json_extract(cost_data, '$.geminiCost.totalCost'), 0)
        ), 0) AS total_cost,
        COUNT(*) AS run_count
      FROM runs
      GROUP BY month
      ORDER BY month DESC`
    )
    .all() as Array<{ month: string; total_cost: number; run_count: number }>;

  return rows.map((r) => ({
    month: r.month,
    totalCost: r.total_cost,
    runCount: r.run_count,
  }));
}

export function getMonthlyUsage(): MonthlyUsage {
  const month = currentMonth();
  const rows = db
    .prepare(`SELECT type, count FROM x_api_usage WHERE month = ?`)
    .all(month) as Array<{ type: string; count: number }>;

  let reads = 0;
  let writes = 0;
  for (const r of rows) {
    if (r.type === "read") reads = r.count;
    if (r.type === "write") writes = r.count;
  }

  return { month, reads, writes };
}

export interface PriorRunForContext {
  text: string;
  tweetType: string;
  mediaType: string | null;
  finalScore: number;
  viralityRating: number;
  assessment: string;
  weightBreakdown: Array<{
    action: string;
    probability: number;
    weight: number;
    contribution: number;
  }>;
}

/**
 * Fetch recent completed runs to provide context for Gemini analysis.
 * Returns up to `limit` runs that have both scores and Gemini analysis.
 * Gemini has a massive context window (~1M tokens) so we can be generous.
 */
export function getPriorRunsForContext(limit = 50): PriorRunForContext[] {
  const rows = db
    .prepare(
      `SELECT tweet_text, tweet_type, media_type, final_score, scored_result, gemini_analysis
       FROM runs
       WHERE scored_result IS NOT NULL AND gemini_analysis IS NOT NULL
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    tweet_text: string;
    tweet_type: string;
    media_type: string | null;
    final_score: number;
    scored_result: string;
    gemini_analysis: string;
  }>;

  return rows.map((r) => {
    const scored = JSON.parse(r.scored_result) as {
      weightBreakdown: Array<{
        action: string;
        probability: number;
        weight: number;
        contribution: number;
      }>;
    };
    const analysis = JSON.parse(r.gemini_analysis) as {
      viralityRating: number;
      assessment: string;
    };

    return {
      text: r.tweet_text,
      tweetType: r.tweet_type,
      mediaType: r.media_type,
      finalScore: r.final_score,
      viralityRating: analysis.viralityRating,
      assessment: analysis.assessment,
      weightBreakdown: scored.weightBreakdown,
    };
  });
}
