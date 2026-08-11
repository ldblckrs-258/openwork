import type { RoleplayMemoryRecord } from "@openwork/types/roleplay";
import { z } from "zod";

import type { GenerationRequest } from "./generation/prompts.js";
import { sanitizeMemoryText } from "./memory.js";
import { parseLlmJson } from "./parse-llm-json.js";
import { roleplayPromptOptions } from "./prompt-options.js";
import memoryExtractPrompt from "./memory-extract.md?raw";

/**
 * Proposing memories from a transcript.
 *
 * Nothing here writes. The extraction produces candidates that live in the
 * review UI until a person accepts them, which is the same locked decision the
 * Den memory bank made: unreviewed automatic memory produces confident false
 * facts, and a false memory is worse than a missing one because it is repeated
 * with authority in every later session and the user experiences it as the
 * character being wrong about their own history.
 *
 * The call runs behind the roleplay tool boundary, like generation: it reads a
 * transcript that contains an untrusted card's output, so it is not more
 * trustworthy than the card was.
 */

export { memoryExtractPrompt };

export const memoryProposalsSchema = z.object({
  memories: z.array(z.object({ text: z.string() })).catch([]),
});

export type MemoryProposal = { text: string };

export type ParsedMemoryProposals =
  | { ok: true; proposals: MemoryProposal[]; repaired: boolean }
  | { ok: false; error: string; raw: string };

export function buildMemoryExtractRequest(input: { transcript: string; charName: string }): GenerationRequest {
  return {
    ...roleplayPromptOptions(memoryExtractPrompt),
    text: `# Transcript\n\nThe character is ${input.charName}.\n\n${input.transcript.trim()}`,
  };
}

function normalize(text: string): string {
  return sanitizeMemoryText(text).toLowerCase();
}

/**
 * Parse an extraction response into candidates.
 *
 * Proposals that duplicate something already remembered are dropped rather than
 * shown. Extraction runs over transcripts that overlap — the same conversation
 * gets extracted again after it grows — so without this the review list fills
 * with things the user already approved and the real proposals get lost in it.
 */
export function parseMemoryProposals(raw: string, existing: RoleplayMemoryRecord[]): ParsedMemoryProposals {
  const parsed = parseLlmJson(raw, memoryProposalsSchema);
  if (!parsed.ok) return { ok: false, error: parsed.error, raw };

  const seen = new Set(existing.map((memory) => normalize(memory.text)));
  const proposals: MemoryProposal[] = [];
  for (const candidate of parsed.value.memories) {
    const text = sanitizeMemoryText(candidate.text);
    const key = normalize(candidate.text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    proposals.push({ text });
  }

  return { ok: true, proposals, repaired: parsed.repaired };
}

/**
 * Flatten a transcript for the extractor.
 *
 * Only the most recent exchanges are sent. A whole long conversation would cost
 * more than the feature is worth and would re-propose the same early facts on
 * every run; the dedupe above catches those, but not paying for them is better.
 */
export function buildTranscriptText(
  messages: { role: "user" | "assistant"; text: string }[],
  charName: string,
  userName: string,
  limit = 40,
): string {
  return messages
    .slice(-limit)
    .filter((message) => message.text.trim() !== "")
    .map((message) => `${message.role === "user" ? userName : charName}: ${message.text.trim()}`)
    .join("\n\n");
}
