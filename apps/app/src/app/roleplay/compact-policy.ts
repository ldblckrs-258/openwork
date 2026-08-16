export const CHARS_PER_TOKEN = 3.2;

export const COMPACT_THRESHOLD_RATIO = 0.7;

export const DEFAULT_CONTEXT_TOKENS = 128_000;

export const MIN_TURNS_BEFORE_COMPACT = 8;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export type CompactDecision = {
  shouldCompact: boolean;
  estimatedTokens: number;
  thresholdTokens: number;
  reason: "under_threshold" | "too_few_turns" | "revert_in_flight" | "over_threshold";
};

export type CompactInput = {
  transcriptChars: number;
  systemChars: number;
  turnCount: number;
  contextTokens?: number | undefined;
  revertInFlight: boolean;
};

export function decideCompaction(input: CompactInput): CompactDecision {
  const contextTokens = input.contextTokens && input.contextTokens > 0 ? input.contextTokens : DEFAULT_CONTEXT_TOKENS;
  const thresholdTokens = Math.floor(contextTokens * COMPACT_THRESHOLD_RATIO);
  const estimatedTokens = Math.ceil((input.transcriptChars + input.systemChars) / CHARS_PER_TOKEN);

  if (input.revertInFlight) {
    return { shouldCompact: false, estimatedTokens, thresholdTokens, reason: "revert_in_flight" };
  }
  if (input.turnCount < MIN_TURNS_BEFORE_COMPACT) {
    return { shouldCompact: false, estimatedTokens, thresholdTokens, reason: "too_few_turns" };
  }
  if (estimatedTokens < thresholdTokens) {
    return { shouldCompact: false, estimatedTokens, thresholdTokens, reason: "under_threshold" };
  }
  return { shouldCompact: true, estimatedTokens, thresholdTokens, reason: "over_threshold" };
}

export const STORY_SO_FAR_GUIDANCE =
  "Where the characters are and what just happened. What each one wants, fears, or believes about the other. " +
  "Any promise, threat, secret, or question still unresolved. Written in the present tense.";
