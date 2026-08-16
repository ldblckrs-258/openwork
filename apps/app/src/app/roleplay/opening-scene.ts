import { z } from "zod";

import {
  initialSceneState,
  MAX_SCENE_DESCRIPTION_CHARS,
  MAX_SCENE_NAME_CHARS,
  MAX_SCENE_STATE_CHARS,
  type CharacterCardV2,
  type RoleplayMemoryRecord,
  type RoleplayPersona,
  type RoleplaySceneState,
  type SceneRecord,
} from "@openwork/types/roleplay";

import openingScenePrompt from "./generation/opening-scene.md?raw";
import type { GenerationRequest } from "./generation/prompts.js";
import { openingContextBlock } from "./greeting.js";
import { parseLlmJson } from "./parse-llm-json.js";
import { roleplayPromptOptions } from "./prompt-options.js";
import { describeSceneRecord } from "./scene-state.js";

export { openingScenePrompt };

export const MAX_OPENING_SCENE_RECORDS = 12;

/**
 * Ids are not accepted from the model, and the schema is where that is enforced.
 */
const generatedRecordSchema = z.object({
  type: z.string().catch("other"),
  name: z.string().catch(""),
  state: z.string().catch(""),
  count: z.number().optional().catch(undefined),
  description: z.string().catch(""),
});

const generatedSceneSchema = z.array(generatedRecordSchema);

export type ParsedOpeningScene =
  | { ok: true; records: SceneRecord[] }
  | { ok: false; error: string };

function greetingBlock(greeting: string): string {
  return `# The opening line this conversation starts on\n\n${greeting.trim()}`;
}

function authoredBlock(records: SceneRecord[]): string {
  if (records.length === 0) return "";
  return [
    "# The state the character's author wrote as a default",
    ...records.map(
      (record) => `- ${record.type}: ${describeSceneRecord(record)}`,
    ),
  ].join("\n");
}

export function buildOpeningSceneRequest(input: {
  card: CharacterCardV2;
  persona: RoleplayPersona;
  charName?: string;
  memories: RoleplayMemoryRecord[];
  storySoFar?: string;
  greeting: string;
  authored: SceneRecord[];
}): GenerationRequest {
  const text = [
    openingContextBlock(input),
    authoredBlock(input.authored),
    greetingBlock(input.greeting),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { ...roleplayPromptOptions(openingScenePrompt), text };
}

export function parseGeneratedOpeningScene(raw: string): ParsedOpeningScene {
  const parsed = parseLlmJson(raw, generatedSceneSchema);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const records = parsed.value
    .map((record) => ({
      id: "",
      type: record.type,
      name: record.name.slice(0, MAX_SCENE_NAME_CHARS),
      state: record.state.slice(0, MAX_SCENE_STATE_CHARS),
      ...(record.count === undefined ? {} : { count: record.count }),
      description: record.description.slice(0, MAX_SCENE_DESCRIPTION_CHARS),
    }))
    .filter((record) => record.name.trim() !== "" || record.state.trim() !== "")
    .slice(0, MAX_OPENING_SCENE_RECORDS);

  return { ok: true, records };
}

export function openingSceneState(
  records: SceneRecord[],
  now: number,
): RoleplaySceneState {
  return initialSceneState(records, now);
}
