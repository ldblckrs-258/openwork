import { describe, expect, test } from "bun:test";
import {
  findRegenerateSource,
  type RegenerateCandidate,
} from "../src/react-app/domains/session/surface/regenerate-target";

function user(id: string, text: string): RegenerateCandidate {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text = "A reply."): RegenerateCandidate {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

describe("finding what a regenerate replays", () => {
  test("the nearest preceding user message is the revert boundary", () => {
    const messages = [user("u1", "First"), assistant("a1"), user("u2", "Second"), assistant("a2")];

    expect(findRegenerateSource(messages, "a2")).toEqual({ userMessageId: "u2", text: "Second" });
  });

  test("regenerating an earlier reply targets its own turn, not the latest", () => {
    // The revert boundary decides which turns are destroyed. Taking the newest
    // user message here would delete the wrong half of the conversation.
    const messages = [user("u1", "First"), assistant("a1"), user("u2", "Second"), assistant("a2")];

    expect(findRegenerateSource(messages, "a1")).toEqual({ userMessageId: "u1", text: "First" });
  });

  test("tool and reasoning parts between the two are skipped", () => {
    const messages: RegenerateCandidate[] = [
      user("u1", "Do it"),
      { id: "t1", role: "assistant", parts: [{ type: "tool-bash" }] },
      assistant("a1"),
    ];

    expect(findRegenerateSource(messages, "a1")?.userMessageId).toBe("u1");
  });

  test("a multi-part user message resends every text part", () => {
    const messages: RegenerateCandidate[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "One" }, { type: "file" }, { type: "text", text: "Two" }] },
      assistant("a1"),
    ];

    expect(findRegenerateSource(messages, "a1")?.text).toBe("One\n\nTwo");
  });
});

describe("when there is nothing to replay", () => {
  test("a reply with no user message before it yields null", () => {
    // A roleplay greeting is rendered by the client and is the transcript's
    // first entry, so the scene can open with no user turn at all.
    expect(findRegenerateSource([assistant("greeting")], "greeting")).toBeNull();
  });

  test("an attachment-only user turn yields null rather than an empty send", () => {
    // Reverting and then sending nothing would destroy the reply and leave the
    // conversation with a hole where the turn was.
    const messages: RegenerateCandidate[] = [
      { id: "u1", role: "user", parts: [{ type: "file" }] },
      assistant("a1"),
    ];

    expect(findRegenerateSource(messages, "a1")).toBeNull();
  });

  test("an unknown message id yields null", () => {
    expect(findRegenerateSource([user("u1", "First"), assistant("a1")], "nope")).toBeNull();
  });
});
