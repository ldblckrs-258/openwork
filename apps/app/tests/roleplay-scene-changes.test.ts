import { describe, expect, test } from "bun:test";

import { ROLEPLAY_STATE_TOOL } from "@openwork/types/roleplay";
import { sceneChangesByMessage, type SceneChangeMessage } from "../src/app/roleplay/scene-changes";
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "../src/app/types";

function toolPart(applied: { id: string; type: string; name: string; state: string }[], requested: string[] = []) {
  return {
    type: "dynamic-tool",
    toolName: ROLEPLAY_STATE_TOOL,
    input: { upsert: requested.map((id) => ({ id })) },
    output: JSON.stringify({ ok: true, applied, rejected: [], revision: 1, noop: false }),
  };
}

const blouse = { id: "sr_2", type: "clothes", name: "silk robe", state: "removed" };

const user: SceneChangeMessage = { id: "msg_user", role: "user", parts: [{ type: "text" }] };

describe("scene changes land on the reply the rail is drawn under", () => {
  test("a call in its own message carries forward to the reply that follows it", () => {
    // OpenCode ends the step that made the call, so the tool and the prose it
    // preceded arrive as two assistant messages. The rail is drawn under the
    // last of them, so that is the message the changes have to be keyed to.
    const messages: SceneChangeMessage[] = [
      user,
      { id: "msg_tool", role: "assistant", parts: [{ type: "step-start" }, { type: "reasoning" }, toolPart([blouse], ["sr_2"])] },
      { id: "msg_reply", role: "assistant", parts: [{ type: "step-start" }, { type: "reasoning" }, { type: "text" }] },
    ];

    const changes = sceneChangesByMessage(messages, ROLEPLAY_STATE_TOOL);

    expect([...changes.keys()]).toEqual(["msg_reply"]);
    expect(changes.get("msg_reply")).toEqual([{ ...blouse, kind: "changed" }]);
  });

  test("a call and its reply in one message key to that message", () => {
    const messages: SceneChangeMessage[] = [
      user,
      { id: "msg_turn", role: "assistant", parts: [toolPart([blouse], ["sr_2"]), { type: "text" }] },
    ];

    expect([...sceneChangesByMessage(messages, ROLEPLAY_STATE_TOOL).keys()]).toEqual(["msg_turn"]);
  });

  test("the next turn starts over rather than repeating the last one's changes", () => {
    const messages: SceneChangeMessage[] = [
      user,
      { id: "msg_reply_1", role: "assistant", parts: [toolPart([blouse], ["sr_2"]), { type: "text" }] },
      { id: "msg_user_2", role: "user", parts: [{ type: "text" }] },
      { id: "msg_reply_2", role: "assistant", parts: [{ type: "text" }] },
    ];

    const changes = sceneChangesByMessage(messages, ROLEPLAY_STATE_TOOL);

    expect([...changes.keys()]).toEqual(["msg_reply_1"]);
  });

  test("a turn that never wrote prose records nothing", () => {
    // Nothing renders for that turn, so a rail keyed to it would be attached to
    // a message the transcript does not show.
    const messages: SceneChangeMessage[] = [
      user,
      { id: "msg_tool", role: "assistant", parts: [{ type: "step-start" }, toolPart([blouse], ["sr_2"])] },
    ];

    expect(sceneChangesByMessage(messages, ROLEPLAY_STATE_TOOL).size).toBe(0);
  });

  test("a failed turn keys to its reply, not to the error bubble under it", () => {
    const messages: SceneChangeMessage[] = [
      user,
      { id: "msg_reply", role: "assistant", parts: [toolPart([blouse], ["sr_2"]), { type: "text" }] },
      {
        id: `${SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX}msg_reply`,
        role: "assistant",
        parts: [{ type: "text" }],
      },
    ];

    expect([...sceneChangesByMessage(messages, ROLEPLAY_STATE_TOOL).keys()]).toEqual(["msg_reply"]);
  });

  test("the last state a record reached wins over the earlier ones in the same turn", () => {
    const messages: SceneChangeMessage[] = [
      user,
      { id: "msg_tool_1", role: "assistant", parts: [{ type: "reasoning" }, toolPart([{ ...blouse, state: "loosened" }], ["sr_2"])] },
      { id: "msg_tool_2", role: "assistant", parts: [{ type: "reasoning" }, toolPart([blouse], ["sr_2"])] },
      { id: "msg_reply", role: "assistant", parts: [{ type: "text" }] },
    ];

    expect(sceneChangesByMessage(messages, ROLEPLAY_STATE_TOOL).get("msg_reply")).toEqual([
      { ...blouse, kind: "changed" },
    ]);
  });
});
