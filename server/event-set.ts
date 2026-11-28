/**
 * The prompts every hosted (live) room plays, in this order. Edit this list to
 * change the event. Fewer rounds = the first N; extra rounds or swaps draw at
 * random from the rest of the bank. `npm test` checks every id exists.
 */
export const EVENT_PROMPT_IDS: readonly string[] = [
  "fire-stories",
  "el-names",
  "iah-names",
  "luke-names",
  "women-of-genesis",
  "foreign-rulers",
  "pauls-companions",
  "trees-and-plants",
  "in-prison",
  "dreamers",
  "israels-enemies",
  "instruments",
];
