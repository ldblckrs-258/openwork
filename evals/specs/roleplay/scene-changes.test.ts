import { describe, expect, test } from "vitest";
import { ROLEPLAY_STATE_TOOL } from "../../../packages/types/src/roleplay.ts";
import {
  sceneChangesByMessage,
  type SceneChangeMessage,
  type SceneChangePart,
} from "../../../apps/app/src/app/roleplay/scene-changes.ts";

type Applied = { id: string; type: string; name: string; state: string };

function call(input: { upsert: Array<Record<string, unknown>> }, applied: Applied[]): SceneChangePart {
  return {
    type: "dynamic-tool",
    toolName: ROLEPLAY_STATE_TOOL,
    input,
    output: JSON.stringify({ ok: true, applied, rejected: [], revision: 4, noop: applied.length === 0 }),
  };
}

function text(): SceneChangePart {
  return { type: "text" };
}

function assistant(id: string, parts: SceneChangePart[]): SceneChangeMessage {
  return { id, role: "assistant", parts };
}

function user(id: string): SceneChangeMessage {
  return { id, role: "user", parts: [{ type: "text" }] };
}

const changes = (messages: SceneChangeMessage[]) => sceneChangesByMessage(messages, ROLEPLAY_STATE_TOOL);

describe("what a reply changed comes from the call it made", () => {
  test("a record the call moved is reported with the value the server applied", () => {
    const map = changes([
      user("msg_user_1"),
      assistant("msg_reply_1", [
        call({ upsert: [{ id: "sr_1", state: "unbuttoned" }] }, [
          { id: "sr_1", type: "clothes", name: "silk blouse", state: "unbuttoned" },
        ]),
        text(),
      ]),
    ]);

    expect(map.get("msg_reply_1")).toEqual([
      { id: "sr_1", type: "clothes", name: "silk blouse", state: "unbuttoned", kind: "changed" },
    ]);
  });

  test("a record the call created reads as an addition, because its id was minted", () => {
    const map = changes([
      assistant("msg_reply_1", [
        call({ upsert: [{ type: "location", name: "the pier", state: "empty" }] }, [
          { id: "sr_9", type: "location", name: "the pier", state: "empty" },
        ]),
        text(),
      ]),
    ]);

    expect(map.get("msg_reply_1")?.[0]?.kind).toBe("added");
  });

  test("a reply that made no call gets no note", () => {
    expect(changes([assistant("msg_reply_1", [text()])]).size).toBe(0);
  });

  test("every other reply in the conversation is left alone", () => {
    const map = changes([
      user("msg_user_1"),
      assistant("msg_reply_1", [call({ upsert: [{ id: "sr_1", state: "removed" }] }, [
        { id: "sr_1", type: "clothes", name: "coat", state: "removed" },
      ]), text()]),
      user("msg_user_2"),
      assistant("msg_reply_2", [text()]),
      user("msg_user_3"),
      assistant("msg_reply_3", [text()]),
    ]);

    expect([...map.keys()]).toEqual(["msg_reply_1"]);
  });
});

describe("calls the reader never sees still land on the reply they belong to", () => {
  test("a call in its own step is attributed to the reply that follows it", () => {
    const map = changes([
      user("msg_user_1"),
      assistant("msg_tool_only", [{ type: "step-start" }, call({ upsert: [{ id: "sr_1", state: "removed" }] }, [
        { id: "sr_1", type: "clothes", name: "coat", state: "removed" },
      ])]),
      assistant("msg_reply_1", [text()]),
    ]);

    expect(map.has("msg_tool_only")).toBe(false);
    expect(map.get("msg_reply_1")).toHaveLength(1);
  });

  test("a call never crosses into a later turn", () => {
    const map = changes([
      assistant("msg_tool_only", [call({ upsert: [{ id: "sr_1", state: "removed" }] }, [
        { id: "sr_1", type: "clothes", name: "coat", state: "removed" },
      ])]),
      user("msg_user_1"),
      assistant("msg_reply_1", [text()]),
    ]);

    expect(map.size).toBe(0);
  });

  test("one record moved twice in a turn reads as one change to its final value", () => {
    const map = changes([
      assistant("msg_tool_only", [call({ upsert: [{ id: "sr_1", state: "displaced" }] }, [
        { id: "sr_1", type: "clothes", name: "coat", state: "displaced" },
      ])]),
      assistant("msg_reply_1", [
        call({ upsert: [{ id: "sr_1", state: "removed" }] }, [
          { id: "sr_1", type: "clothes", name: "coat", state: "removed" },
        ]),
        text(),
      ]),
    ]);

    expect(map.get("msg_reply_1")).toEqual([
      { id: "sr_1", type: "clothes", name: "coat", state: "removed", kind: "changed" },
    ]);
  });
});

describe("a call that did not do what it asked", () => {
  test("a refused call reports nothing", () => {
    const refused: SceneChangePart = {
      type: "dynamic-tool",
      toolName: ROLEPLAY_STATE_TOOL,
      input: { upsert: [{ id: "sr_1", state: "removed" }] },
      output: JSON.stringify({ ok: false, applied: [], rejected: ["nope"] }),
    };

    expect(changes([assistant("msg_reply_1", [refused, text()])]).size).toBe(0);
  });

  test("a call still streaming reports nothing rather than throwing", () => {
    const pending: SceneChangePart = {
      type: "dynamic-tool",
      toolName: ROLEPLAY_STATE_TOOL,
      input: { upsert: [{ id: "sr_1" }] },
    };

    expect(changes([assistant("msg_reply_1", [pending, text()])]).size).toBe(0);
  });

  test("an unparseable result reports nothing rather than throwing", () => {
    const broken: SceneChangePart = {
      type: "dynamic-tool",
      toolName: ROLEPLAY_STATE_TOOL,
      input: {},
      output: "not json",
    };

    expect(changes([assistant("msg_reply_1", [broken, text()])]).size).toBe(0);
  });

  test("another tool's call is not read as a scene change", () => {
    const other: SceneChangePart = {
      type: "dynamic-tool",
      toolName: "bash",
      input: { upsert: [{ id: "sr_1" }] },
      output: JSON.stringify({ ok: true, applied: [{ id: "sr_1", type: "clothes", name: "x", state: "y" }] }),
    };

    expect(changes([assistant("msg_reply_1", [other, text()])]).size).toBe(0);
  });
});
