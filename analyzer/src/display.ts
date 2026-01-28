/**
 * Terminal output formatting with ANSI colours.
 */

import type { ScoredResult, GeminiAnalysis, TweetInput } from "./types.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

function bar(value: number, maxWidth: number = 30): string {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = Math.round(clamped * maxWidth);
  return GREEN + "\u2588".repeat(filled) + DIM + "\u2591".repeat(maxWidth - filled) + RESET;
}

function scoreColor(score: number): string {
  if (score >= 3) return GREEN;
  if (score >= 1) return YELLOW;
  return RED;
}

function ratingBar(rating: number): string {
  const filled = "\u2588".repeat(rating);
  const empty = "\u2591".repeat(10 - rating);
  const color = rating >= 7 ? GREEN : rating >= 4 ? YELLOW : RED;
  return color + filled + DIM + empty + RESET;
}

export function displayHeader(input: TweetInput): void {
  console.log("");
  console.log(`${BOLD}${CYAN}Tweet Virality Analyzer${RESET}`);
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
  console.log(`${WHITE}Tweet:${RESET} "${input.text}"`);
  if (input.media && input.media !== "none") {
    console.log(`${WHITE}Media:${RESET} ${input.media}`);
  }
  if (input.followers !== undefined) {
    console.log(`${WHITE}Followers:${RESET} ${input.followers.toLocaleString()}`);
  }
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
}

export function displayScores(result: ScoredResult): void {
  console.log("");
  console.log(`${BOLD}${BLUE}Engagement Probabilities${RESET}`);
  console.log("");

  const positiveActions = result.weightBreakdown.filter((e) => e.weight >= 0);
  const negativeActions = result.weightBreakdown.filter((e) => e.weight < 0);

  for (const entry of positiveActions) {
    const pStr = entry.probability.toFixed(4).padStart(7);
    const label = entry.action.padEnd(18);
    console.log(
      `  ${WHITE}${label}${RESET} ${pStr}  ${bar(entry.probability)} ${DIM}(+${entry.contribution.toFixed(4)})${RESET}`
    );
  }

  console.log("");
  console.log(`  ${BOLD}${RED}Negative Signals${RESET}`);
  for (const entry of negativeActions) {
    const pStr = entry.probability.toFixed(4).padStart(7);
    const label = entry.action.padEnd(18);
    console.log(
      `  ${RED}${label}${RESET} ${pStr}  ${bar(entry.probability)} ${DIM}(${entry.contribution.toFixed(4)})${RESET}`
    );
  }

  console.log("");
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
  console.log(`${BOLD}${MAGENTA}Score Pipeline${RESET}`);
  console.log("");

  const sc = scoreColor(result.finalScore);
  console.log(`  ${WHITE}Raw weighted score:${RESET}        ${result.rawWeightedScore.toFixed(4)}`);
  console.log(`  ${WHITE}After offset:${RESET}              ${result.offsetScore.toFixed(4)}`);
  console.log(
    `  ${WHITE}Author diversity (x${result.diversityMultiplier.toFixed(2)}):${RESET}  ${result.diversityAdjustedScore.toFixed(4)}`
  );
  console.log(
    `  ${WHITE}OON adjustment (x${result.oonMultiplier.toFixed(2)}):${RESET}    ${result.finalScore.toFixed(4)}`
  );
  console.log("");
  console.log(`  ${BOLD}Final Score: ${sc}${result.finalScore.toFixed(4)}${RESET}`);
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
}

export function displayAnalysis(analysis: GeminiAnalysis): void {
  console.log("");
  console.log(`${BOLD}${CYAN}Gemini Analysis${RESET}`);
  console.log("");

  console.log(
    `  ${WHITE}Virality Rating:${RESET} ${ratingBar(analysis.viralityRating)} ${BOLD}${analysis.viralityRating}/10${RESET}`
  );
  console.log("");
  console.log(`  ${WHITE}${analysis.assessment}${RESET}`);
  console.log("");

  console.log(`  ${BOLD}${GREEN}Strengths${RESET}`);
  for (const s of analysis.strengths) {
    console.log(`    ${GREEN}+${RESET} ${s}`);
  }
  console.log("");

  console.log(`  ${BOLD}${RED}Weaknesses${RESET}`);
  for (const w of analysis.weaknesses) {
    console.log(`    ${RED}-${RESET} ${w}`);
  }
  console.log("");

  console.log(`  ${BOLD}${YELLOW}Suggestions${RESET}`);
  for (const s of analysis.suggestions) {
    console.log(`    ${YELLOW}*${RESET} ${s}`);
  }
  console.log("");

  console.log(`  ${BOLD}${MAGENTA}Revised Tweet${RESET}`);
  console.log(`    "${analysis.revisedTweet}"`);
  console.log("");
}

export function displayError(message: string): void {
  console.error(`\n${RED}${BOLD}Error:${RESET} ${message}\n`);
}
