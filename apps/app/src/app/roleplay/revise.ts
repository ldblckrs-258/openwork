import type {
  CharacterCardDataV2,
  CharacterCardV2,
  RoleplayCardRevision,
  RoleplayCharacterRecord,
} from "@openwork/types/roleplay";
import { z } from "zod";

import type { GenerationRequest } from "./generation/prompts.js";
import { parseLlmJson } from "./parse-llm-json.js";
import { roleplayPromptOptions } from "./prompt-options.js";
import { sanitizeCard } from "./sanitize-card.js";
import revisePrompt from "./revise-propose.md?raw";

export { revisePrompt };

/**
 * `system_prompt` and `post_history_instructions` are excluded because
 * `system_prompt` **replaces the app's roleplay instructions wholesale** when a
 * card sets it. A model able to write that field could rewrite its own operating
 * instructions through a review step the user reads as a personality tweak. It
 * is not a revisable field and must not become one.
 */
export const REVISABLE_FIELDS = ["description", "personality", "scenario", "mes_example"] as const;

export type RevisableField = (typeof REVISABLE_FIELDS)[number];

export function isRevisableField(field: string): field is RevisableField {
  return (REVISABLE_FIELDS as readonly string[]).includes(field);
}

export const revisionProposalsSchema = z.object({
  changes: z
    .array(z.object({ field: z.string(), value: z.string(), why: z.string().catch("") }))
    .catch([]),
});

export type FieldProposal = {
  field: RevisableField;
  before: string;
  after: string;
  why: string;
};

export type ParsedRevisionProposals =
  | { ok: true; proposals: FieldProposal[]; repaired: boolean }
  | { ok: false; error: string; raw: string };

export type ReviseInput = {
  card: CharacterCardV2;
  directorNotes: string[];
  transcript: string;
};

export function buildRevisionRequest(input: ReviseInput): GenerationRequest {
  const fields = REVISABLE_FIELDS.map((field) => `## ${field}\n\n${input.card.data[field] || "(empty)"}`).join("\n\n");
  const notes = input.directorNotes.map((note) => `- ${note.trim()}`).filter((note) => note !== "- ").join("\n");

  const sections = [`# The card as it stands\n\n${fields}`];
  if (notes) sections.push(`# Director notes from this conversation\n\nThe user wrote these out of character to correct you.\n\n${notes}`);
  sections.push(`# Transcript\n\n${input.transcript.trim()}`);

  return { ...roleplayPromptOptions(revisePrompt), text: sections.join("\n\n") };
}

export function parseRevisionProposals(raw: string, card: CharacterCardV2): ParsedRevisionProposals {
  const parsed = parseLlmJson(raw, revisionProposalsSchema);
  if (!parsed.ok) return { ok: false, error: parsed.error, raw };

  const seen = new Set<RevisableField>();
  const proposals: FieldProposal[] = [];
  for (const change of parsed.value.changes) {
    if (!isRevisableField(change.field) || seen.has(change.field)) continue;
    const after = change.value.trim();
    const before = card.data[change.field];
    if (!after || after === before.trim()) continue;
    seen.add(change.field);
    proposals.push({ field: change.field, before, after, why: change.why.trim() });
  }

  return { ok: true, proposals, repaired: parsed.repaired };
}

export type AppliedRevision = {
  character: RoleplayCharacterRecord;
  revision: RoleplayCardRevision;
  changedFields: RevisableField[];
};

export type ApplyRevisionResult =
  | { ok: true; unchanged: true; character: RoleplayCharacterRecord }
  | ({ ok: true; unchanged: false } & AppliedRevision)
  | { ok: false; message: string };

function withCardData(card: CharacterCardV2, data: CharacterCardDataV2): unknown {
  return { spec: "chara_card_v2", spec_version: "2.0", data: { ...card.data, ...data } };
}

export function applyRevision(input: {
  character: RoleplayCharacterRecord;
  proposals: FieldProposal[];
  approved: RevisableField[];
  revisionId: string;
  now: number;
}): ApplyRevisionResult {
  const changes = input.proposals.filter((proposal) => input.approved.includes(proposal.field));
  if (changes.length === 0) return { ok: true, unchanged: true, character: input.character };

  const edited: Partial<CharacterCardDataV2> = {};
  for (const change of changes) edited[change.field] = change.after;

  const sanitized = sanitizeCard(withCardData(input.character.card, edited as CharacterCardDataV2));
  if (!sanitized.ok) return { ok: false, message: `The revised card was rejected: ${sanitized.reason.kind}` };

  return {
    ok: true,
    unchanged: false,
    character: {
      ...input.character,
      card: sanitized.card,
      revisedAt: input.now,
      updatedAt: input.now,
    },
    revision: {
      id: input.revisionId,
      characterId: input.character.id,
      card: input.character.card,
      changedFields: changes.map((change) => change.field),
      createdAt: input.now,
    },
    changedFields: changes.map((change) => change.field),
  };
}

export function rollbackTo(input: {
  character: RoleplayCharacterRecord;
  revision: RoleplayCardRevision;
  revisionId: string;
  now: number;
}): AppliedRevision {
  return {
    character: {
      ...input.character,
      card: input.revision.card,
      revisedAt: input.now,
      updatedAt: input.now,
    },
    revision: {
      id: input.revisionId,
      characterId: input.character.id,
      card: input.character.card,
      changedFields: changedFieldsBetween(input.character.card, input.revision.card),
      createdAt: input.now,
    },
    changedFields: changedFieldsBetween(input.character.card, input.revision.card),
  };
}

export function changedFieldsBetween(left: CharacterCardV2, right: CharacterCardV2): RevisableField[] {
  return REVISABLE_FIELDS.filter((field) => left.data[field] !== right.data[field]);
}

export function driftFromOriginal(
  character: RoleplayCharacterRecord,
  revisions: RoleplayCardRevision[],
): { original: CharacterCardV2; changedFields: RevisableField[] } | undefined {
  const original = revisions[0]?.card;
  if (!original) return undefined;
  return { original, changedFields: changedFieldsBetween(original, character.card) };
}

export function createRevisionId(now: number, suffix: string): string {
  return `rev_${now.toString(36)}_${suffix}`;
}
