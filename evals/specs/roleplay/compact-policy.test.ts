import { describe, expect, test } from "vitest";
import {
  COMPACT_THRESHOLD_RATIO,
  DEFAULT_CONTEXT_TOKENS,
  MIN_TURNS_BEFORE_COMPACT,
  decideCompaction,
  estimateTokens,
} from "../../../apps/app/src/app/roleplay/compact-policy.ts";

function input(overrides: Partial<Parameters<typeof decideCompaction>[0]> = {}) {
  return {
    transcriptChars: 0,
    systemChars: 0,
    turnCount: MIN_TURNS_BEFORE_COMPACT,
    contextTokens: 100_000,
    revertInFlight: false,
    ...overrides,
  };
}

describe("threshold", () => {
  test("a conversation under the threshold is left alone", () => {
    const decision = decideCompaction(input({ transcriptChars: 1_000 }));

    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toBe("under_threshold");
  });

  test("crossing the threshold triggers compaction", () => {
    const decision = decideCompaction(input({ transcriptChars: 100_000 * COMPACT_THRESHOLD_RATIO * 4 }));

    expect(decision.shouldCompact).toBe(true);
    expect(decision.reason).toBe("over_threshold");
  });

  test("the system string counts toward the estimate", () => {
    const withoutSystem = decideCompaction(input({ transcriptChars: 200_000 }));
    const withSystem = decideCompaction(input({ transcriptChars: 200_000, systemChars: 100_000 }));

    expect(withSystem.estimatedTokens).toBeGreaterThan(withoutSystem.estimatedTokens);
  });

  test("a short conversation is never compacted, however long its messages", () => {
    const decision = decideCompaction(input({ transcriptChars: 10_000_000, turnCount: MIN_TURNS_BEFORE_COMPACT - 1 }));

    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toBe("too_few_turns");
  });

  test("an unknown context window falls back to a default rather than never firing", () => {
    const decision = decideCompaction(input({ transcriptChars: 10_000_000, contextTokens: undefined }));

    expect(decision.thresholdTokens).toBe(Math.floor(DEFAULT_CONTEXT_TOKENS * COMPACT_THRESHOLD_RATIO));
    expect(decision.shouldCompact).toBe(true);
  });
});

describe("serialisation against reverts", () => {
  test("compaction refuses while a revert is in flight, even well over the threshold", () => {
    const decision = decideCompaction(input({ transcriptChars: 10_000_000, revertInFlight: true }));

    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toBe("revert_in_flight");
  });

  test("the revert guard outranks every other reason", () => {
    const decision = decideCompaction(input({ turnCount: 0, transcriptChars: 0, revertInFlight: true }));

    expect(decision.reason).toBe("revert_in_flight");
  });
});

describe("estimation", () => {
  test("tokens are estimated conservatively, not at prose density", () => {
    const text = "x".repeat(3_200);
    const proseAssumption = text.length / 4;

    expect(estimateTokens(text)).toBeGreaterThan(proseAssumption);
    expect(estimateTokens("")).toBe(0);
  });
});
