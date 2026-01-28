# Analyzer

Score tweets using the 𝕏 recommendation algorithm's 4-stage scoring pipeline. Available as a web UI and CLI.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in your `.env`:

| Variable | Required | Description |
|---|---|---|
| `XAI_API_KEY` | Yes | [xAI API key](https://console.x.ai/) for Grok engagement estimation |
| `GEMINI_API_KEY` | Yes (web) | [Google AI API key](https://aistudio.google.com/apikey) for analysis |
| `GROK_MODEL` | Yes | Grok model name (e.g. `grok-3-mini`) |
| `GEMINI_MODEL` | Yes (web) | Gemini model name (e.g. `gemini-3-pro-preview`) |
| `X_BEARER_TOKEN` | Optional | [𝕏 API bearer token](https://developer.x.com/) for profile and tweet lookup |
| `X_USERNAME` | Optional | Your 𝕏 handle (used with bearer token to display profile) |

## Web UI

```bash
npm run dev
```

Opens at `http://localhost:3577`. Write a tweet, optionally set it as a reply/quote by pasting a tweet URL, drag-and-drop media to detect type, and hit Rank. Scores render immediately, then Gemini analysis follows.

If `X_BEARER_TOKEN` and `X_USERNAME` are set, your profile and follower count display automatically.

## CLI

```bash
npm start -- --text "your tweet here"
```

### Options

```
-t, --text <text>           Tweet text (required)
-m, --media <type>          Media type: image, video, gif, poll, link, none
-f, --followers <count>     Author follower count
    --reply                 Tweet is a reply
    --quote                 Tweet is a quote tweet
    --parent-text <text>    Parent/quoted tweet text
    --video-duration <ms>   Video duration in milliseconds
    --in-network            Score as in-network content
    --out-of-network        Score as out-of-network content (default)
-s, --scores-only           Skip Gemini analysis, show scores only
-h, --help                  Show help
```

### Examples

```bash
# Basic tweet
npm start -- --text "Just shipped a new feature"

# Tweet with image, scores only
npm start -- --text "Check this out" --media image --scores-only

# Reply to a tweet
npm start -- --text "Great point" --reply --parent-text "Original tweet text"
```

## Scoring pipeline

The tool runs the same 4-stage pipeline as the real 𝕏 algorithm:

1. **Grok** estimates P(action) for 19 engagement types (favorite, reply, retweet, dwell, share, etc.)
2. **WeightedScorer** computes `Score = sum(weight * P(action))` using the algorithm's weights, with negative weights for block/mute/report
3. **AuthorDiversityScorer** applies a decay multiplier based on author position in feed
4. **OONScorer** adjusts for follower vs non-follower audience

Then **Gemini** analyzes the results and provides an assessment, virality rating, strengths/weaknesses, suggestions, and a revised tweet.

## Architecture

```
src/
  index.ts              # CLI entry point
  server.ts             # Web server (node:http)
  pipeline.ts           # Shared scoring pipeline
  types.ts              # TypeScript types
  config.ts             # API URLs
  display.ts            # CLI output formatting
  x-client.ts           # 𝕏 API client (profile + tweet lookup)
  agents/
    grok-engagement.ts  # Grok API for engagement probabilities
    gemini-analysis.ts  # Gemini API for qualitative analysis
  scoring/
    weighted-scorer.ts  # Stage 2: weighted score computation
    author-diversity-scorer.ts  # Stage 3: author diversity
    oon-scorer.ts       # Stage 4: out-of-network adjustment
  public/
    index.html          # Web UI (single page)
```
