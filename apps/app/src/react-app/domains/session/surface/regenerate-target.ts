/**
 * Which user message a regenerate replays.
 *
 * Regenerate has no dedicated engine call: it is edit-and-resend without the
 * edit. The reply is removed by reverting the session to the user message that
 * produced it, then sending that same text again — so the whole operation
 * reduces to finding that message.
 *
 * Structural on purpose. It takes the shape a `UIMessage` already has rather
 * than the type, so this stays a pure function testable without the chat stack.
 */
export type RegenerateCandidate = {
  id: string;
  role: string;
  parts: { type: string; text?: string }[];
};

export type RegenerateSource = {
  /** The revert boundary: the reply and everything after it goes. */
  userMessageId: string;
  text: string;
};

function messageText(message: RegenerateCandidate): string {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && part.text !== "")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

/**
 * The user message that produced `assistantMessageId`, or null when there is
 * nothing to replay.
 *
 * Null rather than a throw for every "cannot": a greeting-only roleplay
 * transcript has no user message at all, and a synthetic client-side message
 * has no server id to revert to. Both are ordinary states of a live session,
 * and the button disables rather than the surface failing.
 */
export function findRegenerateSource(
  messages: RegenerateCandidate[],
  assistantMessageId: string,
): RegenerateSource | null {
  const index = messages.findIndex((message) => message.id === assistantMessageId);
  if (index < 0) return null;

  for (let position = index - 1; position >= 0; position -= 1) {
    const message = messages[position];
    if (!message || message.role !== "user") continue;
    const text = messageText(message);
    // An attachment-only turn carries no text to resend. Reverting to it and
    // sending nothing would delete the reply and leave the scene empty.
    if (!text) return null;
    return { userMessageId: message.id, text };
  }

  return null;
}
