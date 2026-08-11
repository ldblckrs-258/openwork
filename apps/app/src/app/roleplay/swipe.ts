import type { RoleplayAlternative, RoleplayTurnRecord } from "@openwork/types/roleplay";

/**
 * Regenerating a reply, decided outside React and outside the network.
 *
 * Every rule here comes from `reports/swipe-semantics-spike.md`, run against the
 * real engine. Three findings shape it:
 *
 *   1. Reverting at an assistant reply moves the cursor to the **preceding user
 *      message**, not to the reply. There is no way to discard only a reply.
 *   2. Re-prompting with `parts: []` is accepted, but creates an empty user
 *      message — the user's own words are lost. The original parts must be
 *      re-sent, which is why `userText` is stored on the turn.
 *   3. The reverted tail is destroyed the moment the next prompt is dispatched,
 *      **including when that prompt fails**, and the cursor is cleared with it.
 *      So `unrevert()` cannot roll a swipe back, and an alternative that was not
 *      copied before the revert no longer exists anywhere.
 */

export type SwipePlan = {
  /** Message id to revert at — the reply being replaced. */
  revertMessageId: string;
  /** Re-sent verbatim; `parts: []` would blank the user's message. */
  userText: string;
  /** The turn as it must be persisted *before* the revert, with the current reply captured. */
  turn: RoleplayTurnRecord;
};

export type SwipeInput = {
  turn: RoleplayTurnRecord;
  /** The reply currently on screen, which the engine is about to destroy. */
  currentReply: { text: string; messageId: string };
  now: number;
};

function alreadyCaptured(alternatives: RoleplayAlternative[], messageId: string): boolean {
  return alternatives.some((alternative) => alternative.messageId === messageId);
}

/**
 * Build the plan for regenerating a turn.
 *
 * The captured alternative is part of the plan rather than a side effect,
 * because the capture has to be persisted before the revert is issued — after it,
 * there is nothing left to capture.
 */
export function planSwipe(input: SwipeInput): SwipePlan {
  const captured = alreadyCaptured(input.turn.alternatives, input.currentReply.messageId)
    ? input.turn.alternatives
    : [
        ...input.turn.alternatives,
        { text: input.currentReply.text, messageId: input.currentReply.messageId, createdAt: input.now },
      ];

  return {
    revertMessageId: input.currentReply.messageId,
    userText: input.turn.userText,
    turn: {
      ...input.turn,
      alternatives: captured,
      // The new reply has not arrived yet; point past the captured ones so the
      // transcript shows the live reply rather than an archived one.
      activeAlternative: captured.length,
    },
  };
}

/**
 * Fold a completed regenerate back into the turn.
 *
 * The engine minted new ids for both the user message and the reply, so the
 * turn's `messageId` has to move with them or the next swipe would revert at a
 * message that no longer exists.
 */
export function applySwipeResult(
  turn: RoleplayTurnRecord,
  result: { userMessageId: string; replyText: string; replyMessageId: string; now: number },
): RoleplayTurnRecord {
  const alternatives = alreadyCaptured(turn.alternatives, result.replyMessageId)
    ? turn.alternatives
    : [...turn.alternatives, { text: result.replyText, messageId: result.replyMessageId, createdAt: result.now }];
  return {
    ...turn,
    messageId: result.userMessageId,
    alternatives,
    activeAlternative: alternatives.length - 1,
  };
}

export type SwipeFailureRepair = {
  /**
   * The engine destroyed the reply before failing, so the session is left with a
   * user message and nothing answering it. The transcript has to show something.
   */
  restoredReply: RoleplayAlternative | undefined;
  danglingUserMessage: boolean;
};

/**
 * Decide what to show after a regenerate that failed.
 *
 * `unrevert()` is deliberately not part of this. The spike proved the cursor is
 * already null and the messages already gone by the time the failure surfaces,
 * so unreverting restores nothing — and if the user had their own manual revert
 * cursor set, unreverting would clear that instead.
 */
export function repairAfterFailedSwipe(turn: RoleplayTurnRecord): SwipeFailureRepair {
  const restoredReply = turn.alternatives[turn.alternatives.length - 1];
  return { restoredReply, danglingUserMessage: restoredReply === undefined };
}

/** Clamp navigation to the alternatives that exist. */
export function selectAlternative(turn: RoleplayTurnRecord, offset: number): RoleplayTurnRecord {
  if (turn.alternatives.length === 0) return turn;
  const next = Math.min(Math.max(turn.activeAlternative + offset, 0), turn.alternatives.length - 1);
  return next === turn.activeAlternative ? turn : { ...turn, activeAlternative: next };
}

export function activeAlternativeText(turn: RoleplayTurnRecord): string | undefined {
  return turn.alternatives[turn.activeAlternative]?.text;
}

export function createTurnId(now: number, suffix: string): string {
  return `turn_${now.toString(36)}_${suffix}`;
}
