#!/usr/bin/env node
import "dotenv/config";

/**
 * Tweet Virality Analyzer — CLI entry point
 *
 * Scores tweet text using the X recommendation algorithm's 4-stage
 * scoring pipeline (PhoenixScorer -> WeightedScorer ->
 * AuthorDiversityScorer -> OONScorer).
 *
 * Grok-3-mini replaces the Phoenix transformer for engagement estimation.
 * Gemini 3 Pro provides reasoning and suggestions.
 */

import { parseArgs } from "node:util";
import type { TweetInput } from "./types.js";
import { computeScores, analyzeScores } from "./pipeline.js";
import { displayHeader, displayScores, displayAnalysis, displayError } from "./display.js";

function parseCliArgs(): {
  input: TweetInput;
  scoresOnly: boolean;
} {
  const { values } = parseArgs({
    options: {
      text: { type: "string", short: "t" },
      media: { type: "string", short: "m" },
      followers: { type: "string", short: "f" },
      reply: { type: "boolean" },
      quote: { type: "boolean" },
      "parent-text": { type: "string" },
      "video-duration": { type: "string" },
      "in-network": { type: "boolean" },
      "out-of-network": { type: "boolean" },
      "scores-only": { type: "boolean", short: "s" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help || !values.text) {
    console.log(`
Usage: npm start -- --text "your tweet here" [options]

Options:
  -t, --text <text>           Tweet text (required)
  -m, --media <type>          Media type: image, video, gif, poll, link, none
  -f, --followers <count>     Author follower count
      --reply                 Tweet is a reply
      --quote                 Tweet is a quote tweet
      --parent-text <text>    Parent/quoted tweet text (for replies and quotes)
      --video-duration <ms>   Video duration in milliseconds
      --in-network            Score as in-network content
      --out-of-network        Score as out-of-network content (default)
  -s, --scores-only           Skip Gemini analysis, show scores only
  -h, --help                  Show this help

Environment variables:
  XAI_API_KEY                 xAI API key (required)
  GEMINI_API_KEY              Google AI API key (required unless --scores-only)
  GROK_MODEL                  Grok model (required, e.g. grok-3-mini)
  GEMINI_MODEL                Gemini model (required unless --scores-only, e.g. gemini-3-pro-preview)
`);
    process.exit(values.help ? 0 : 1);
  }

  const validMedia = ["image", "video", "gif", "poll", "link", "none"] as const;
  const media = values.media as (typeof validMedia)[number] | undefined;
  if (media && !validMedia.includes(media)) {
    displayError(`Invalid media type "${media}". Must be one of: ${validMedia.join(", ")}`);
    process.exit(1);
  }

  const inNetwork = values["in-network"] ? true : false;

  return {
    input: {
      text: values.text,
      media: media || undefined,
      followers: values.followers ? parseInt(values.followers, 10) : undefined,
      isReply: values.reply || false,
      isQuote: values.quote || false,
      parentText: values["parent-text"],
      videoDurationMs: values["video-duration"]
        ? parseInt(values["video-duration"], 10)
        : undefined,
      inNetwork,
    },
    scoresOnly: values["scores-only"] || false,
  };
}

async function run(): Promise<void> {
  const { input, scoresOnly } = parseCliArgs();

  const xaiKey = process.env.XAI_API_KEY;
  if (!xaiKey) {
    displayError("XAI_API_KEY environment variable is required");
    process.exit(1);
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!scoresOnly && !geminiKey) {
    displayError("GEMINI_API_KEY environment variable is required (or use --scores-only)");
    process.exit(1);
  }

  const grokModel = process.env.GROK_MODEL;
  if (!grokModel) {
    displayError("GROK_MODEL environment variable is required");
    process.exit(1);
  }

  const geminiModel = process.env.GEMINI_MODEL;
  if (!scoresOnly && !geminiModel) {
    displayError("GEMINI_MODEL environment variable is required (or use --scores-only)");
    process.exit(1);
  }

  displayHeader(input);

  console.log(`\x1b[2mEstimating engagement probabilities with ${grokModel}...\x1b[0m`);
  const scored = await computeScores(input, xaiKey, grokModel);
  displayScores(scored);

  if (!scoresOnly && geminiKey && geminiModel) {
    console.log(`\x1b[2mAnalysing with ${geminiModel}...\x1b[0m`);
    const analysis = await analyzeScores(input, scored, geminiKey, geminiModel);
    displayAnalysis(analysis);
  }
}

run().catch((err: Error) => {
  displayError(err.message);
  process.exit(1);
});
