import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import { ROLEPLAY_STATE_TOOL } from "@openwork/types/roleplay";
import { hideRoleplaySceneToolParts } from "../src/react-app/domains/session/surface/session-render-state";

function text(value: string): UIMessage["parts"][number] {
  return { type: "text", text: value, state: "done" };
}

function toolPart(toolName: string): UIMessage["parts"][number] {
  return {
    type: "dynamic-tool",
    toolName,
    toolCallId: `call_${toolName}`,
    state: "output-available",
    input: {},
    output: "{}",
  };
}

function assistant(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "assistant", parts };
}

const hide = (messages: UIMessage[]) => hideRoleplaySceneToolParts(messages, ROLEPLAY_STATE_TOOL);

describe("the scene tool never appears in the roleplay transcript", () => {
  test("the call is dropped and the reply around it is untouched", () => {
    const [message] = hide([
      assistant("msg_1", [text("She turns from the window."), toolPart(ROLEPLAY_STATE_TOOL)]),
    ]);

    expect(message?.parts).toEqual([text("She turns from the window.")]);
  });

  test("a reply that was only the call is dropped whole", () => {
    // An assistant bubble with nothing in it reads as the character saying
    // nothing at all, which is worse than the call it replaced.
    expect(hide([assistant("msg_1", [toolPart(ROLEPLAY_STATE_TOOL)])])).toEqual([]);
  });

  test("a step boundary alone is not content either", () => {
    const messages = [assistant("msg_1", [{ type: "step-start" }, toolPart(ROLEPLAY_STATE_TOOL)])];

    expect(hide(messages)).toEqual([]);
  });

  test("every other tool still renders", () => {
    // The filter is scoped to the one tool the roleplay agent is given. A
    // roleplay session that somehow ran anything else must still show it, or the
    // transcript would be lying about what happened.
    const messages = [assistant("msg_1", [toolPart("bash"), text("Done.")])];

    expect(hide(messages)).toEqual(messages);
  });

  test("a transcript with nothing to hide is returned as-is", () => {
    const messages = [assistant("msg_1", [text("Only prose here.")])];

    expect(hide(messages)[0]).toBe(messages[0]!);
  });
});
