import type {
  CharacterCardV2,
  RoleplayLorebookRecord,
  RoleplayMemoryRecord,
  RoleplayPersona,
  RoleplaySessionSettings,
} from "@openwork/types/roleplay";

import { compilePrompt } from "./compile-prompt.js";
import { composeSystem, type ComposedSystem } from "./compose-system.js";
import { selectLorebookEntries, type LorebookScanMessage, type LorebookSelection } from "./lorebook.js";
import { substituteMacros } from "./macros.js";
import { selectMemories } from "./memory.js";
import { roleplayPromptOptions, type RoleplayPromptOptions } from "./prompt-options.js";
import { activeLorebooks, resolveSessionSettings } from "./session-settings.js";

export type RoleplayTurnInput = {
  card: CharacterCardV2;
  persona: RoleplayPersona;
  /** V3 nickname, when the card carried one. */
  charName?: string;
  /** The greeting the client rendered as the transcript's first entry. */
  greeting?: string;
  /** This turn's out-of-character steering, already split out of the message. */
  directorText?: string;
  /** User-authored continuity notes; carries the scene across a compaction. */
  storySoFar?: string;
  /** Approved memories for this character. Budgeted before they reach the prompt. */
  memories?: RoleplayMemoryRecord[];
  /** Lorebooks attached to this character. Only the entries this turn triggers reach the prompt. */
  lorebooks?: RoleplayLorebookRecord[];
  /**
   * Recent transcript, oldest first, for lorebook key matching.
   *
   * The message being sent belongs at the end: an entry keyed on a term the user
   * just typed has to fire for the reply to that message, not for the one after.
   */
  scanMessages?: LorebookScanMessage[];
  /**
   * This conversation's own configuration.
   *
   * Read live rather than snapshotted per turn, so a change made mid-scene
   * applies to the next send *and* to a regenerate of the reply already on
   * screen. Two alternatives of one turn can therefore differ by more than the
   * model's sampling.
   */
  settings?: RoleplaySessionSettings;
  envContext: string | null | undefined;
};

export type RoleplayTurn = {
  prompt: RoleplayPromptOptions;
  composed: ComposedSystem;
  /** Which lorebook entries fired, and why every candidate did or did not. */
  lorebook: LorebookSelection;
};

/**
 * The greeting is rendered by the client, not stored by the engine, so the model
 * has no record of having said it. Without this the character's own opening line
 * is invisible to it and the first reply reads as if the scene had not started.
 */
function openingLine(greeting: string, char: string, user: string): string {
  const expanded = substituteMacros(greeting, { char, user }).trim();
  return expanded ? `# Opening Line\n\nYou opened the scene with:\n\n${expanded}` : "";
}

/**
 * Build everything a roleplay send puts on the wire.
 *
 * One function so there is exactly one place that decides these travel together:
 * the pinned agent, the deny-all tool map, and a `system` that composes onto the
 * environment context instead of replacing it. A caller that assembles two of the
 * three by hand is the failure this exists to prevent.
 */
export function buildRoleplayTurn(input: RoleplayTurnInput): RoleplayTurn {
  const char = (input.charName ?? input.card.data.name).trim() || "Character";
  const user = input.persona.name.trim() || "User";
  const story = substituteMacros(input.storySoFar ?? "", { char, user }).trim();
  // Budgeted here rather than inside `compilePrompt`: the compiler takes already
  // chosen injections and ranks them against the lorebook, so deciding *which*
  // memories are candidates has to happen before it sees them.
  const settings = resolveSessionSettings(input.settings);
  const memories = selectMemories(input.memories ?? [], settings.memoryBudgetChars).injections;
  const lorebook = selectLorebookEntries(
    activeLorebooks(input.lorebooks ?? [], settings.disabledLorebookIds),
    input.scanMessages ?? [],
    {
      budgetChars: settings.lorebookBudgetChars,
      ...(settings.scanDepth === undefined ? {} : { scanDepth: settings.scanDepth }),
    },
  );
  const characterPrompt = [
    compilePrompt(input.card, input.persona, {
      ...(input.charName ? { charName: input.charName } : {}),
      lorebookBefore: lorebook.before,
      lorebook: lorebook.after,
      memories,
      systemPromptOverride: settings.systemPrompt,
      // The two sources have already been cut to their own budgets, so the
      // shared pass exists only to keep the sum from being re-cut against a
      // ceiling the user has overridden.
      budgetChars: settings.memoryBudgetChars + settings.lorebookBudgetChars,
    }),
    input.greeting ? openingLine(input.greeting, char, user) : "",
    // After the story so far, because it describes where the scene has got to
    // rather than who the character is.
    story ? `# Story So Far\n\n${story}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const composed = composeSystem({
    envContext: input.envContext,
    characterPrompt,
    directorText: input.directorText,
  });

  return { prompt: roleplayPromptOptions(composed.system), composed, lorebook };
}
