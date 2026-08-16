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

export function generatedCharacterRecord(card: CharacterCardV2, id: string, now: number): RoleplayCharacterRecord {
  return {
    id,
    card,
    charSubstitutionName: card.data.name,
    source: "authored",
    attachedSkills: [],
    nsfw: false,
    sceneRecords: [],
    hardLimits: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function countExampleExchanges(mesExample: string): number {
  return splitExampleMessages(mesExample).length;
}
