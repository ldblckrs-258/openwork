import { describe, expect, test } from "vitest";
import type {
  RoleplaySceneState,
  RoleplayTurnRecord,
  SceneRecord,
} from "../../../packages/types/src/roleplay.ts";
import { planSceneRewind, type RewindMessage } from "../../../apps/app/src/app/roleplay/revert-scene.ts";

const NOW = 1_700_000_000;

function record(overrides: Partial<SceneRecord> = {}): SceneRecord {
  return { id: "sr_1", type: "clothes", name: "silk blouse", state: "worn", description: "", ...overrides };
}

function scene(records: SceneRecord[], revision = 0): RoleplaySceneState {
  return { records, revision, updatedAt: NOW };
}

function turn(overrides: Partial<RoleplayTurnRecord> = {}): RoleplayTurnRecord {
  return {
    turnId: "turn_1",
    sessionId: "ses_1",
    messageId: "msg_user_1",
    userText: '"Well?"',
    blocks: [],
    alternatives: [],
    activeAlternative: 0,
    createdAt: 1,
    ...overrides,
  };
}

const TRANSCRIPT: RewindMessage[] = [
  { id: "msg_user_1", role: "user" },
  { id: "msg_reply_1", role: "assistant" },
  { id: "msg_user_2", role: "user" },
  { id: "msg_reply_2", role: "assistant" },
  { id: "msg_user_3", role: "user" },
  { id: "msg_reply_3", role: "assistant" },
];

const TURNS = [
  turn({ turnId: "turn_1", messageId: "msg_user_1", createdAt: 1, sceneStateBefore: scene([]) }),
  turn({
    turnId: "turn_2",
    messageId: "msg_user_2",
    createdAt: 2,
    sceneStateBefore: scene([record({ state: "worn" })], 1),
  }),
  turn({
    turnId: "turn_3",
    messageId: "msg_user_3",
    createdAt: 3,
    sceneStateBefore: scene([record({ state: "unbuttoned" })], 2),
  }),
];

describe("a revert takes the scene back with the messages", () => {
  test("reverting at a reply rewinds past the turn that produced it", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_reply_3",
      turns: TURNS,
    });

    expect(rewind.restore?.records[0]?.state).toBe("unbuttoned");
    expect(rewind.discardedTurnIds).toEqual(["turn_3"]);
  });

  test("reverting at a user message rewinds past that same turn", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_user_3",
      turns: TURNS,
    });

    expect(rewind.restore?.records[0]?.state).toBe("unbuttoned");
    expect(rewind.discardedTurnIds).toEqual(["turn_3"]);
  });

  test("cutting several turns rewinds past the earliest of them, not the last", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_reply_2",
      turns: TURNS,
    });

    expect(rewind.restore?.records[0]?.state).toBe("worn");
    expect(rewind.discardedTurnIds).toEqual(["turn_2", "turn_3"]);
  });

  test("reverting the whole conversation rewinds to the scene the first turn opened with", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_user_1",
      turns: TURNS,
    });

    expect(rewind.restore?.records).toEqual([]);
    expect(rewind.discardedTurnIds).toEqual(["turn_1", "turn_2", "turn_3"]);
  });

  test("a greeting has no user message before it, so reverting at it discards everything", () => {
    const rewind = planSceneRewind({
      messages: [{ id: "msg_greeting", role: "assistant" }, ...TRANSCRIPT],
      boundaryMessageId: "msg_greeting",
      turns: TURNS,
    });

    expect(rewind.discardedTurnIds).toEqual(["turn_1", "turn_2", "turn_3"]);
  });
});

describe("what is left alone", () => {
  test("turns before the cut keep their scene and their record", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_user_3",
      turns: TURNS,
    });

    expect(rewind.discardedTurnIds).not.toContain("turn_1");
    expect(rewind.discardedTurnIds).not.toContain("turn_2");
  });

  test("a turn written before scene state existed rewinds nothing", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_user_3",
      turns: [turn({ turnId: "turn_3", messageId: "msg_user_3", createdAt: 3 })],
    });

    expect(rewind.restore).toBeUndefined();
    expect(rewind.discardedTurnIds).toEqual(["turn_3"]);
  });

  test("the earliest discarded turn that has a snapshot wins over an earlier one that does not", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_user_2",
      turns: [
        turn({ turnId: "turn_2", messageId: "msg_user_2", createdAt: 2 }),
        turn({
          turnId: "turn_3",
          messageId: "msg_user_3",
          createdAt: 3,
          sceneStateBefore: scene([record({ state: "unbuttoned" })], 2),
        }),
      ],
    });

    expect(rewind.restore?.records[0]?.state).toBe("unbuttoned");
  });

  test("a boundary the transcript does not contain rewinds nothing", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_from_another_session",
      turns: TURNS,
    });

    expect(rewind.restore).toBeUndefined();
    expect(rewind.discardedTurnIds).toEqual([]);
  });

  test("a turn whose message id the engine re-minted is not assumed discarded", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_user_1",
      turns: [turn({ turnId: "turn_orphan", messageId: "msg_user_gone", sceneStateBefore: scene([]) })],
    });

    expect(rewind.discardedTurnIds).toEqual([]);
    expect(rewind.restore).toBeUndefined();
  });
});

describe("ordering", () => {
  test("the cut is decided by transcript position, not by revision number", () => {
    const rewind = planSceneRewind({
      messages: TRANSCRIPT,
      boundaryMessageId: "msg_user_2",
      turns: [
        turn({
          turnId: "turn_3",
          messageId: "msg_user_3",
          createdAt: 3,
          sceneStateBefore: scene([record({ state: "unbuttoned" })], 9),
        }),
        turn({
          turnId: "turn_2",
          messageId: "msg_user_2",
          createdAt: 2,
          sceneStateBefore: scene([record({ state: "worn" })], 40),
        }),
      ],
    });

    expect(rewind.restore?.records[0]?.state).toBe("worn");
    expect(rewind.discardedTurnIds).toEqual(["turn_2", "turn_3"]);
  });
});
