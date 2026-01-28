import "dotenv/config";

import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TweetInput, ScoredResult } from "./types.js";
import { computeScores, analyzeScores } from "./pipeline.js";
import { createXClient, fetchUserProfile, fetchTweet, extractTweetId } from "./x-client.js";

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
  };
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
      const input = parseTweetInput(payload);
      const scored = await computeScores(input, xaiKey, grokModel);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(scored));
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
      const analysis = await analyzeScores(input, scored, geminiKey, geminiModel);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(analysis));
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
});
