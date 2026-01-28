# 𝕏 Post Analyzer

Predict how the 𝕏 recommendation algorithm will score your posts before you publish them.

Built on top of the [open-source 𝕏 recommendation algorithm](https://github.com/xai-org/x-algorithm), this tool runs your draft tweet through the same 4-stage scoring pipeline that powers the For You feed. Grok estimates engagement probabilities, the algorithm's real weights produce a score, and Gemini provides an analysis with suggestions.

## How it works

The 𝕏 algorithm scores every post through a pipeline:

```
Your draft tweet
      |
      v
 Grok-3-mini          Estimates P(like), P(reply), P(retweet), P(share)...
      |                for 19 engagement action types
      v
 Weighted Scorer       Score = sum(weight * P(action)) using the real algorithm weights
      |                Positive weights for engagement, negative for block/mute/report
      v
 Author Diversity      Decay multiplier for repeated authors in a feed
      |
      v
 OON Scorer            Adjusts score for follower vs non-follower audience
      |
      v
 Gemini                Assessment, virality rating 1-10, strengths, weaknesses,
                       suggestions, and a revised tweet
```

## Quick start

```bash
cd analyzer
npm install
cp .env.example .env   # fill in your API keys
npm run dev             # web UI at http://localhost:3577
```

### API keys needed

| Key | Where to get it |
|---|---|
| `XAI_API_KEY` | [console.x.ai](https://console.x.ai/) |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `X_BEARER_TOKEN` (optional) | [developer.x.com](https://developer.x.com/) — enables profile display and tweet lookup |

Costs less than $0.01 per run. See [`analyzer/README.md`](analyzer/README.md) for full setup, CLI usage, and architecture.

## What's in the repo

```
analyzer/           The post analyzer tool (TypeScript) — web UI + CLI
phoenix/            Original 𝕏 ML models (Python/JAX) — ranking & retrieval
home-mixer/         Feed orchestration layer (Rust) — pipeline assembly
thunder/            In-memory post store (Rust) — in-network content
candidate-pipeline/ Scoring framework (Rust) — source/hydrate/filter/score/select
```

The `phoenix/`, `home-mixer/`, `thunder/`, and `candidate-pipeline/` directories are from the [original 𝕏 algorithm release](https://github.com/xai-org/x-algorithm) and document how the real system works. The `analyzer/` directory is the tool that lets you run that pipeline locally.
