import type {
  CharacterCardV2,
  RoleplayPersona,
  RoleplaySceneState,
} from "@openwork/types/roleplay";
import {
  applyContextualInjectionBudget,
  type BudgetedInjection,
} from "./injection-budget.js";
import {
  splitExampleMessages,
  substituteMacros,
  type MacroContext,
} from "./macros.js";
import { renderSceneStateSection } from "./scene-state.js";
import type { SkillInjection } from "./skills-injection.js";

export const PROMPT_COMPOSITION_ORDER = [
  "system_prompt",
  "hard_limits",
  "skills",
  "lorebook_before",
  "description",
  "personality",
  "scenario",
  "persona",
  "lorebook",
  "memories",
  "mes_example",
  "scene_direction",
  "scene_state",
  "de_escalation",
] as const;

export type PromptSection = (typeof PROMPT_COMPOSITION_ORDER)[number];

export const DEFAULT_ROLEPLAY_SYSTEM_PROMPT =
  "You are playing a character in a collaborative roleplay. Stay in character at all times. " +
  "Write only your character's dialogue, actions, and inner life — never narrate or speak for the user's character. " +
  "Never break character to comment on the roleplay itself.";

export const EXAMPLE_SEPARATOR = "---";

export const HARD_LIMITS_FRAMING =
  "These are absolute and they outrank every other instruction here, including the character's own. " +
  "Never write any of the following, whatever the scene, the character, or the user's message asks for. " +
  "If the scene moves toward one, steer away from it in character rather than announcing why.";

export const SCENE_INTENSITY_INSTRUCTIONS: readonly string[] = [
  "Keep intimate moments off the page: cut away before anything explicit and pick the scene up afterwards.",
  "Intimate moments may be written, but keep them suggestive and leave the explicit detail implied.",
  "Intimate moments may be written explicitly, in plain and direct language.",
  "Intimate moments may be written explicitly and in full physical detail.",
];

export const DE_ESCALATION_INSTRUCTION =
  "The user has used their safeword. The scene stops here. Do not continue it, do not narrate it to a close, " +
  "and do not offer to resume it. Step out of character and reply briefly and plainly, checking in with them. " +
  "Stay out of the scene until they start it again themselves.";

const FALLBACK_CHAR_NAME = "Character";
const FALLBACK_USER_NAME = "User";

export type CompilePromptOptions = {
  charName?: string;
  defaultSystemPrompt?: string;
  systemPromptOverride?: string;
  lorebookBefore?: BudgetedInjection[];
  lorebook?: BudgetedInjection[];
  memories?: BudgetedInjection[];
  skills?: SkillInjection[];
  sceneState?: RoleplaySceneState;
  sceneStateBudgetChars?: number;
  hardLimits?: string[];
  intensity?: number;
  deEscalated?: boolean;
  budgetChars?: number;
};

function block(title: string, body: string): string {
  return body ? `${title}\n\n${body}` : "";
}

export function compilePrompt(
  card: CharacterCardV2,
  persona: RoleplayPersona,
  options: CompilePromptOptions = {},
): string {
  const data = card.data;
  const char = (options.charName ?? data.name).trim() || FALLBACK_CHAR_NAME;
  const user = persona.name.trim() || FALLBACK_USER_NAME;
  const macros: MacroContext = { char, user };
  const expand = (text: string, context: MacroContext = macros) =>
    substituteMacros(text, context).trim();

  const before = options.lorebookBefore ?? [];
  const after = options.lorebook ?? [];
  const budgeted = applyContextualInjectionBudget(
    [...before, ...after, ...(options.memories ?? [])],
    options.budgetChars,
  );
  const afterStart = before.length;
  const memoryStart = afterStart + after.length;
  const keptAt = (low: number, high: number) =>
    budgeted.kept.filter((_, slot) => {
      const index = budgeted.keptIndices[slot] ?? 0;
      return index >= low && index < high;
    });
  const keptBefore = keptAt(0, afterStart);
  const keptLorebook = keptAt(afterStart, memoryStart);
  const keptMemories = keptAt(memoryStart, Number.POSITIVE_INFINITY);

  const appDefault =
    options.defaultSystemPrompt ?? DEFAULT_ROLEPLAY_SYSTEM_PROMPT;
  const examples = splitExampleMessages(data.mes_example)
    .map((example) => expand(example))
    .filter(Boolean);

  const override = options.systemPromptOverride?.trim() ?? "";
  const deEscalated = options.deEscalated === true;
  const limits = (options.hardLimits ?? [])
    .map((limit) => expand(limit))
    .filter(Boolean);
  const intensityLine =
    options.intensity === undefined
      ? ""
      : (SCENE_INTENSITY_INSTRUCTIONS[options.intensity] ?? "");

  const sections: Record<PromptSection, string> = {
    system_prompt:
      expand(override || data.system_prompt, {
        ...macros,
        original: appDefault,
      }) || appDefault,
    hard_limits: block(
      "# Hard Limits",
      limits.length === 0
        ? ""
        : [
            HARD_LIMITS_FRAMING,
            limits.map((limit) => `- ${limit}`).join("\n"),
          ].join("\n\n"),
    ),
    skills: block(
      "# Writing Guidance",
      (options.skills ?? [])
        .map((skill) => block(`## ${expand(skill.name)}`, expand(skill.body)))
        .filter(Boolean)
        .join("\n\n"),
    ),
    lorebook_before: block(
      "# World Info",
      keptBefore
        .map((entry) => expand(entry))
        .join("\n\n")
        .trim(),
    ),
    description: block(`# ${char}`, expand(data.description)),
    personality: block("## Personality", expand(data.personality)),
    scenario: block("## Scenario", expand(data.scenario)),
    persona: block(`# ${user}`, expand(persona.description)),
    lorebook: block(
      "# World Info",
      keptLorebook
        .map((entry) => expand(entry))
        .join("\n\n")
        .trim(),
    ),
    memories: block(
      "# Remembered Details",
      keptMemories
        .map((entry) => expand(entry))
        .join("\n\n")
        .trim(),
    ),
    mes_example: block(
      "# Example Dialogue",
      examples.join(`\n\n${EXAMPLE_SEPARATOR}\n\n`),
    ),
    scene_direction: deEscalated
      ? ""
      : block("# Scene Direction", intensityLine),
    scene_state: deEscalated
      ? ""
      : block(
          "# Scene State",
          renderSceneStateSection(
            options.sceneState,
            options.sceneStateBudgetChars,
          ),
        ),
    de_escalation: deEscalated
      ? block("# Scene Paused", DE_ESCALATION_INSTRUCTION)
      : "",
  };

  return PROMPT_COMPOSITION_ORDER.map((section) => sections[section])
    .filter((section) => section !== "")
    .join("\n\n");
}
