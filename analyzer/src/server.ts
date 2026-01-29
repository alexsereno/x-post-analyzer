import "dotenv/config";

import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TweetInput, ScoredResult } from "./types.js";
import type { CalibrationTweet } from "./calibration.js";
import { loadCalibration } from "./calibration.js";
import { computeScores, analyzeScores, calculateCost } from "./pipeline.js";
import {
  createXClient,
  fetchUserProfile,
  fetchTweet,
  extractTweetId,
  postTweet,
  resetXApiUsage,
  getXApiUsage,
} from "./x-client.js";
import {
  initDb,
  saveRun,
  updateRunAnalysis,
  updateRunPosted,
  listRuns,
  getRun,
  incrementXApiUsage,
  getMonthlyUsage,
  getMonthlyCost,
  getAllMonthlyCosts,
} from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3577;

const xBearerToken = process.env.X_BEARER_TOKEN;
const xClient = xBearerToken ? createXClient(xBearerToken) : null;
const xUsername = process.env.X_USERNAME;
const grokModel = process.env.GROK_MODEL;
const geminiModel = process.env.GEMINI_MODEL;

if (!grokModel || !geminiModel) {
  console.error("GROK_MODEL and GEMINI_MODEL environment variables are required");
  process.exit(1);
}

// Initialize database
initDb();

let calibrationData: CalibrationTweet[] | null = null;

// Load calibration data at startup (non-blocking)
loadCalibration(xClient).then((data) => {
  calibrationData = data;
});

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

function parseTweetInput(payload: Record<string, unknown>): TweetInput {
  return {
    text: payload.text as string,
    media: payload.media as TweetInput["media"],
    followers: payload.followers as number | undefined,
    isReply: (payload.isReply as boolean) ?? false,
    isQuote: (payload.isQuote as boolean) ?? false,
    parentText: payload.parentText as string | undefined,
    videoDurationMs: payload.videoDurationMs as number | undefined,
    inNetwork: (payload.inNetwork as boolean) ?? false,
    mediaData: payload.mediaData as string | undefined,
  };
}

function generateRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // Serve the frontend
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      const html = await readFile(join(__dirname, "public", "index.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to load index.html");
    }
    return;
  }

  // Fetch user profile
  if (req.method === "GET" && url.pathname === "/api/profile") {
    if (!xClient || !xUsername) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "X_BEARER_TOKEN and X_USERNAME must be configured" }));
      return;
    }

    try {
      const profile = await fetchUserProfile(xClient, xUsername);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(profile));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // Fetch tweet by URL or ID
  if (req.method === "GET" && url.pathname === "/api/tweet") {
    if (!xClient) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "X_BEARER_TOKEN not configured" }));
      return;
    }

    const urlOrId = url.searchParams.get("url") || "";
    const tweetId = extractTweetId(urlOrId);
    if (!tweetId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid tweet URL or ID" }));
      return;
    }

    try {
      const tweet = await fetchTweet(xClient, tweetId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tweet));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // History list
  if (req.method === "GET" && url.pathname === "/api/history") {
    try {
      const runs = listRuns();
      const monthlyCosts = getAllMonthlyCosts();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries: runs, monthlyCosts }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // History detail
  if (req.method === "GET" && url.pathname.startsWith("/api/history/")) {
    const runId = url.pathname.slice("/api/history/".length);
    if (!runId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing run ID" }));
      return;
    }

    try {
      const run = getRun(runId);
      if (!run) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Run not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(run));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // Monthly usage
  if (req.method === "GET" && url.pathname === "/api/usage") {
    try {
      const usage = getMonthlyUsage();
      const cost = getMonthlyCost();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ...usage,
          readLimit: 100,
          writeLimit: 500,
          monthlyCost: cost.totalCost,
          monthlyRunCount: cost.runCount,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // Stage 1–4: Score tweet (Grok + scoring pipeline)
  if (req.method === "POST" && url.pathname === "/api/score") {
    const xaiKey = process.env.XAI_API_KEY;
    if (!xaiKey) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "XAI_API_KEY not configured on server" }));
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    if (!payload.text || typeof payload.text !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "text field is required" }));
      return;
    }

    try {
      resetXApiUsage();
      const input = parseTweetInput(payload);
      const { scored, grokUsage } = await computeScores(input, xaiKey, grokModel, calibrationData);
      const cost = calculateCost(grokUsage);

      // Persist to database
      const runId = generateRunId();
      const tweetType = input.isReply ? "reply" : input.isQuote ? "quote" : "tweet";
      saveRun({
        id: runId,
        tweetText: input.text,
        tweetType,
        mediaType: input.media ?? null,
        videoDurationMs: input.videoDurationMs ?? null,
        parentUrl: (payload.parentUrl as string) ?? null,
        parentText: input.parentText ?? null,
        parentAuthorName: (payload.parentAuthorName as string) ?? null,
        parentAuthorUsername: (payload.parentAuthorUsername as string) ?? null,
        parentTweetId: (payload.parentTweetId as string) ?? null,
        authorName: (payload.authorName as string) ?? null,
        authorHandle: (payload.authorHandle as string) ?? null,
        authorAvatar: (payload.authorAvatar as string) ?? null,
        followerCount: input.followers ?? 0,
        inNetwork: input.inNetwork ?? false,
        scoredResult: scored,
        costData: { scoreCost: cost, geminiCost: null },
        finalScore: scored.finalScore,
      });

      // Track X API usage from this request
      const xUsage = getXApiUsage();
      if (xUsage.reads > 0 || xUsage.writes > 0) {
        incrementXApiUsage(xUsage.reads, xUsage.writes);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...scored, usage: { grok: grokUsage }, cost, runId }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // Stage 5: Gemini analysis
  if (req.method === "POST" && url.pathname === "/api/gemini") {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "GEMINI_API_KEY not configured on server" }));
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    if (!payload.text || !payload.scored) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "text and scored fields are required" }));
      return;
    }

    try {
      const input = parseTweetInput(payload);
      const scored = payload.scored as ScoredResult;
      const { analysis, geminiUsage } = await analyzeScores(input, scored, geminiKey, geminiModel);
      const cost = calculateCost(undefined, geminiUsage);

      // Persist Gemini analysis to database
      const runId = payload.runId as string | undefined;
      if (runId) {
        const existingRun = getRun(runId);
        const existingCost = (existingRun?.costData as Record<string, unknown>) ?? {};
        updateRunAnalysis(runId, analysis, {
          ...existingCost,
          geminiCost: cost,
        });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...analysis, usage: { gemini: geminiUsage }, cost }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // Post tweet to X
  if (req.method === "POST" && url.pathname === "/api/post") {
    if (!xClient) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "X_BEARER_TOKEN not configured" }));
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    if (!payload.text || typeof payload.text !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "text field is required" }));
      return;
    }

    try {
      const result = await postTweet(xClient, {
        text: payload.text as string,
        replyToTweetId: payload.replyToTweetId as string | undefined,
        quoteTweetId: payload.quoteTweetId as string | undefined,
      });

      // Persist posted tweet ID to database
      const runId = payload.runId as string | undefined;
      if (runId) {
        updateRunPosted(runId, result.id);
      }

      // Track the write
      incrementXApiUsage(0, 1);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Tweet Virality Analyzer running at http://localhost:${PORT}`);
  console.log(`  Grok model:   ${grokModel}`);
  console.log(`  Gemini model: ${geminiModel}`);
  if (!xClient || !xUsername) {
    console.log("  Note: X_BEARER_TOKEN / X_USERNAME not set — profile and tweet lookup disabled");
  }
  if (!xBearerToken) {
    console.log("  Note: Calibration disabled (no X_BEARER_TOKEN)");
  }
});
