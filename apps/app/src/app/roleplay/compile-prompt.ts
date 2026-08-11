import type { CharacterCardV2, RoleplayPersona } from "@openwork/types/roleplay";
import { applyContextualInjectionBudget, type BudgetedInjection } from "./injection-budget.js";
import { splitExampleMessages, substituteMacros, type MacroContext } from "./macros.js";

/**
 * Our composition order, exported as one constant so it can be changed without
 * touching the compiler.
 *
 * No canonical order exists: SillyTavern and RisuAI both treat prompt order as a
 * user-reorderable list of typed blocks and they disagree on where persona and
 * lorebook sit relative to description. This is therefore a decision, not a
 * spec. Community cards were authored against SillyTavern, so some may behave
 * slightly differently here than their creators intended; moving toward ST's
 * order is a change to this array alone.
 *
 * `post_history_instructions` is **not** a missing step to be added later. It is
 * unsupportable and was removed. The engine appends a per-prompt `system` string
 * to the end of the system message at index 0, before all chat history — proven
 * at the wire level in `reports/tool-denial-spike.md`. The field's entire meaning
 * is that it lands after history, and the front is the only place `system` can
 * go. Emitting it here would silently relocate it, changing character behavior in
 * a way users would misattribute to the model. Report the loss on import instead.
 *
 * Chat history and per-turn director text are still absent by design: history is
 * supplied by the engine, and director text is a Phase 5 concern.
 */
export const PROMPT_COMPOSITION_ORDER = [
  "system_prompt",
  "lorebook_before",
  "description",
  "personality",
  "scenario",
  "persona",
  "lorebook",
  "memories",
  "mes_example",
] as const;

export type PromptSection = (typeof PROMPT_COMPOSITION_ORDER)[number];

export const DEFAULT_ROLEPLAY_SYSTEM_PROMPT =
  "You are playing a character in a collaborative roleplay. Stay in character at all times. " +
  "Write only your character's dialogue, actions, and inner life — never narrate or speak for the user's character. " +
  "Never break character to comment on the roleplay itself.";

export const EXAMPLE_SEPARATOR = "---";

const FALLBACK_CHAR_NAME = "Character";
const FALLBACK_USER_NAME = "User";

export type CompilePromptOptions = {
  /** V3 `nickname`, when the card carried one; overrides `{{char}}` without changing the display name. */
  charName?: string;
  defaultSystemPrompt?: string;
  /**
   * Matched entries whose `position` is `before_char`, which the V2 spec places
   * ahead of the character definition rather than after it.
   */
  lorebookBefore?: BudgetedInjection[];
  /** Matched entries positioned after the character definition — the spec's default. */
  lorebook?: BudgetedInjection[];
  /** Supplied by the character-memory phase. */
  memories?: BudgetedInjection[];
  budgetChars?: number;
};

function block(title: string, body: string): string {
  return body ? `${title}\n\n${body}` : "";
}

/**
 * Compile a card plus the user's persona into the per-prompt `system` string.
 *
 * Pure and deterministic: identical input compiles to identical bytes, which is
 * what lets a swipe replay a turn with the exact system string it originally ran
 * against.
 */
export function compilePrompt(
  card: CharacterCardV2,
  persona: RoleplayPersona,
  options: CompilePromptOptions = {},
): string {
  const data = card.data;
  const char = (options.charName ?? data.name).trim() || FALLBACK_CHAR_NAME;
  const user = persona.name.trim() || FALLBACK_USER_NAME;
  const macros: MacroContext = { char, user };
  const expand = (text: string, context: MacroContext = macros) => substituteMacros(text, context).trim();

  // One budget call over all three sources, not one per source: they compete for
  // the same ceiling, so ranking them separately would let the split decide the
  // outcome rather than the priorities.
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

  const appDefault = options.defaultSystemPrompt ?? DEFAULT_ROLEPLAY_SYSTEM_PROMPT;
  const examples = splitExampleMessages(data.mes_example).map((example) => expand(example)).filter(Boolean);

  const sections: Record<PromptSection, string> = {
    system_prompt: expand(data.system_prompt, { ...macros, original: appDefault }) || appDefault,
    lorebook_before: block("# World Info", keptBefore.map((entry) => expand(entry)).join("\n\n").trim()),
    description: block(`# ${char}`, expand(data.description)),
    personality: block("## Personality", expand(data.personality)),
    scenario: block("## Scenario", expand(data.scenario)),
    persona: block(`# ${user}`, expand(persona.description)),
    lorebook: block("# World Info", keptLorebook.map((entry) => expand(entry)).join("\n\n").trim()),
    memories: block("# Remembered Details", keptMemories.map((entry) => expand(entry)).join("\n\n").trim()),
    mes_example: block("# Example Dialogue", examples.join(`\n\n${EXAMPLE_SEPARATOR}\n\n`)),
  };

  return PROMPT_COMPOSITION_ORDER.map((section) => sections[section])
    .filter((section) => section !== "")
    .join("\n\n");
}
