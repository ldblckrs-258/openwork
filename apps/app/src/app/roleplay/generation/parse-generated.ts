import type { CharacterCardV2, RoleplayCharacterRecord } from "@openwork/types/roleplay";
import { z } from "zod";

import { splitExampleMessages } from "../macros.js";
import { parseLlmJson } from "../parse-llm-json.js";
import { sanitizeCard, type CardSanitizeReport } from "../sanitize-card.js";

/**
 * Turning a model's answer into a character card the app is willing to keep.
 *
 * Generated output is not more trustworthy than an imported card. Both are text
 * this app did not write, both reach the prompt compiler verbatim, and a
 * generation prompt is steerable — by the user's idea, and by anything already
 * in the session it ran in. So generated payloads clear the same gate imports
 * do: the schema for shape, then the Phase 1 sanitizer for size caps, privilege
 * keys, and the extensions allow-list.
 */

/**
 * The flat field set the generator returns.
 *
 * Deliberately not the card envelope. Asking a model to emit `spec` and
 * `spec_version` wastes tokens on two constants and gives it a way to fail; the
 * envelope is written here instead.
 *
 * `name` and `first_mes` are the only required fields, matching the bar
 * `validateCharacter` enforces on a hand-authored card: a nameless character
 * compiles the fallback word "Character" into its own description, and a
 * character with no greeting opens the conversation on silence. Everything else
 * defaults, so one missing optional field costs a repair round rather than the
 * whole generation.
 */
export const generatedCardSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().default(""),
  personality: z.string().default(""),
  scenario: z.string().default(""),
  first_mes: z.string().trim().min(1),
  mes_example: z.string().default(""),
  alternate_greetings: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  creator_notes: z.string().default(""),
});

export type GeneratedCard = z.infer<typeof generatedCardSchema>;

export type ParsedGeneratedCard =
  | { ok: true; card: CharacterCardV2; report: CardSanitizeReport; repaired: boolean }
  | { ok: false; error: string; raw: string };

function toCardEnvelope(generated: GeneratedCard): unknown {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      ...generated,
      system_prompt: "",
      post_history_instructions: "",
      creator: "",
      character_version: "",
      extensions: {},
    },
  };
}

/**
 * Parse a generation response into a sanitized card.
 *
 * Two failure modes are distinguished on purpose. Unparseable or schema-invalid
 * output is the model's fault and is worth retrying; a payload the sanitizer
 * rejects is a card this app will not hold, and retrying the same prompt is
 * unlikely to change that.
 */
export function parseGeneratedCard(raw: string): ParsedGeneratedCard {
  const parsed = parseLlmJson(raw, generatedCardSchema);
  if (!parsed.ok) return { ok: false, error: parsed.error, raw };

  const sanitized = sanitizeCard(toCardEnvelope(parsed.value));
  if (!sanitized.ok) {
    return { ok: false, error: `The generated card was rejected: ${sanitized.reason.kind}`, raw };
  }

  return { ok: true, card: sanitized.card, report: sanitized.report, repaired: parsed.repaired };
}

export const interviewQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        question: z.string().trim().min(1),
        suggestions: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});

export type InterviewQuestion = z.infer<typeof interviewQuestionsSchema>["questions"][number];

export type ParsedInterviewQuestions =
  | { ok: true; questions: InterviewQuestion[]; repaired: boolean }
  | { ok: false; error: string; raw: string };

/**
 * Parse the interview response.
 *
 * Duplicate ids are dropped rather than rejected: they are a labelling mistake,
 * not a broken interview, and the ids are only used to key answers back to their
 * questions. Rejecting the whole round for one repeated slug would cost the user
 * a call they already paid for.
 */
export function parseInterviewQuestions(raw: string): ParsedInterviewQuestions {
  const parsed = parseLlmJson(raw, interviewQuestionsSchema);
  if (!parsed.ok) return { ok: false, error: parsed.error, raw };

  const seen = new Set<string>();
  const questions = parsed.value.questions.filter((question) => {
    if (seen.has(question.id)) return false;
    seen.add(question.id);
    return true;
  });

  return { ok: true, questions, repaired: parsed.repaired };
}

/**
 * Wrap a generated card as an unsaved character record.
 *
 * `authored`, not a third provenance. The record only ever reaches the store by
 * way of the editor, so by the time it is saved the user has read every field
 * and can have changed any of them — the same reasoning that makes a duplicated
 * import `authored`.
 */
export function generatedCharacterRecord(card: CharacterCardV2, id: string, now: number): RoleplayCharacterRecord {
  return {
    id,
    card,
    charSubstitutionName: card.data.name,
    source: "authored",
    attachedSkills: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** How many `<START>`-separated exchanges the example dialogue actually contains. */
export function countExampleExchanges(mesExample: string): number {
  return splitExampleMessages(mesExample).length;
}
