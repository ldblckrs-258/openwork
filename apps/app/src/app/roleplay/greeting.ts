import type { CharacterCardV2, RoleplayMemoryRecord, RoleplayPersona } from "@openwork/types/roleplay";

import { compilePrompt } from "./compile-prompt.js";
import type { GenerationRequest } from "./generation/prompts.js";
import greetingPrompt from "./generation/greeting.md?raw";
import { selectMemories } from "./memory.js";
import { roleplayPromptOptions } from "./prompt-options.js";

/**
 * Opening a session with a line the character writes now, instead of the one
 * their author wrote before they had met anyone.
 *
 * The card's `first_mes` greets a stranger. Once a character carries memories,
 * that is the wrong scene to open: it re-introduces people who already know each
 * other, and every session starts by contradicting its own history. This
 * generates the opening the character would actually give.
 *
 * The generated line is stored on the session binding, not on the card. It
 * belongs to one conversation — a second session gets its own — and writing it
 * back to the card would overwrite the author's work with one session's opening.
 */

export { greetingPrompt };

/**
 * A greeting is a scene opener, not a chapter. The cap is a backstop against a
 * model that answers with an essay, which would push the real conversation off
 * the first screen.
 */
export const MAX_GREETING_CHARS = 1_200;

/** Which opening a new session starts from. */
export type RoleplayOpening =
  | { kind: "card" }
  | { kind: "alternate"; text: string }
  | { kind: "generate" };

export type ParsedGreeting = { ok: true; text: string } | { ok: false; error: string };

function contextBlock(input: {
  card: CharacterCardV2;
  persona: RoleplayPersona;
  charName?: string;
  memories: RoleplayMemoryRecord[];
  storySoFar?: string;
}): string {
  // The same compiler a turn uses, so the model sees the character exactly as it
  // will during play — including the memory budget. A second, looser assembly
  // here would generate an opening from context the character never actually has.
  const compiled = compilePrompt(input.card, input.persona, {
    ...(input.charName ? { charName: input.charName } : {}),
    memories: selectMemories(input.memories).injections,
  });

  const story = (input.storySoFar ?? "").trim();
  const previous = input.card.data.first_mes.trim();

  return [
    compiled,
    story ? `# Where things stand\n\n${story}` : "",
    previous ? `# The character's default opening, for tone only\n\n${previous}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildGreetingRequest(input: {
  card: CharacterCardV2;
  persona: RoleplayPersona;
  charName?: string;
  memories: RoleplayMemoryRecord[];
  storySoFar?: string;
}): GenerationRequest {
  return { ...roleplayPromptOptions(greetingPrompt), text: contextBlock(input) };
}

const FENCE = /^```[a-z]*\n([\s\S]*?)\n?```$/i;
const LEADING_LABEL = /^(greeting|opening(?: line)?|first message)\s*:\s*/i;

/**
 * Read a greeting out of a model reply.
 *
 * Deliberately lenient in one direction only. A model that wraps prose in a code
 * fence or prefixes it with "Greeting:" has still written a usable line, and
 * failing on that would send the user back to a button for a fix the app can
 * make itself. A model that returns nothing usable fails loudly instead of
 * opening the scene with an empty message.
 */
export function parseGeneratedGreeting(raw: string): ParsedGreeting {
  const fenced = FENCE.exec(raw.trim());
  const body = (fenced?.[1] ?? raw)
    .trim()
    .replace(LEADING_LABEL, "")
    // A model that pads with blank lines would otherwise open the scene with a
    // gap the user reads as a rendering bug.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!body) return { ok: false, error: "The model returned an empty opening." };
  return { ok: true, text: body.slice(0, MAX_GREETING_CHARS) };
}

/** The line a session opens with: its own, or the card's when it has none. */
export function sessionGreeting(bindingGreeting: string, card: CharacterCardV2): string {
  return bindingGreeting.trim() || card.data.first_mes;
}
