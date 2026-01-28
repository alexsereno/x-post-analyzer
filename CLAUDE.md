# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

The X "For You" feed recommendation algorithm. It retrieves, ranks, and filters posts using a Grok-based transformer model (ported from xAI's Grok-1 open source release). The system predicts engagement probabilities for 18+ action types and combines them into a weighted score.

## Build & Run Commands

### Phoenix (Python/JAX ML models)

Requires Python >= 3.11 and [uv](https://docs.astral.sh/uv/getting-started/installation/).

```shell
# Run ranking model inference
cd phoenix && uv run run_ranker.py

# Run retrieval model inference
cd phoenix && uv run run_retrieval.py

# Run all tests
cd phoenix && uv run pytest test_recsys_model.py test_recsys_retrieval_model.py

# Run a single test
cd phoenix && uv run pytest test_recsys_model.py -k "test_name"

# Lint
cd phoenix && uv run ruff check .
```

### Analyzer (TypeScript)

```shell
cd analyzer

# Start web UI
npm run dev

# CLI usage
npm start -- --text "your tweet here" --scores-only

# Type check
npm run typecheck

# Lint
npm run lint

# Format
npm run format

# Run all checks (typecheck + lint + format)
npm run check
```

After major changes, always run `npm run check` in the analyzer directory to catch type errors, lint issues, and formatting problems.

### Rust Components (home-mixer, thunder, candidate-pipeline)

The Rust code references internal crates (`xai_candidate_pipeline`, `xai_recsys_proto`, `xai_stats_macro`) that are not included in this open-source release. The `home-mixer/lib.rs` notes that `params`, `clients`, and `util` modules are excluded. The Rust components are readable for understanding the architecture but not directly buildable.

## Architecture

### Two-Stage Pipeline

1. **Retrieval** - Narrow millions of posts to ~1000 candidates
2. **Ranking** - Score candidates with a transformer, select top K

### Components

- **analyzer/** (TypeScript) - Post analyzer tool. Web UI and CLI that scores draft tweets through the same 4-stage pipeline. Uses Grok-3-mini for engagement estimation, then runs weighted scoring, author diversity, and OON adjustment with the real algorithm weights. Gemini provides qualitative analysis.
- **home-mixer/** (Rust) - Orchestration layer. gRPC server that assembles the pipeline using the candidate-pipeline framework. Runs query hydration → candidate sourcing → hydration → filtering → scoring → selection → post-selection.
- **phoenix/** (Python/JAX) - Two ML models:
  - *Retrieval*: Two-tower model (user tower + candidate tower) with dot-product similarity for ANN search
  - *Ranking*: Transformer with candidate isolation attention mask - candidates cannot attend to each other, only to user context and history
- **thunder/** (Rust) - In-memory post store with Kafka ingestion. Sub-millisecond lookups for in-network posts (from followed accounts). Maintains per-user stores with retention-based pruning.
- **candidate-pipeline/** (Rust) - Reusable trait-based framework defining `Source`, `Hydrator`, `Filter`, `Scorer`, `Selector`, `SideEffect`.

### Scoring Pipeline

The scoring chain runs sequentially:

1. **PhoenixScorer** - Calls transformer model, gets probabilities for each action type (favorite, reply, repost, click, etc.) as `PhoenixScores`
2. **WeightedScorer** - `Score = Σ(weight_i × P(action_i))` with positive weights for engagement actions and negative weights for block/mute/report. VQV (video quality view) weight is conditional on video duration exceeding `MIN_VIDEO_DURATION_MS`. Score is then normalized and offset.
3. **AuthorDiversityScorer** - Attenuates repeated author scores: `adjusted = score × (decay^position + floor)`
4. **OONScorer** - Adjusts out-of-network content scores

### Key Scoring Weights (in home-mixer params)

Engagement actions with positive weights: favorite, reply, retweet, photo_expand, click, profile_click, vqv, share, share_via_dm, share_via_copy_link, dwell, quote, quoted_click, dwell_time, follow_author

Negative-signal actions with negative weights: not_interested, block_author, mute_author, report

### Attention Mask (Candidate Isolation)

The ranking transformer uses a special attention mask: user context and history have full bidirectional attention, candidates can attend to user/history but NOT to each other (only self-attend). This makes scores independent of batch composition and cacheable.

### Embedding Strategy

Hash-based embeddings throughout (2 hash functions each for users, posts, authors). No hand-engineered features - the transformer learns directly from engagement sequences.

### Phoenix Model Details

- Framework: JAX + dm-haiku
- Ranking output shape: `[batch, num_candidates, num_actions]` (logits)
- Retrieval output: normalized user and candidate embeddings for dot-product similarity
- Input positions: 1 (user) + S (history) + C (candidates)
