// lib/prompts/index.js
// Day-prompt selector. Pure function. No I/O.

import { DAY1_SYSTEM_PROMPT } from "./day1.js";
import { DAY2_SYSTEM_PROMPT } from "./day2.js";
import { DAY3_SYSTEM_PROMPT } from "./day3.js";

const PROMPTS = {
  1: DAY1_SYSTEM_PROMPT,
  2: DAY2_SYSTEM_PROMPT,
  3: DAY3_SYSTEM_PROMPT,
};

export function getSystemPromptForDay(dayNumber) {
  const day = Number(dayNumber);
  if (![1, 2, 3].includes(day)) {
    throw new Error(`Invalid day number: ${dayNumber}. Must be 1, 2, or 3.`);
  }
  return PROMPTS[day];
}

// Version hash for observability. see proposals/data-model.md for why we track this.
// Bump this string when prompts change so historical messages can be correlated.
export const PROMPT_VERSION = "v3.0-tfif-decision-alignment-multilang";
