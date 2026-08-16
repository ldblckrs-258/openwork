import type {
  CharacterCardV2,
  RoleplayMemoryRecord,
  RoleplayPersona,
} from "@openwork/types/roleplay";

import { compilePrompt } from "./compile-prompt.js";
import greetingPrompt from "./generation/greeting.md?raw";
import type { GenerationRequest } from "./generation/prompts.js";
import { selectMemories } from "./memory.js";
import { roleplayPromptOptions } from "./prompt-options.js";

export { greetingPrompt };

export const MAX_GREETING_CHARS = 1_200;

export type RoleplayOpening =
  | { kind: "card" }
  | { kind: "alternate"; text: string }
  | { kind: "generate" };

export type ParsedGreeting =
  | { ok: true; text: string }
  | { ok: false; error: string };

export function openingContextBlock(input: {
  card: CharacterCardV2;
  persona: RoleplayPersona;
  charName?: string;
  memories: RoleplayMemoryRecord[];
  storySoFar?: string;
}): string {
  const compiled = compilePrompt(input.card, input.persona, {
    ...(input.charName ? { charName: input.charName } : {}),
    memories: selectMemories(input.memories).injections,
  });

  const story = (input.storySoFar ?? "").trim();
  const previous = input.card.data.first_mes.trim();

  return [
    compiled,
    story ? `# Where things stand\n\n${story}` : "",
    previous
      ? `# The character's default opening, for tone only\n\n${previous}`
      : "",
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
  return {
    ...roleplayPromptOptions(greetingPrompt),
    text: openingContextBlock(input),
  };
}

const FENCE = /^```[a-z]*\n([\s\S]*?)\n?```$/i;
const LEADING_LABEL = /^(greeting|opening(?: line)?|first message)\s*:\s*/i;

export function parseGeneratedGreeting(raw: string): ParsedGreeting {
  const fenced = FENCE.exec(raw.trim());
  const body = (fenced?.[1] ?? raw)
    .trim()
    .replace(LEADING_LABEL, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!body)
    return { ok: false, error: "The model returned an empty opening." };
  return { ok: true, text: body.slice(0, MAX_GREETING_CHARS) };
}

export function sessionGreeting(
  bindingGreeting: string,
  card: CharacterCardV2,
): string {
  return bindingGreeting.trim() || card.data.first_mes;
}
