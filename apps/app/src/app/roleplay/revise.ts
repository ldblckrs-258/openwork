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

/**
 * Letting a character propose edits to its own card.
 *
 * Nothing here applies anything. A proposal is a suggestion the user approves one
 * field at a time, for the same reason memories are reviewed: a card that
 * rewrites itself drifts permanently on the evidence of one odd session, and the
 * user has no way to attribute the change afterwards. Per-field rather than
 * per-proposal because a suggestion that gets `personality` right and `scenario`
 * wrong is common, and all-or-nothing would lose the good half.
 */

export { revisePrompt };

/**
 * The only fields a model may propose changes to.
 *
 * `name` and `first_mes` are excluded because they are identity and opening, not
 * things play establishes. `alternate_greetings` likewise.
 *
 * `system_prompt` and `post_history_instructions` are excluded for a different
 * and harder reason: `system_prompt` **replaces the app's roleplay instructions
 * wholesale** when a card sets it. A model able to write that field could rewrite
 * its own operating instructions through a review step the user reads as a
 * personality tweak. It is not a revisable field and must not become one.
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
  /** The card's current text, so the UI renders a before-and-after without re-reading the card. */
  before: string;
  after: string;
  why: string;
};

export type ParsedRevisionProposals =
  | { ok: true; proposals: FieldProposal[]; repaired: boolean }
  | { ok: false; error: string; raw: string };

export type ReviseInput = {
  card: CharacterCardV2;
  /** Out-of-character corrections the user gave, strongest signal available. */
  directorNotes: string[];
  transcript: string;
};

/**
 * Build the proposal call.
 *
 * Director notes are sent as their own labelled section rather than left inline
 * in the transcript. They are the only evidence in the system where the user
 * states directly what was wrong, and a note buried among a hundred lines of
 * dialogue reads to the model as one more line of dialogue.
 */
export function buildRevisionRequest(input: ReviseInput): GenerationRequest {
  const fields = REVISABLE_FIELDS.map((field) => `## ${field}\n\n${input.card.data[field] || "(empty)"}`).join("\n\n");
  const notes = input.directorNotes.map((note) => `- ${note.trim()}`).filter((note) => note !== "- ").join("\n");

  const sections = [`# The card as it stands\n\n${fields}`];
  if (notes) sections.push(`# Director notes from this conversation\n\nThe user wrote these out of character to correct you.\n\n${notes}`);
  sections.push(`# Transcript\n\n${input.transcript.trim()}`);

  return { ...roleplayPromptOptions(revisePrompt), text: sections.join("\n\n") };
}

/**
 * Parse a proposal response into per-field changes.
 *
 * A change to a field outside `REVISABLE_FIELDS` is dropped rather than failing
 * the response: a model that also volunteers a `system_prompt` rewrite has still
 * produced usable suggestions for the fields it was asked about, and the drop is
 * silent because there is nothing the user could do about it.
 *
 * A change whose text matches what is already there is dropped too. Reviewing a
 * no-op teaches users to approve without reading.
 */
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
  /** Nothing was approved. The character is returned untouched, byte for byte. */
  | { ok: true; unchanged: true; character: RoleplayCharacterRecord }
  | ({ ok: true; unchanged: false } & AppliedRevision)
  | { ok: false; message: string };

function withCardData(card: CharacterCardV2, data: CharacterCardDataV2): unknown {
  return { spec: "chara_card_v2", spec_version: "2.0", data: { ...card.data, ...data } };
}

/**
 * Apply the approved changes, recording what the card was first.
 *
 * The result goes back through `sanitizeCard`, not only the schema. A revision is
 * model output steerable by the card's own text, and once written the compiler
 * treats it as trusted — which is exactly the position an imported card is in, so
 * it clears the same gate.
 *
 * Approving nothing returns the character untouched, byte for byte, rather than
 * writing an empty revision.
 */
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
      // The card *before* this revision. Rollback is then a copy rather than an
      // inverse diff, which is the operation most likely to be subtly wrong.
      card: input.character.card,
      changedFields: changes.map((change) => change.field),
      createdAt: input.now,
    },
    changedFields: changes.map((change) => change.field),
  };
}

/**
 * Undo back to a stored card.
 *
 * Records another revision rather than deleting the one being undone, so the
 * history stays a record of what happened. `revisedAt` is left set: a card that
 * has been revised and rolled back is still not the original author's untouched
 * work as far as anything downstream is concerned.
 */
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

/**
 * How far the card has walked from where it started.
 *
 * The oldest revision is the card before anything was applied, so this is the
 * comparison that catches drift compounding — many individually reasonable
 * approvals adding up to a character the user never wrote.
 */
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
