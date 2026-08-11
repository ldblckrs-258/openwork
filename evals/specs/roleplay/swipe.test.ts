import { describe, expect, test } from "vitest";
import type { RoleplayTurnRecord } from "../../../packages/types/src/roleplay.ts";
import {
  activeAlternativeText,
  applySwipeResult,
  planSwipe,
  repairAfterFailedSwipe,
  selectAlternative,
} from "../../../apps/app/src/app/roleplay/swipe.ts";
import { compileBlocks } from "../../../apps/app/src/app/roleplay/blocks.ts";
import { buildRoleplayTurn } from "../../../apps/app/src/app/roleplay/turn.ts";
import { characterCardV2Schema } from "../../../packages/types/src/roleplay.ts";

function turn(overrides: Partial<RoleplayTurnRecord> = {}): RoleplayTurnRecord {
  return {
    turnId: "turn_1",
    sessionId: "ses_1",
    messageId: "msg_user_1",
    userText: '"Where is the ledger?"',
    blocks: [{ type: "dialogue", text: "Where is the ledger?" }],
    alternatives: [],
    activeAlternative: 0,
    createdAt: 1,
    ...overrides,
  };
}

describe("planning a regenerate", () => {
  test("the current reply is captured into the plan, before any revert is issued", () => {
    // The engine destroys the reverted reply the moment the next prompt is
    // dispatched, so a reply not copied first is gone from everywhere. Making
    // the capture part of the plan is what forces the ordering on the caller.
    const plan = planSwipe({
      turn: turn(),
      currentReply: { text: "She says nothing.", messageId: "msg_reply_1" },
      now: 50,
    });

    expect(plan.turn.alternatives).toEqual([
      { text: "She says nothing.", messageId: "msg_reply_1", createdAt: 50 },
    ]);
  });

  test("the revert targets the reply, not the user message", () => {
    // The engine normalises this to the preceding user message itself; passing
    // the user message id instead would revert one turn too far.
    const plan = planSwipe({
      turn: turn(),
      currentReply: { text: "Mm.", messageId: "msg_reply_1" },
      now: 50,
    });

    expect(plan.revertMessageId).toBe("msg_reply_1");
  });

  test("the original user text is carried so the re-prompt does not blank the message", () => {
    // `parts: []` is accepted by the engine and produces an empty user message,
    // silently discarding what the user actually wrote.
    const plan = planSwipe({
      turn: turn({ userText: '*leans in*\n"Well?"' }),
      currentReply: { text: "Mm.", messageId: "msg_reply_1" },
      now: 50,
    });

    expect(plan.userText).toBe('*leans in*\n"Well?"');
    expect(plan.userText).not.toBe("");
  });

  test("regenerating twice does not capture the same reply twice", () => {
    const once = planSwipe({ turn: turn(), currentReply: { text: "A", messageId: "msg_a" }, now: 1 });
    const twice = planSwipe({ turn: once.turn, currentReply: { text: "A", messageId: "msg_a" }, now: 2 });

    expect(twice.turn.alternatives).toHaveLength(1);
  });
});

describe("after a regenerate", () => {
  test("the turn follows the engine's new message ids", () => {
    // Both ids change on every regenerate. A turn still pointing at the old user
    // message would revert at a message that no longer exists on the next swipe.
    const next = applySwipeResult(turn({ alternatives: [{ text: "A", messageId: "msg_a", createdAt: 1 }], activeAlternative: 1 }), {
      userMessageId: "msg_user_2",
      replyText: "B",
      replyMessageId: "msg_b",
      now: 9,
    });

    expect(next.messageId).toBe("msg_user_2");
    expect(next.alternatives.map((alternative) => alternative.text)).toEqual(["A", "B"]);
    expect(next.activeAlternative).toBe(1);
  });
});

describe("navigating alternatives", () => {
  test("earlier replies stay reachable", () => {
    const withThree = turn({
      alternatives: [
        { text: "A", messageId: "a", createdAt: 1 },
        { text: "B", messageId: "b", createdAt: 2 },
        { text: "C", messageId: "c", createdAt: 3 },
      ],
      activeAlternative: 2,
    });

    expect(activeAlternativeText(selectAlternative(withThree, -1))).toBe("B");
    expect(activeAlternativeText(selectAlternative(selectAlternative(withThree, -1), -1))).toBe("A");
  });

  test("navigation clamps rather than running off either end", () => {
    const one = turn({ alternatives: [{ text: "A", messageId: "a", createdAt: 1 }], activeAlternative: 0 });

    expect(selectAlternative(one, -1)).toBe(one);
    expect(selectAlternative(one, 1)).toBe(one);
  });

  test("a turn with no captured alternatives cannot be navigated", () => {
    const bare = turn();

    expect(selectAlternative(bare, 1)).toBe(bare);
    expect(activeAlternativeText(bare)).toBeUndefined();
  });
});

describe("a failed regenerate", () => {
  test("the previous reply is restored from the app-side copy", () => {
    // `unrevert()` cannot do this. The engine already destroyed the messages and
    // cleared the cursor before the failure surfaced, so there is nothing on the
    // server left to restore and nothing for a cursor snapshot to point at.
    const repair = repairAfterFailedSwipe(
      turn({ alternatives: [{ text: "She says nothing.", messageId: "msg_a", createdAt: 1 }] }),
    );

    expect(repair.restoredReply?.text).toBe("She says nothing.");
    expect(repair.danglingUserMessage).toBe(false);
  });

  test("with no saved copy the failure is reported rather than hidden", () => {
    const repair = repairAfterFailedSwipe(turn());

    expect(repair.restoredReply).toBeUndefined();
    expect(repair.danglingUserMessage).toBe(true);
  });

  test("the repaired turn points at a reply that exists", () => {
    // `planSwipe` parks the index one past the captured replies so the incoming
    // live reply renders. When it never arrives, leaving the index there shows
    // the raw transcript under a counter claiming an archived reply is on screen.
    const planned = planSwipe({
      turn: turn(),
      currentReply: { text: "She says nothing.", messageId: "msg_a" },
      now: 1,
    }).turn;
    expect(planned.activeAlternative).toBe(planned.alternatives.length);

    const repaired = repairAfterFailedSwipe(planned).turn;

    expect(repaired.activeAlternative).toBe(planned.alternatives.length - 1);
    expect(activeAlternativeText(repaired)).toBe("She says nothing.");
  });

  test("repairing a turn that captured nothing does not produce a negative index", () => {
    expect(repairAfterFailedSwipe(turn()).turn.activeAlternative).toBe(0);
  });

  test("the failure path must read the planned turn, not the one it started from", () => {
    // The capture is already persisted by the time anything can fail. Reporting
    // from the pre-swipe turn tells the user their reply is unrecoverable while
    // a copy of it sits in the store.
    const before = turn();
    const planned = planSwipe({
      turn: before,
      currentReply: { text: "She says nothing.", messageId: "msg_a" },
      now: 1,
    }).turn;

    expect(repairAfterFailedSwipe(before).danglingUserMessage).toBe(true);
    expect(repairAfterFailedSwipe(planned).danglingUserMessage).toBe(false);
  });
});

describe("director replay", () => {
  test("a regenerated turn recomposes the same system string as the original", () => {
    // Director text lives in `system`, never in history, so a regenerate that
    // did not recompose it would silently drop steering the user just gave —
    // which reads as the model disobeying rather than as a bug.
    const card = characterCardV2Schema.parse({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "Aria", description: "The archivist.", first_mes: "You're late." },
    });
    const persona = { name: "Wren", description: "A courier." };
    const blocks = [
      { type: "dialogue" as const, text: "Where is the ledger?" },
      { type: "director" as const, text: "keep her evasive" },
    ];

    const original = buildRoleplayTurn({
      card,
      persona,
      greeting: card.data.first_mes,
      directorText: compileBlocks(blocks).directorText,
      envContext: "<env/>",
    });
    const replayed = buildRoleplayTurn({
      card,
      persona,
      greeting: card.data.first_mes,
      directorText: compileBlocks(planSwipe({ turn: turn({ blocks }), currentReply: { text: "Mm.", messageId: "m" }, now: 1 }).turn.blocks).directorText,
      envContext: "<env/>",
    });

    expect(replayed.prompt.system).toBe(original.prompt.system);
    expect(replayed.prompt.system).toContain("keep her evasive");
  });
});
