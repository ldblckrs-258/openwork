import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import { lastAssistantTurnFailed } from "../src/react-app/domains/session/surface/session-render-state";

function text(value: string): UIMessage["parts"][number] {
  return { type: "text", text: value, state: "done" };
}

function errorPart(title: string): UIMessage["parts"][number] {
  return {
    type: "text",
    text: title,
    state: "done",
    providerMetadata: { opencode: { partId: "p1", sessionError: { title } } },
  };
}

function message(role: "assistant" | "user", parts: UIMessage["parts"]): UIMessage {
  return { id: `msg_${role}`, role, parts };
}

describe("deciding whether the turn that just ended failed", () => {
  test("an engine-reported failure is detected", () => {
    // The send path uses `promptAsync`, which returns in milliseconds with
    // nothing written, so its own `catch` can never see this. The transcript is
    // the only place the failure exists.
    expect(lastAssistantTurnFailed([message("assistant", [errorPart("Provider returned 500")])])).toBe(true);
  });

  test("an ordinary reply is not a failure", () => {
    expect(lastAssistantTurnFailed([message("assistant", [text("She turns from the window.")])])).toBe(false);
  });

  test("a failure earlier in the transcript is not this turn's", () => {
    // Otherwise one bad turn would roll back the scene of every good turn after
    // it, which is worse than the drift this detects.
    expect(
      lastAssistantTurnFailed([
        message("assistant", [errorPart("Provider returned 500")]),
        message("assistant", [text("She turns from the window.")]),
      ]),
    ).toBe(false);
  });

  test("a transcript ending on the user is not a failed turn", () => {
    expect(lastAssistantTurnFailed([message("user", [text("Well?")])])).toBe(false);
  });

  test("an empty transcript is not a failed turn", () => {
    expect(lastAssistantTurnFailed([])).toBe(false);
  });
});
