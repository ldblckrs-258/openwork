/**
 * When a roleplay conversation should be compacted, decided without a tokenizer.
 *
 * There is no shared tokenizer across the 50+ providers this app can talk to, so
 * this estimates. Estimation error is asymmetric: compacting a little early
 * costs a summarisation call, while overflowing mid-scene truncates the
 * conversation the character's continuity depends on. The thresholds are set to
 * fire early on purpose.
 */

/**
 * Characters per token, deliberately low.
 *
 * English prose runs about 4. Roleplay transcripts carry more punctuation,
 * asterisks, and quotation marks than prose, and every one of those tends to be
 * its own token, so a 4:1 assumption under-counts exactly the text this feature
 * produces.
 */
export const CHARS_PER_TOKEN = 3.2;

/** Fraction of the model's window at which compaction fires. */
export const COMPACT_THRESHOLD_RATIO = 0.7;

/** Used when the model's context window is unknown. */
export const DEFAULT_CONTEXT_TOKENS = 128_000;

/** Never compact a conversation this short; the summary would cost more than it saves. */
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
  /** Every rendered message's text, plus the compiled system string. */
  transcriptChars: number;
  systemChars: number;
  turnCount: number;
  contextTokens?: number | undefined;
  /**
   * A revert is mid-flight for this session.
   *
   * Compaction and the abort/revert/prompt chain are independent calls against
   * the same session with nothing serialising them, so a compaction that fires
   * during a swipe races the revert. Refusing here is the serialisation.
   */
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

/**
 * Guidance for the "story so far", shown in its editor.
 *
 * The engine's `summarize` call accepts only a provider and a model — there is
 * no prompt parameter, verified against the SDK — so a roleplay-specific
 * summarisation instruction cannot reach it. Its summary is therefore generic,
 * and generic summarisation flattens exactly what a roleplay conversation is
 * made of: tone, voice, and unresolved beats come back as "they talked", and the
 * character returns subtly different.
 *
 * So the roleplay-specific continuity is authored rather than generated. It is
 * compiled into `system` on every turn, which means it survives compaction no
 * matter what the engine's summary chose to keep.
 */
export const STORY_SO_FAR_GUIDANCE =
  "Where the characters are and what just happened. What each one wants, fears, or believes about the other. " +
  "Any promise, threat, secret, or question still unresolved. Written in the present tense.";
