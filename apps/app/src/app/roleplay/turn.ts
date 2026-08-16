import type {
  CharacterCardV2,
  RoleplayLorebookRecord,
  RoleplayMemoryRecord,
  RoleplayPersona,
  RoleplaySceneState,
  RoleplaySessionSettings,
} from "@openwork/types/roleplay";

import { compilePrompt } from "./compile-prompt.js";
import { composeSystem, type ComposedSystem } from "./compose-system.js";
import { selectLorebookEntries, type LorebookScanMessage, type LorebookSelection } from "./lorebook.js";
import { substituteMacros } from "./macros.js";
import { selectMemories } from "./memory.js";
import { countRenderedSceneRecords, renderSceneStateSection } from "./scene-state.js";
import { roleplayTurnPromptOptions, type RoleplayPromptOptions } from "./prompt-options.js";
import { activeLorebooks, activeSkills, resolveSessionSettings } from "./session-settings.js";
import { selectSkillInjections, type RoleplayAttachedSkill, type SkillSelection } from "./skills-injection.js";

export type RoleplayTurnInput = {
  card: CharacterCardV2;
  persona: RoleplayPersona;
  charName?: string;
  greeting?: string;
  directorText?: string;
  storySoFar?: string;
  memories?: RoleplayMemoryRecord[];
  lorebooks?: RoleplayLorebookRecord[];
  skills?: RoleplayAttachedSkill[];
  scanMessages?: LorebookScanMessage[];
  settings?: RoleplaySessionSettings;
  sceneState?: RoleplaySceneState;
  hardLimits?: string[];
  /**
   * Whether the bound character is marked adult.
   *
   * The only thing it decides here is whether the intensity dial reaches the
   * prompt. It is not a second gate on the scene-state tool: that tool is
   * advertised engine-wide, so an ordinary session can acquire state, and
   * silently dropping the section for it would leave the model contradicting a
   * scene the user can see on screen.
   */
  nsfw?: boolean;
  envContext: string | null | undefined;
};

export type RoleplayTurn = {
  prompt: RoleplayPromptOptions;
  composed: ComposedSystem;
  lorebook: LorebookSelection;
  skills: SkillSelection;
  sceneState: { chars: number; recordCount: number };
};

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
  const skills = selectSkillInjections(activeSkills(input.skills ?? [], settings.disabledSkillNames));
  const characterPrompt = [
    compilePrompt(input.card, input.persona, {
      ...(input.charName ? { charName: input.charName } : {}),
      lorebookBefore: lorebook.before,
      lorebook: lorebook.after,
      memories,
      skills: skills.injections,
      ...(input.sceneState ? { sceneState: input.sceneState } : {}),
      hardLimits: input.hardLimits ?? [],
      ...(input.nsfw ? { intensity: settings.intensity } : {}),
      deEscalated: settings.deEscalated,
      systemPromptOverride: settings.systemPrompt,
      budgetChars: settings.memoryBudgetChars + settings.lorebookBudgetChars,
    }),
    input.greeting ? openingLine(input.greeting, char, user) : "",
    story ? `# Story So Far\n\n${story}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const composed = composeSystem({
    envContext: input.envContext,
    characterPrompt,
    directorText: input.directorText,
  });

  const sceneSection = settings.deEscalated ? "" : renderSceneStateSection(input.sceneState);

  // The turn variant, not the shared one: this is the single path allowed to
  // carry the scene-state tool. The other five roleplay callers stay on
  // `roleplayPromptOptions` and keep carrying nothing.
  //
  // While the safeword's freeze is in force the turn narrows to carrying
  // nothing either. The de-escalation instruction asks the model to stop; this
  // is what stops it from writing state whatever it decides about that, and it
  // is why the freeze is a stored flag rather than a property of one send.
  return {
    prompt: roleplayTurnPromptOptions(composed.system, { denyTools: settings.deEscalated }),
    composed,
    lorebook,
    skills,
    sceneState: { chars: sceneSection.length, recordCount: countRenderedSceneRecords(sceneSection) },
  };
}
